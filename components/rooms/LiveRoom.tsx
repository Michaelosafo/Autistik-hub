"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";

type Me = { id: string; alias: string; color: string | null; avatar_url: string | null };
type Role = "host" | "speaker" | "listener";
type Peer = { id: string; alias: string; color: string | null; avatar_url: string | null; role: Role; hand: boolean; muted: boolean; at: number };
type Room = { id: string; title: string; host_id: string; ended_at: string | null };

const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }] };
const MAX_SPEAKERS = 6;

/**
 * A live audio room, like an X Space. The host and up to 5 invited speakers talk; everyone signed in can listen,
 * raise a hand and be invited up. Audio goes straight between browsers (WebRTC); the site only passes the
 * connection messages (Supabase Realtime). Nothing is recorded.
 */
export default function LiveRoom({ room, me }: { room: Room; me: Me }) {
  const isHost = me.id === room.host_id;
  const [joined, setJoined] = useState(false);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [speakers, setSpeakers] = useState<string[]>([room.host_id]); // decided by the host
  const [hand, setHand] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(!!room.ended_at);
  const [msg, setMsg] = useState("");
  const [talking, setTalking] = useState<Record<string, boolean>>({});

  const chan = useRef<any>(null);
  const mic = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>()); // key: "from>to"
  const audios = useRef(new Map<string, HTMLAudioElement>());
  const speakersRef = useRef(speakers);
  speakersRef.current = speakers;

  const myRole: Role = isHost ? "host" : speakers.includes(me.id) ? "speaker" : "listener";
  const canSpeak = myRole !== "listener";

  function send(event: string, payload: any) { chan.current?.send({ type: "broadcast", event, payload: { ...payload, from: me.id } }); }

  function closePc(key: string) {
    const pc = pcs.current.get(key);
    if (pc) { try { pc.close(); } catch {} pcs.current.delete(key); }
    const a = audios.current.get(key);
    if (a) { a.srcObject = null; a.remove(); audios.current.delete(key); }
  }

  function newPc(key: string, remote: string) {
    closePc(key);
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(key, pc);
    pc.onicecandidate = (e) => { if (e.candidate) send("ice", { to: remote, key, candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      let a = audios.current.get(key);
      if (!a) { a = document.createElement("audio"); a.autoplay = true; (a as any).playsInline = true; document.body.appendChild(a); audios.current.set(key, a); }
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      a.play().catch(() => setMsg("Tap anywhere to hear the room."));
      watchLevel(remote, a.srcObject as MediaStream);
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") closePc(key); };
    return pc;
  }

  // I'm a speaker: send my microphone to one person.
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
  function stopMic() {
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    levels.current.get(me.id)?.();
    for (const k of [...pcs.current.keys()]) if (k.startsWith(`${me.id}>`)) closePc(k);
  }

  async function join() {
    setMsg("");
    const sb = supabaseBrowser();
    const ch = sb.channel(`room:${room.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    chan.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, any[]>;
      const next: Record<string, Peer> = {};
      for (const [id, metas] of Object.entries(st)) { const m = metas[metas.length - 1]; if (m) next[id] = { id, alias: m.alias, color: m.color, avatar_url: m.avatar_url, role: m.role, hand: !!m.hand, muted: !!m.muted, at: m.at || 0 }; }
      setPeers(next);
      // People who left: drop their audio.
      for (const k of [...pcs.current.keys()]) { const [a, b] = k.split(">"); if (!next[a] || !next[b]) closePc(k); }
      // The host's list of speakers is the one that counts.
      const h = st[room.host_id]?.[0];
      if (h?.speakers && !isHost) setSpeakers(h.speakers);
    });
    ch.on("broadcast", { event: "offer" }, async ({ payload }: any) => {
      if (payload.to !== me.id || !speakersRef.current.includes(payload.from)) return; // audio only from the host's speakers
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
    ch.on("broadcast", { event: "speakers" }, ({ payload }: any) => {
      if (payload.from !== room.host_id) return;
      setSpeakers(payload.speakers);
    });
    ch.on("broadcast", { event: "end" }, ({ payload }: any) => { if (payload.from === room.host_id) { setEnded(true); leave(); } });
    ch.subscribe(async (status: string) => {
      if (status !== "SUBSCRIBED") { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setMsg("Couldn't connect to the room. Check your internet and try again."); return; }
      if (isHost) await startMic();
      await track(isHost ? "host" : "listener", false, true);
      setJoined(true);
    });
  }

  async function track(role: Role, h: boolean, m: boolean) {
    await chan.current?.track({ alias: me.alias, color: me.color, avatar_url: me.avatar_url, role, hand: h, muted: m, at: Date.now(), ...(isHost ? { speakers: speakersRef.current } : {}) });
  }

  // My role changed (invited up or moved down): start or stop sending my voice.
  useEffect(() => {
    if (!joined) return;
    (async () => {
      if (canSpeak) {
        if (await startMic()) Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
        setPeers((p) => ({ ...p })); // let the effect below reach anyone missed
        setHand(false);
      } else if (mic.current) stopMic();
      await track(myRole, canSpeak ? false : hand, muted);
    })();
  }, [joined, myRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every speaker sends their voice to everyone in the room, including people who join later.
  useEffect(() => {
    if (!joined || !canSpeak || !mic.current) return;
    Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
  }, [peers, joined, canSpeak]); // eslint-disable-line react-hooks/exhaustive-deps

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
  async function setSpeakerList(list: string[]) {
    setSpeakers(list); speakersRef.current = list;
    send("speakers", { speakers: list });
    await track("host", false, muted);
  }
  const invite = (id: string) => { if (speakers.length >= MAX_SPEAKERS) { setMsg(`Up to ${MAX_SPEAKERS} speakers at a time.`); return; } setSpeakerList([...speakers, id]); };
  const moveDown = (id: string) => setSpeakerList(speakers.filter((s) => s !== id));
  async function endRoom() {
    if (!confirm("End this live for everyone?")) return;
    send("end", {});
    await supabaseBrowser().from("live_rooms").update({ ended_at: new Date().toISOString() }).eq("id", room.id);
    setEnded(true); leave();
  }

  const list = useMemo(() => Object.values(peers).sort((a, b) => a.at - b.at), [peers]);
  const onStage = list.filter((p) => p.id === room.host_id || speakers.includes(p.id));
  const audience = list.filter((p) => !onStage.includes(p));
  const hands = audience.filter((p) => p.hand);

  if (ended) return (
    <div className="room card stack">
      <b>This live has ended.</b>
      <Link className="btn primary" href="/spaces">See other lives</Link>
    </div>
  );

  return (
    <div className="room stack" onClick={() => audios.current.forEach((a) => a.paused && a.play().catch(() => {}))}>
      <div className="room-top">
        <span className="room-live"><i />Live</span>
        <h1>{room.title}</h1>
        <small className="muted">{list.length} {list.length === 1 ? "person" : "people"} here</small>
      </div>

      {!joined ? (
        <div className="card stack" style={{ alignItems: "center", textAlign: "center" }}>
          <p style={{ margin: 0 }}>{isHost ? "Start your live. Your microphone starts muted." : "Join to listen. You can raise your hand to speak."}</p>
          <button type="button" className="btn primary" onClick={join}>{isHost ? "Start the live" : "Join and listen"}</button>
        </div>
      ) : (
        <>
          <section className="room-stage" aria-label="Speakers">
            {onStage.map((p) => (
              <div key={p.id} className={"room-person" + (talking[p.id] && !p.muted ? " talking" : "")}>
                <Avatar className="me-av" alias={p.alias} color={p.color} url={p.avatar_url} />
                <b>{p.alias}</b>
                <small>{p.id === room.host_id ? "Host" : "Speaker"}{p.muted ? " · muted" : ""}</small>
                {isHost && p.id !== me.id && <button type="button" className="room-mini" onClick={() => moveDown(p.id)}>Move to listeners</button>}
              </div>
            ))}
          </section>

          {isHost && hands.length > 0 && (
            <section className="room-hands card stack" aria-label="Raised hands">
              <b>Want to speak</b>
              {hands.map((p) => (
                <div key={p.id} className="room-hand"><span>{p.alias}</span><button type="button" className="btn small primary" onClick={() => invite(p.id)}>Invite to speak</button></div>
              ))}
            </section>
          )}

          <section className="room-audience" aria-label="Listeners">
            <small className="muted">Listening</small>
            <div className="room-grid">
              {audience.map((p) => (
                <div key={p.id} className="room-person small">
                  <Avatar className="me-av" alias={p.alias} color={p.color} url={p.avatar_url} />
                  <small>{p.alias}{p.hand ? " · hand up" : ""}</small>
                  {isHost && <button type="button" className="room-mini" onClick={() => invite(p.id)}>Invite</button>}
                </div>
              ))}
              {!audience.length && <small className="muted">No listeners yet. Share this page so people can join.</small>}
            </div>
          </section>

          <div className="room-bar">
            {canSpeak ? (
              <button type="button" className={"room-btn" + (muted ? "" : " on")} onClick={toggleMute}>{muted ? "Unmute" : "Mute"}</button>
            ) : (
              <button type="button" className={"room-btn" + (hand ? " on" : "")} onClick={raiseHand}>{hand ? "Lower hand" : "Raise hand"}</button>
            )}
            <button type="button" className="room-btn" onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setMsg("Link copied. Share it so people can join.")).catch(() => {}); }}>Share</button>
            {isHost ? <button type="button" className="room-btn end" onClick={endRoom}>End live</button>
              : <button type="button" className="room-btn" onClick={leave}>Leave</button>}
          </div>
        </>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
