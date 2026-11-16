"use client";
/**
 * Live room voice through Cloudflare's relay (SFU). One connection per phone, whatever the room size:
 *  - SfuPush: a speaker sends each track (mic, camera, music) up once.
 *  - SfuPull: a listener receives every speaker's tracks over a single connection.
 * Every step goes through /api/rooms/[id]/sfu, which holds the Cloudflare key and checks the member may join.
 */

let onCache: { at: number; on: boolean } | null = null;
/** Is the relay set up? (cached for 5 minutes) */
export async function sfuReady(roomId: string): Promise<boolean> {
  if (onCache && Date.now() - onCache.at < 5 * 60_000) return onCache.on;
  try {
    const j = await fetch(`/api/rooms/${roomId}/sfu`, { cache: "no-store" }).then((r) => r.json());
    onCache = { at: Date.now(), on: !!j?.on };
  } catch { onCache = { at: Date.now(), on: false }; }
  return onCache.on;
}

async function call(roomId: string, body: Record<string, unknown>) {
  const r = await fetch(`/api/rooms/${roomId}/sfu`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || "Voice relay error");
  return j;
}

/** Wait (briefly) for the phone to finish finding its network routes, so the relay gets them in one go. */
function gathered(pc: RTCPeerConnection, ms = 1500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((res) => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); pc.removeEventListener("icegatheringstatechange", chk); res(); }
    function chk() { if (pc.iceGatheringState === "complete") done(); }
    pc.addEventListener("icegatheringstatechange", chk);
  });
}

/** One step at a time on a connection (offers and answers must never overlap). */
function queue() {
  let p: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => { const n = p.then(fn, fn); p = n.catch(() => {}); return n; };
}

type Base = { roomId: string; onFail?: () => void };

function newPc(ice: RTCConfiguration, onFail?: () => void) {
  const pc = new RTCPeerConnection({ ...ice, bundlePolicy: "max-bundle" });
  let t: ReturnType<typeof setTimeout> | undefined;
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    clearTimeout(t);
    if (st === "failed") onFail?.();
    // A short drop heals by itself; one that lasts gets a fresh connection.
    else if (st === "disconnected") t = setTimeout(() => { if (pc.connectionState === "disconnected") onFail?.(); }, 6000);
  };
  return pc;
}

export class SfuPush {
  pc: RTCPeerConnection;
  sessionId = "";
  private roomId: string;
  private q = queue();
  private tx = new Map<string, RTCRtpTransceiver>(); // track name → transceiver
  closed = false;
  constructor(o: Base & { ice: RTCConfiguration }) { this.roomId = o.roomId; this.pc = newPc(o.ice, o.onFail); }

  async open() { const j = await call(this.roomId, { op: "new" }); this.sessionId = j.sessionId; return this; }

  /** Send a track up (or swap it in place if that name is already going). */
  publish(name: string, track: MediaStreamTrack, maxBitrate?: number) {
    return this.q(async () => {
      if (this.closed) return;
      const have = this.tx.get(name);
      if (have && have.direction === "sendonly") { await have.sender.replaceTrack(track); this.cap(have, maxBitrate); return; }
      const t = this.pc.addTransceiver(track, { direction: "sendonly" });
      this.tx.set(name, t);
      this.cap(t, maxBitrate);
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await gathered(this.pc);
      const j = await call(this.roomId, { op: "tracks", sessionId: this.sessionId, sessionDescription: this.pc.localDescription, tracks: [{ location: "local", mid: t.mid, trackName: name }] });
      if (j.sessionDescription) await this.pc.setRemoteDescription(j.sessionDescription);
    });
  }

  private cap(t: RTCRtpTransceiver, maxBitrate?: number) {
    try {
      const p = t.sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      if (maxBitrate) p.encodings[0].maxBitrate = maxBitrate;
      (p.encodings[0] as any).priority = "high"; (p.encodings[0] as any).networkPriority = "high";
      t.sender.setParameters(p).catch(() => {});
    } catch { /* older browser */ }
  }

  setBitrate(name: string, maxBitrate: number) { const t = this.tx.get(name); if (t) this.cap(t, maxBitrate); }
  has(name: string) { return this.tx.has(name); }

  /** Stop sending one track. */
  unpublish(name: string) {
    return this.q(async () => {
      const t = this.tx.get(name);
      if (!t || this.closed) return;
      this.tx.delete(name);
      const mid = t.mid;
      try { t.stop(); } catch { try { t.direction = "inactive"; } catch {} }
      try {
        await this.pc.setLocalDescription(await this.pc.createOffer());
        const j = await call(this.roomId, { op: "close", sessionId: this.sessionId, sessionDescription: this.pc.localDescription, tracks: [{ mid }] });
        if (j.sessionDescription) await this.pc.setRemoteDescription(j.sessionDescription);
      } catch { /* the relay drops it when the connection closes anyway */ }
    });
  }

  close() { this.closed = true; try { this.pc.close(); } catch {} this.tx.clear(); }
}

export type PullWant = { key: string; sessionId: string; trackName: string };

export class SfuPull {
  pc: RTCPeerConnection;
  sessionId = "";
  private roomId: string;
  private q = queue();
  private byMid = new Map<string, string>(); // mid → key
  private byKey = new Map<string, { mid: string; sessionId: string; trackName: string }>();
  closed = false;
  onTrack?: (key: string, track: MediaStreamTrack) => void;
  constructor(o: Base & { ice: RTCConfiguration; onTrack: (key: string, track: MediaStreamTrack) => void }) {
    this.roomId = o.roomId; this.onTrack = o.onTrack;
    this.pc = newPc(o.ice, o.onFail);
    this.pc.ontrack = (e) => { const k = e.transceiver?.mid ? this.byMid.get(e.transceiver.mid) : undefined; if (k) this.onTrack?.(k, e.track); };
  }

  async open() { const j = await call(this.roomId, { op: "new" }); this.sessionId = j.sessionId; return this; }

  /** What's being received now (key → the speaker's session and track). */
  current(key: string) { return this.byKey.get(key); }
  keys() { return [...this.byKey.keys()]; }

  /** Start receiving these tracks (several at once, one exchange). */
  pull(list: PullWant[]) {
    return this.q(async () => {
      const want = list.filter((w) => { const c = this.byKey.get(w.key); return !c || c.sessionId !== w.sessionId || c.trackName !== w.trackName; });
      if (!want.length || this.closed) return;
      const j = await call(this.roomId, { op: "tracks", sessionId: this.sessionId, tracks: want.map((w) => ({ location: "remote", sessionId: w.sessionId, trackName: w.trackName })) });
      const got: any[] = Array.isArray(j.tracks) ? j.tracks : [];
      got.forEach((t, i) => {
        if (!t?.mid || t.errorCode) return;
        const w = want.find((x) => x.sessionId === t.sessionId && x.trackName === t.trackName) || (got.length === want.length ? want[i] : undefined);
        if (!w) return;
        const old = this.byKey.get(w.key);
        if (old) this.byMid.delete(old.mid);
        this.byMid.set(String(t.mid), w.key);
        this.byKey.set(w.key, { mid: String(t.mid), sessionId: w.sessionId, trackName: w.trackName });
      });
      if (j.requiresImmediateRenegotiation && j.sessionDescription) {
        await this.pc.setRemoteDescription(j.sessionDescription);
        await this.pc.setLocalDescription(await this.pc.createAnswer());
        await gathered(this.pc);
        await call(this.roomId, { op: "renegotiate", sessionId: this.sessionId, sessionDescription: this.pc.localDescription });
      }
    });
  }

  /** Stop receiving these. */
  drop(keys: string[]) {
    return this.q(async () => {
      const mids: string[] = [];
      for (const k of keys) { const c = this.byKey.get(k); if (!c) continue; this.byKey.delete(k); this.byMid.delete(c.mid); mids.push(c.mid); }
      if (!mids.length || this.closed) return;
      try {
        const j = await call(this.roomId, { op: "close", sessionId: this.sessionId, tracks: mids.map((mid) => ({ mid })) });
        if (j.requiresImmediateRenegotiation && j.sessionDescription) {
          await this.pc.setRemoteDescription(j.sessionDescription);
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          await call(this.roomId, { op: "renegotiate", sessionId: this.sessionId, sessionDescription: this.pc.localDescription });
        }
      } catch { /* harmless: the track just stops */ }
    });
  }

  close() { this.closed = true; try { this.pc.close(); } catch {} this.byKey.clear(); this.byMid.clear(); }
}
