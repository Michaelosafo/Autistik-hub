"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { DropPanel } from "@/components/rooms/RoomDrops";
import ProfileSheet from "@/components/rooms/ProfileSheet";
import VerifiedBadge from "@/components/VerifiedBadge";
import Emo from "@/components/Emo";
import WalletGate from "@/components/rooms/WalletGate";
import { supabaseBrowser } from "@/lib/supabase/client";

type Me = { id: string; alias: string; color: string | null; avatar_url: string | null; is_verified?: boolean; verified_badge?: number | null };
type Role = "host" | "cohost" | "speaker" | "listener";
type Peer = { id: string; alias: string; color: string | null; avatar_url: string | null; role: Role; hand: boolean; muted: boolean; at: number; ver?: boolean; vb?: number | null };
type Room = { id: string; title: string; host_id: string; ended_at: string | null; chain?: string | null; token?: string | null; cohosts?: string[] | null };

const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }] };
const MAX_STAGE = 8; // host + co-hosts + speakers
const MAX_COHOSTS = 3;
const REACTIONS = ["🚀", "💎", "❤️", "😂", "👏", "🔥"];
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/** A live video tile (a speaker's camera). */
function VideoTile({ stream, mine, label }: { stream: MediaStream; mine?: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  // Muted: the voice already plays through the room's audio (and your own would echo).
  return <div className="room-video"><video ref={ref} autoPlay playsInline muted style={mine ? { transform: "scaleX(-1)" } : undefined} /><small>{label}</small></div>;
}

/**
 * A live room (voice, camera optional), like an X Space, built for launches.
 *  - Everyone joins with a wallet linked to their account (WalletGate), kept private, so the host can drop tokens to
 *    everyone at once or to one person by tapping their picture.
 *  - The host can make up to 3 co-hosts to run the call with them (invite speakers, move people down, send drops).
 *  - The room shows pictures and follower counts only; tap a picture for the person's card (posts, coins, follow).
 * Voice and video go straight between browsers (WebRTC); the site only passes the connection messages (Supabase
 * Realtime). Nothing is recorded.
 */
export default function LiveRoom({ room, me }: { room: Room; me: Me }) {
  const isHost = me.id === room.host_id;
  const [ready, setReady] = useState<string | null>(null); // my wallet is linked (short address, shown only to me)
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [speakers, setSpeakers] = useState<string[]>([room.host_id]);
  const [cohosts, setCohosts] = useState<string[]>(room.cohosts || []);
  const [hand, setHand] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(!!room.ended_at);
  const [msg, setMsg] = useState("");
  const [talking, setTalking] = useState<Record<string, boolean>>({});
  const [cam, setCam] = useState(false);
  const [videos, setVideos] = useState<Record<string, MediaStream>>({});
  const [drop, setDrop] = useState("");
  const [followers, setFollowers] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<Peer | null>(null);
  const [sendTo, setSendTo] = useState<{ id: string; alias: string } | null>(null);
  const [floaters, setFloaters] = useState<{ k: number; e: string; x: number; big?: boolean }[]>([]);
  // 🔥 MORE FIRE: the room's signature reaction. Everyone sees a burst of flames and the counter climbs.
  const [fires, setFires] = useState(0);
  const [blaze, setBlaze] = useState(false);
  // Recording (host only): everyone's voice mixed into one audio file, saved to the host's profile when stopped.
  const [rec, setRec] = useState(false); // I'm recording (host)
  const [recOn, setRecOn] = useState(false); // the room is being recorded (everyone sees 🔴 REC)
  const [recSecs, setRecSecs] = useState(0);
  const [saved, setSaved] = useState<{ id: string; pinned: boolean } | null>(null);
  const [saving, setSaving] = useState("");

  const chan = useRef<any>(null);
  const mic = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>()); // key: "from>to"
  const voices = useRef(new Map<string, MediaStream>()); // incoming voices, for the recording
  const mixCtx = useRef<AudioContext | null>(null);
  const mixDest = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mixSrc = useRef(new Map<string, MediaStreamAudioSourceNode>());
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recBytes = useRef(0);
  const recStart = useRef(0);
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const speakersRef = useRef(speakers);
  speakersRef.current = speakers;
  const cohostsRef = useRef(cohosts);
  cohostsRef.current = cohosts;

  const isCohost = cohosts.includes(me.id);
  const canRun = isHost || isCohost;
  const roleOf = useCallback((id: string): Role => (id === room.host_id ? "host" : cohosts.includes(id) ? "cohost" : speakers.includes(id) ? "speaker" : "listener"), [room.host_id, cohosts, speakers]);
  const myRole = roleOf(me.id);
  const canSpeak = myRole !== "listener";

  function send(event: string, payload: any) { chan.current?.send({ type: "broadcast", event, payload: { ...payload, from: me.id } }); }

  function closePc(key: string) {
    const pc = pcs.current.get(key);
    if (pc) { try { pc.close(); } catch {} pcs.current.delete(key); }
    const a = audios.current.get(key);
    if (a) { a.srcObject = null; a.remove(); audios.current.delete(key); }
    voices.current.delete(key);
    try { mixSrc.current.get(key)?.disconnect(); } catch {}
    mixSrc.current.delete(key);
    const [from, to] = key.split(">");
    if (to === me.id) setVideos((v) => { if (!v[from]) return v; const n = { ...v }; delete n[from]; return n; });
  }

  function newPc(key: string, remote: string) {
    closePc(key);
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(key, pc);
    pc.onicecandidate = (e) => { if (e.candidate) send("ice", { to: remote, key, candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (e.track.kind === "video") {
        const st = e.streams[0] || new MediaStream([e.track]);
        setVideos((v) => ({ ...v, [remote]: st }));
        e.track.onended = () => setVideos((v) => { const n = { ...v }; delete n[remote]; return n; });
        return;
      }
      let a = audios.current.get(key);
      if (!a) { a = document.createElement("audio"); a.autoplay = true; (a as any).playsInline = true; document.body.appendChild(a); audios.current.set(key, a); }
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      voices.current.set(key, a.srcObject as MediaStream);
      if (recorder.current) mixIn(key, a.srcObject as MediaStream);
      a.play().catch(() => setMsg("Tap anywhere to hear the room."));
      watchLevel(remote, a.srcObject as MediaStream);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") closePc(key); };
    return pc;
  }

  // I'm on stage: send my microphone (and camera, if on) to one person.
  async function callPeer(to: string) {
    if (!mic.current || to === me.id) return;
    const key = `${me.id}>${to}`;
    const pc = newPc(key, to);
    mic.current.getTracks().forEach((t) => pc.addTrack(t, mic.current!));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send("offer", { to, key, sdp: pc.localDescription });
  }

  // Who's talking: a simple loudness meter per voice.
  const levels = useRef(new Map<string, () => void>());
  function watchLevel(id: string, stream: MediaStream) {
    levels.current.get(id)?.();
    try {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const t = setInterval(() => {
        an.getByteFrequencyData(buf);
        const v = buf.reduce((s, x) => s + x, 0) / buf.length;
        setTalking((m) => (m[id] === v > 18 ? m : { ...m, [id]: v > 18 }));
      }, 250);
      levels.current.set(id, () => { clearInterval(t); ctx.close().catch(() => {}); });
    } catch { /* no meter on this browser */ }
  }

  async function startMic() {
    if (mic.current) return true;
    try {
      mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      mic.current.getAudioTracks().forEach((t) => (t.enabled = false));
      setMuted(true);
      watchLevel(me.id, mic.current);
      return true;
    } catch {
      setMsg("Allow the microphone in your browser to speak.");
      return false;
    }
  }

  // Camera on/off: the video goes along with the voice, so everyone gets a fresh connection with or without it.
  async function toggleCam() {
    if (!mic.current) return;
    if (!cam) {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } } });
        v.getVideoTracks().forEach((t) => mic.current!.addTrack(t));
        setCam(true);
      } catch { setMsg("Allow the camera in your browser to go on video."); return; }
    } else {
      mic.current.getVideoTracks().forEach((t) => { t.stop(); mic.current!.removeTrack(t); });
      setCam(false);
      send("cam", { on: false });
    }
    Object.keys(peers).forEach((id) => { if (id !== me.id) callPeer(id); });
  }

  function stopMic() {
    setCam(false);
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    levels.current.get(me.id)?.();
    for (const k of [...pcs.current.keys()]) if (k.startsWith(`${me.id}>`)) closePc(k);
  }

  const runners = () => [room.host_id, ...cohostsRef.current];

  async function join() {
    setMsg("");
    const sb = supabaseBrowser();
    const ch = sb.channel(`room:${room.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    chan.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, any[]>;
      const next: Record<string, Peer> = {};
      for (const [id, metas] of Object.entries(st)) { const m = metas[metas.length - 1]; if (m) next[id] = { id, alias: m.alias, color: m.color, avatar_url: m.avatar_url, role: m.role, hand: !!m.hand, muted: !!m.muted, at: m.at || 0, ver: !!m.ver, vb: m.vb ?? null }; }
      setPeers(next);
      for (const k of [...pcs.current.keys()]) { const [a, b] = k.split(">"); if (!next[a] || !next[b]) closePc(k); }
      // The host's lists of speakers and co-hosts are the ones that count.
      const h = st[room.host_id]?.[0];
      if (h?.speakers && !isHost) setSpeakers(h.speakers);
      if (h?.cohosts && !isHost) setCohosts(h.cohosts);
      if (!isHost) setRecOn(!!h?.rec);
    });
    ch.on("broadcast", { event: "offer" }, async ({ payload }: any) => {
      // Voice only from people on stage (host, co-hosts, speakers).
      if (payload.to !== me.id || !(speakersRef.current.includes(payload.from) || runners().includes(payload.from))) return;
      const pc = newPc(payload.key, payload.from);
      await pc.setRemoteDescription(payload.sdp);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      send("answer", { to: payload.from, key: payload.key, sdp: pc.localDescription });
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }: any) => {
      if (payload.to !== me.id) return;
      const pc = pcs.current.get(payload.key);
      if (pc && pc.signalingState === "have-local-offer") await pc.setRemoteDescription(payload.sdp).catch(() => {});
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }: any) => {
      if (payload.to !== me.id) return;
      await pcs.current.get(payload.key)?.addIceCandidate(payload.candidate).catch(() => {});
    });
    // The host and co-hosts run the stage.
    ch.on("broadcast", { event: "speakers" }, ({ payload }: any) => {
      if (!runners().includes(payload.from)) return;
      setSpeakers(payload.speakers); speakersRef.current = payload.speakers;
      if (isHost) track("host", false, mutedRef.current);
    });
    ch.on("broadcast", { event: "cohosts" }, ({ payload }: any) => { if (payload.from === room.host_id) setCohosts(payload.cohosts); });
    ch.on("broadcast", { event: "cam" }, ({ payload }: any) => {
      if (payload.on === false) setVideos((v) => { const n = { ...v }; delete n[payload.from]; return n; });
    });
    ch.on("broadcast", { event: "drop" }, ({ payload }: any) => { if (runners().includes(payload.from)) setDrop(String(payload.text || "").slice(0, 160)); });
    ch.on("broadcast", { event: "fire" }, () => fireBurst());
    ch.on("broadcast", { event: "rec" }, ({ payload }: any) => { if (payload.from === room.host_id) setRecOn(!!payload.on); });
    ch.on("broadcast", { event: "react" }, ({ payload }: any) => { if (REACTIONS.includes(payload.e)) float(payload.e); });
    ch.on("broadcast", { event: "end" }, ({ payload }: any) => { if (payload.from === room.host_id) { setEnded(true); leave(); } });
    ch.subscribe(async (status: string) => {
      if (status !== "SUBSCRIBED") { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setMsg("Couldn't connect to the room. Check your internet and try again."); return; }
      if (isHost) await startMic();
      await track(isHost ? "host" : "listener", false, true);
      setJoined(true);
    });
  }

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  async function track(role: Role, h: boolean, m: boolean) {
    await chan.current?.track({ alias: me.alias, color: me.color, avatar_url: me.avatar_url, ver: !!me.is_verified, vb: me.verified_badge ?? null, role, hand: h, muted: m, at: Date.now(), ...(isHost ? { speakers: speakersRef.current, cohosts: cohostsRef.current, rec: !!recorder.current } : {}) });
  }

  // My role changed (invited up or moved down): start or stop sending my voice.
  useEffect(() => {
    if (!joined) return;
    (async () => {
      if (canSpeak) {
        if (await startMic()) Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
        setPeers((p) => ({ ...p }));
        setHand(false);
      } else if (mic.current) stopMic();
      await track(myRole, canSpeak ? false : hand, muted);
    })();
  }, [joined, myRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone on stage sends their voice to everyone in the room, including people who join later.
  useEffect(() => {
    if (!joined || !canSpeak || !mic.current) return;
    Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
  }, [peers, joined, canSpeak]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follower counts for the pictures (public numbers), fetched for new faces only.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const fresh = Object.keys(peers).filter((id) => !asked.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => asked.current.add(id));
    fetch(`/api/rooms/followers?ids=${fresh.slice(0, 80).join(",")}`).then((r) => r.json()).then((m) => setFollowers((f) => ({ ...f, ...m }))).catch(() => {});
  }, [peers]);

  function leave() {
    stopMic();
    for (const k of [...pcs.current.keys()]) closePc(k);
    levels.current.forEach((f) => f()); levels.current.clear();
    chan.current?.unsubscribe(); chan.current = null;
    setJoined(false); setPeers({});
  }
  useEffect(() => () => leave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleMute() {
    const next = !muted;
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next); track(myRole, false, next);
  }
  function raiseHand() { const h = !hand; setHand(h); track(myRole, h, true); }

  // ---- running the stage (host and co-hosts)
  async function setSpeakerList(list: string[]) {
    setSpeakers(list); speakersRef.current = list;
    send("speakers", { speakers: list });
    if (isHost) await track("host", false, muted);
  }
  const stageCount = () => new Set([room.host_id, ...cohostsRef.current, ...speakersRef.current]).size;
  const invite = (id: string) => { if (stageCount() >= MAX_STAGE) { setMsg(`Up to ${MAX_STAGE} people on stage at a time.`); return; } setSpeakerList([...new Set([...speakers, id])]); };
  const moveDown = (id: string) => setSpeakerList(speakers.filter((s) => s !== id));
  async function setCohostList(list: string[]) {
    setCohosts(list); cohostsRef.current = list;
    send("cohosts", { cohosts: list });
    await supabaseBrowser().from("live_rooms").update({ cohosts: list }).eq("id", room.id);
    await track("host", false, muted);
  }
  const makeCohost = (id: string) => {
    if (cohosts.length >= MAX_COHOSTS) { setMsg(`Up to ${MAX_COHOSTS} co-hosts.`); return; }
    setCohostList([...cohosts, id]);
    if (!speakers.includes(id)) setSpeakerList([...speakers, id]);
  };
  const removeCohost = (id: string) => setCohostList(cohosts.filter((c) => c !== id));
  // ---- recording (host only)
  function mixIn(key: string, stream: MediaStream) {
    if (!mixCtx.current || !mixDest.current || mixSrc.current.has(key) || !stream.getAudioTracks().length) return;
    try { const src = mixCtx.current.createMediaStreamSource(stream); src.connect(mixDest.current); mixSrc.current.set(key, src); } catch { /* skip this voice */ }
  }
  async function startRec() {
    if (recorder.current || !isHost) return;
    if (!confirm("Record this live? Everyone will see 🔴 REC, and you can pin the recording to your profile.")) return;
    try {
      const ctx = new AudioContext();
      mixCtx.current = ctx; mixDest.current = ctx.createMediaStreamDestination();
      if (mic.current) mixIn("me", mic.current);
      voices.current.forEach((st, k) => mixIn(k, st));
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) || "";
      const r = new MediaRecorder(mixDest.current.stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
      chunks.current = []; recBytes.current = 0; recStart.current = Date.now();
      r.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunks.current.push(e.data); recBytes.current += e.data.size;
        if (recBytes.current > 48 * 1024 * 1024) { setMsg("Recording limit reached (about 3 hours). Saving it now."); stopRec(); }
      };
      r.start(5000);
      recorder.current = r;
      setRec(true); setRecOn(true); setSaved(null); setRecSecs(0);
      send("rec", { on: true });
      track("host", false, muted);
    } catch { setMsg("This browser can't record. Try Chrome or Safari on a recent phone or computer."); }
  }
  function stopRec(): Promise<void> {
    const r = recorder.current;
    if (!r) return Promise.resolve();
    recorder.current = null;
    setRec(false); setRecOn(false);
    send("rec", { on: false });
    track("host", false, muted);
    return new Promise((done) => {
      r.onstop = async () => {
        mixSrc.current.forEach((n) => { try { n.disconnect(); } catch {} }); mixSrc.current.clear();
        mixCtx.current?.close().catch(() => {}); mixCtx.current = null; mixDest.current = null;
        const type = (r.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];
        const secs = Math.round((Date.now() - recStart.current) / 1000);
        if (blob.size < 2000) { setMsg("The recording was too short to save."); done(); return; }
        setSaving("Saving your recording…");
        try {
          const sb = supabaseBrowser();
          const path = `${me.id}/${room.id}-${Date.now()}.${type.includes("mp4") ? "m4a" : "webm"}`;
          const up = await sb.storage.from("live-recordings").upload(path, blob, { contentType: type, upsert: false });
          if (up.error) throw up.error;
          const url = sb.storage.from("live-recordings").getPublicUrl(path).data.publicUrl;
          const { data, error } = await sb.from("live_recordings").insert({ room_id: room.id, title: room.title.slice(0, 120), path, url, duration_s: secs, size_bytes: blob.size }).select("id").single();
          if (error || !data) throw error || new Error("save");
          setSaved({ id: data.id, pinned: false }); setSaving("");
        } catch { setSaving("Couldn't save the recording. Check your connection."); }
        done();
      };
      try { r.stop(); } catch { done(); }
    });
  }
  async function pinSaved() {
    if (!saved) return;
    const sb = supabaseBrowser();
    await sb.from("live_recordings").update({ pinned: false }).eq("host_id", me.id).eq("pinned", true);
    const { error } = await sb.from("live_recordings").update({ pinned: true }).eq("id", saved.id);
    if (!error) setSaved({ ...saved, pinned: true });
  }
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRecSecs(Math.round((Date.now() - recStart.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [rec]);

  async function endRoom() {
    if (!confirm("End this live for everyone?")) return;
    if (recorder.current) await stopRec();
    send("end", {});
    await supabaseBrowser().from("live_rooms").update({ ended_at: new Date().toISOString() }).eq("id", room.id);
    setEnded(true); leave();
  }

  // ---- reactions
  const fk = useRef(0);
  function float(e: string) {
    const k = ++fk.current;
    setFloaters((f) => [...f.slice(-24), { k, e, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2600);
  }
  const react = (e: string) => { float(e); send("react", { e }); };
  const blazeT = useRef<any>(null);
  function fireBurst() {
    setFires((n) => n + 1);
    for (let i = 0; i < 9; i++) setTimeout(() => {
      const k = ++fk.current;
      setFloaters((f) => [...f.slice(-40), { k, e: "🔥", x: 4 + Math.random() * 92, big: true }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2800);
    }, i * 70);
    setBlaze(true);
    clearTimeout(blazeT.current);
    blazeT.current = setTimeout(() => setBlaze(false), 1400);
  }
  const moreFire = () => { fireBurst(); send("fire", {}); try { navigator.vibrate?.(30); } catch {} };

  const list = useMemo(() => Object.values(peers).sort((a, b) => a.at - b.at), [peers]);
  const onStage = list.filter((p) => roleOf(p.id) !== "listener").sort((a, b) => ["host", "cohost", "speaker"].indexOf(roleOf(a.id)) - ["host", "cohost", "speaker"].indexOf(roleOf(b.id)));
  const audience = list.filter((p) => roleOf(p.id) === "listener");
  const hands = audience.filter((p) => p.hand);
  const badge = { host: "Host", cohost: "Co-host", speaker: "Speaker", listener: "" } as const;

  if (ended) return (
    <div className="room card stack">
      <b>This live has ended.</b>
      <Link className="btn primary" href="/spaces">See other lives</Link>
    </div>
  );

  return (
    <div className={"lv stack" + (blaze ? " blaze" : "")} onClick={() => audios.current.forEach((a) => a.paused && a.play().catch(() => {}))}>
      <div className="lv-top">
        <span className="room-live"><i />Live</span>
        <h1>{room.title}</h1>
        <small className="muted">👥 {list.length} here{room.token && room.chain ? <> · <Link href={`/launchpad/${room.chain}/${room.token}`} target="_blank">View the coin</Link></> : null}</small>
      </div>

      {!ready ? (
        <WalletGate roomId={room.id} meId={me.id} isHost={isHost} onReady={setReady} />
      ) : !joined ? (
        <div className="lv-gate">
          <div className="lv-gate-ic" aria-hidden="true">{isHost ? "🎙️" : "🎧"}</div>
          <b>{isHost ? "You're the host" : "You're in"}</b>
          <p>{isHost ? "Your microphone starts muted." : "Listen, react and raise your hand to speak."} <small className="muted">🔒 Drops go to your wallet {ready}, only you see this.</small></p>
          <button type="button" className="btn primary" onClick={join}>{isHost ? "Start the live" : "Join the live"}</button>
        </div>
      ) : (
        <>
          {recOn && <div className="lv-rec" role="status"><i />REC{rec ? ` ${Math.floor(recSecs / 60)}:${String(recSecs % 60).padStart(2, "0")}` : ""} <small>This live is being recorded</small></div>}
          {(saving || saved) && isHost && (
            <div className="lv-saved" role="status">
              {saving || (saved?.pinned ? "📌 Pinned to your profile." : "✅ Recording saved to your profile.")}
              {saved && !saved.pinned && <button type="button" className="btn small primary" onClick={pinSaved}>📌 Pin to my profile</button>}
              {saved && <a className="btn small" href={`/members/${me.id}`} target="_blank" rel="noopener">View</a>}
            </div>
          )}
          {drop && <div className="room-drop-banner" role="status">{drop} <small>Check your wallet.</small></div>}
          {(cam || Object.keys(videos).length > 0) && (
            <section className="room-videos" aria-label="Video">
              {cam && mic.current && <VideoTile stream={mic.current} mine label="You" />}
              {Object.entries(videos).map(([id, st]) => <VideoTile key={id} stream={st} label={peers[id]?.alias || "Speaker"} />)}
            </section>
          )}

          <section className="lv-stage" aria-label="On stage">
            {onStage.map((p) => (
              <button type="button" key={p.id} className={"lv-face big" + (talking[p.id] && !p.muted ? " talking" : "")} onClick={() => setSheet(p)} aria-label={`${p.alias}, ${badge[roleOf(p.id)]}`}>
                <span className="lv-ring"><Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} /></span>
                <span className="lv-name">{p.alias}{p.ver && <VerifiedBadge n={p.vb} size={15} className="vbadge-name" />}{p.muted ? " 🔇" : ""}</span>
                <span className={"lv-role " + roleOf(p.id)}>{badge[roleOf(p.id)]}</span>
                <span className="lv-f">{fmt(followers[p.id] ?? 0)} followers</span>
              </button>
            ))}
          </section>

          {canRun && hands.length > 0 && (
            <section className="lv-hands" aria-label="Raised hands">
              <small>✋ Want to speak</small>
              {hands.map((p) => <button key={p.id} type="button" className="lv-hand" onClick={() => invite(p.id)}><Avatar className="avatar lv-av xs" alias={p.alias} color={p.color} url={p.avatar_url} /> {p.alias} · Invite</button>)}
            </section>
          )}

          <section className="lv-crowd" aria-label="Listening">
            {audience.map((p) => (
              <button type="button" key={p.id} className="lv-face" onClick={() => setSheet(p)} title={p.alias} aria-label={`${p.alias}, ${followers[p.id] ?? 0} followers`}>
                <span className="lv-ring">{p.hand && <i className="lv-handdot" aria-hidden="true">✋</i>}<Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} /></span>
                <span className="lv-f">{fmt(followers[p.id] ?? 0)}</span>
              </button>
            ))}
            {!audience.length && <small className="muted">No listeners yet. Share the link so people can join.</small>}
          </section>

          <div className="lv-floats" aria-hidden="true">{floaters.map((f) => <span key={f.k} className={f.big ? "big" : undefined} style={{ left: `${f.x}%` }}><Emo e={f.e} size={f.big ? 64 : 42} /></span>)}</div>

          <button type="button" className="lv-fire" onClick={moreFire} aria-label="More fire">
            <span className="lv-fire-ic" aria-hidden="true"><Emo e="🔥" size={46} /></span>
            <span className="lv-fire-t"><b>MORE FIRE</b><small>{fires ? `${fmt(fires)} 🔥 in this live` : "Tap to light it up"}</small></span>
          </button>

          <div className="lv-react" role="group" aria-label="React">{REACTIONS.map((e) => <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}><Emo e={e} size={30} /></button>)}</div>

          {canRun && <DropPanel roomId={room.id} onDropped={(text) => { setDrop(text); send("drop", { text }); }} />}

          <div className="room-bar lv-bar">
            {canSpeak ? (
              <button type="button" className={"room-btn" + (muted ? "" : " on")} onClick={toggleMute}>{muted ? "🎙️ Unmute" : "🔴 Mute"}</button>
            ) : (
              <button type="button" className={"room-btn" + (hand ? " on" : "")} onClick={raiseHand}>{hand ? "Lower hand" : "✋ Raise hand"}</button>
            )}
            {canSpeak && <button type="button" className={"room-btn" + (cam ? " on" : "")} onClick={toggleCam}>{cam ? "Camera off" : "🎥 Camera"}</button>}
            {isHost && <button type="button" className={"room-btn rec" + (rec ? " on" : "")} onClick={() => (rec ? stopRec() : startRec())}>{rec ? "⏹ Stop recording" : "🔴 Record"}</button>}
            {isHost && <a className="room-btn" href="/launchpad/new" target="_blank" rel="noopener">🚀 Launch</a>}
            <button type="button" className="room-btn" onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setMsg("Link copied. Share it so people can join.")).catch(() => {}); }}>🔗 Share</button>
            {isHost ? <button type="button" className="room-btn end" onClick={endRoom}>End live</button>
              : <button type="button" className="room-btn" onClick={leave}>Leave</button>}
          </div>
        </>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
      {joined && <small className="lv-credit">Animated emoji: <a href="https://googlefonts.github.io/noto-emoji-animation/" target="_blank" rel="noopener noreferrer">Noto Emoji by Google</a>, CC BY 4.0.</small>}

      {sheet && (
        <ProfileSheet id={sheet.id} alias={sheet.alias} onClose={() => setSheet(null)} act={{
          role: roleOf(sheet.id), canRun, isHost,
          invite: () => { invite(sheet.id); setSheet(null); },
          moveDown: () => { moveDown(sheet.id); setSheet(null); },
          makeCohost: () => { makeCohost(sheet.id); setSheet(null); },
          removeCohost: () => { removeCohost(sheet.id); setSheet(null); },
          send: () => { setSendTo({ id: sheet.id, alias: sheet.alias }); setSheet(null); },
        }} />
      )}
      {sendTo && (
        <div className="lv-sheet-wrap" role="presentation" onClick={() => setSendTo(null)}>
          <div className="lv-sheet" onClick={(e) => e.stopPropagation()}>
            <DropPanel key={sendTo.id} roomId={room.id} target={sendTo} button={false} onClose={() => setSendTo(null)}
              onDropped={(text) => { setDrop(text); send("drop", { text }); }} />
          </div>
        </div>
      )}
    </div>
  );
}
