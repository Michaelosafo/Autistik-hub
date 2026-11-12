"use client";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import LiveWallet from "./LiveWallet";
import type { Member } from "@/components/wallet/types";
import ProfileSheet from "@/components/rooms/ProfileSheet";
import VerifiedBadge from "@/components/VerifiedBadge";
import Emo from "@/components/Emo";
import SpeakerOut from "./SpeakerOut";
import Ctl, { MicBtn } from "./Ctl";
import LiveChatRaw from "./LiveChat";
import WalletGate from "@/components/rooms/WalletGate";
import { supabaseBrowser } from "@/lib/supabase/client";

export type LiveMe = { id: string; alias: string; color: string | null; avatar_url: string | null; is_verified?: boolean; verified_badge?: number | null;
  /** For the wallet in the room: the built-in wallet's app ID and the member's wallet details. */
  wallet?: { appId: string | null; member: Member | null } };
export type LiveRoomInfo = { id: string; title: string; host_id: string; ended_at: string | null; chain?: string | null; token?: string | null; cohosts?: string[] | null; speakers?: string[] | null };
type Me = LiveMe;
type Room = LiveRoomInfo;
type Role = "host" | "cohost" | "speaker" | "listener";
type Peer = { id: string; alias: string; color: string | null; avatar_url: string | null; role: Role; hand: boolean; muted: boolean; at: number; ver?: boolean; vb?: number | null };

// Connection helpers. STUN finds each phone's public address; a TURN relay (from /api/rooms/ice, when set up) carries
// the voice when two networks won't connect directly, which is common on mobile data.
const STUN: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, { urls: "stun:stun.cloudflare.com:3478" }];
let ICE: RTCConfiguration = { iceServers: STUN };
let iceAt = 0;
async function loadIce() {
  if (Date.now() - iceAt < 10 * 60_000) return;
  try {
    const j = await fetch("/api/rooms/ice").then((r) => r.json());
    if (Array.isArray(j?.iceServers) && j.iceServers.length) { ICE = { iceServers: [...STUN, ...j.iceServers] }; iceAt = Date.now(); }
  } catch { /* STUN only */ }
}
// The chat holds hundreds of messages: only redraw it when its own inputs change (not on every voice level tick).
const LiveChat = memo(LiveChatRaw);
const MAX_STAGE = 8; // host + co-hosts + speakers
const MAX_COHOSTS = 3;
const REACTIONS = ["🚀", "💎", "❤️", "😂", "👏", "🔥"];
const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A tiny silent sound, played on the Join tap so phones (iPhone especially) let the room's voices play later. */
const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
/** Remembers the live you're in, so coming back to the site takes you straight back in. */
export const LIVE_KEY = "live-in";
export function rememberLive(id: string, title: string) { try { localStorage.setItem(LIVE_KEY, JSON.stringify({ id, title, t: Date.now() })); } catch {} }
export function forgetLive(id?: string) { try { const c = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); if (!id || c?.id === id) localStorage.removeItem(LIVE_KEY); } catch {} }
export function rememberedLive(): { id: string; title: string; t: number } | null {
  try { const c = JSON.parse(localStorage.getItem(LIVE_KEY) || "null"); return c && Date.now() - c.t < 8 * 3600e3 ? c : null; } catch { return null; }
}

/** A live video tile (a speaker's camera). */
function VideoTile({ stream, mine, label }: { stream: MediaStream; mine?: boolean; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  // Muted: the voice already plays through the room's audio (and your own would echo).
  return <div className="room-video"><video ref={ref} autoPlay playsInline muted style={mine ? { transform: "scaleX(-1)" } : undefined} /><small>{label}</small></div>;
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {off ? <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" />
        : <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}
    </svg>
  );
}

/**
 * A live room (voice, camera optional for coin lives).
 *  - Everyone joins with a wallet linked to their account (WalletGate), kept private, so the host can drop tokens.
 *  - Listeners speak only when the host (or a co-host) invites them, or when the host turns on Open mic.
 *  - The host can mute one speaker or everyone, make up to 3 co-hosts, and record the live (saved to their profile,
 *    the room's page, and their own device).
 *  - Comments, pictures and emoji go in the room's chat, kept after the live ends.
 *  - The live keeps playing while you move around the site (LiveDock shows a small player), and coming back to the
 *    site takes you back into a live you didn't leave.
 * Voice and video go straight between browsers (WebRTC); the site only passes the connection messages (Supabase
 * Realtime).
 */
export default function LiveRoom({ room, me, mini = false, autoJoin = false, onState }: {
  room: Room; me: Me; mini?: boolean; autoJoin?: boolean; onState?: (s: { joined: boolean; ended: boolean }) => void;
}) {
  const isHost = me.id === room.host_id;
  // Video is for lives about a coin launch (rooms linked to a coin); other lives are voice only.
  const coinLive = !!(room.token && room.chain);
  const [ready, setReady] = useState<string | null>(null); // my wallet is linked (short address, shown only to me)
  const [myAddr, setMyAddr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [speakers, setSpeakers] = useState<string[]>([...new Set([room.host_id, ...(room.speakers || [])])]);
  const [cohosts, setCohosts] = useState<string[]>(room.cohosts || []);
  const [openMic, setOpenMic] = useState(false); // host setting: anyone can come up to speak without waiting
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
  const [needTap, setNeedTap] = useState(false);
  // 🔥 MORE FIRE: the room's signature reaction. Everyone sees a burst of flames and the counter climbs.
  const [fires, setFires] = useState(0);
  const [blaze, setBlaze] = useState(false);
  // Recording (host only): everyone's voice mixed into one audio file, saved when stopped.
  const [rec, setRec] = useState(false); // I'm recording (host)
  const [recOn, setRecOn] = useState(false); // the room is being recorded (everyone sees 🔴 REC)
  const [recSecs, setRecSecs] = useState(0);
  const [saved, setSaved] = useState<{ id: string; pinned: boolean; url: string } | null>(null);
  const [saving, setSaving] = useState("");
  const [local, setLocal] = useState<{ url: string; name: string } | null>(null); // the last recording, to save on this device

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
  const pool = useRef<HTMLAudioElement[]>([]);
  const allAudios = useCallback(() => [...audios.current.values()], []);
  const speakersRef = useRef(speakers);
  speakersRef.current = speakers;
  const cohostsRef = useRef(cohosts);
  cohostsRef.current = cohosts;
  const openRef = useRef(openMic);
  openRef.current = openMic;
  const joinedRef = useRef(joined);
  const peersRef = useRef(peers);
  peersRef.current = peers;
  joinedRef.current = joined;

  const isCohost = cohosts.includes(me.id);
  const canRun = isHost || isCohost;
  const roleOf = useCallback((id: string): Role => (id === room.host_id ? "host" : cohosts.includes(id) ? "cohost" : speakers.includes(id) ? "speaker" : "listener"), [room.host_id, cohosts, speakers]);
  const myRole = roleOf(me.id);
  const canSpeak = myRole !== "listener";
  const onStageNow = (id: string) => id === room.host_id || speakersRef.current.includes(id) || cohostsRef.current.includes(id);

  useEffect(() => { onState?.({ joined, ended }); }, [joined, ended]); // eslint-disable-line react-hooks/exhaustive-deps

  function send(event: string, payload: any) { chan.current?.send({ type: "broadcast", event, payload: { ...payload, from: me.id } }); }

  // ---- sound out: a few audio players made on the Join tap, so phones allow them to play the voices later.
  function makeAudio() {
    const a = document.createElement("audio");
    a.autoplay = true; (a as any).playsInline = true; a.setAttribute("playsinline", "");
    a.style.display = "none";
    document.body.appendChild(a);
    return a;
  }
  function unlockAudio() {
    while (pool.current.length + audios.current.size < MAX_STAGE + 2) pool.current.push(makeAudio());
    for (const a of pool.current) { if (!a.srcObject) { a.src = SILENT; a.play().catch(() => {}); } }
    for (const a of audios.current.values()) if (a.paused) a.play().catch(() => {});
    try { const c = meterCtx(); if (c.state === "suspended") c.resume().catch(() => {}); } catch {}
    setNeedTap(false);
  }
  function takeAudio() {
    const a = pool.current.pop() || makeAudio();
    a.pause(); a.removeAttribute("src");
    return a;
  }
  function giveBack(a: HTMLAudioElement) {
    try { a.pause(); } catch {}
    a.srcObject = null; a.muted = false;
    pool.current.push(a);
  }

  function closePc(key: string) {
    const pc = pcs.current.get(key);
    if (pc) { try { pc.close(); } catch {} pcs.current.delete(key); }
    pendingIce.current.delete(key);
    const a = audios.current.get(key);
    if (a) { audios.current.delete(key); giveBack(a); }
    voices.current.delete(key);
    try { mixSrc.current.get(key)?.disconnect(); } catch {}
    mixSrc.current.delete(key);
    const [from, to] = key.split(">");
    if (to === me.id) {
      setVideos((v) => { if (!v[from]) return v; const n = { ...v }; delete n[from]; return n; });
      levels.current.get(from)?.(); levels.current.delete(from);
    }
  }

  // Connection details that arrive before the other side's offer/answer is applied wait here.
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const retries = useRef(new Map<string, number>());
  async function flushIce(key: string, pc: RTCPeerConnection) {
    const q = pendingIce.current.get(key);
    pendingIce.current.delete(key);
    for (const c of q || []) await pc.addIceCandidate(c).catch(() => {});
  }

  function retry(key: string, to: string) {
    const n = (retries.current.get(key) || 0) + 1;
    if (n > 5 || !mic.current || !joinedRef.current) return false;
    retries.current.set(key, n);
    callPeer(to);
    return true;
  }

  function newPc(key: string, remote: string) {
    closePc(key);
    const pc = new RTCPeerConnection(ICE);
    pcs.current.set(key, pc);
    // Connection details go out in small batches (one message instead of many), which keeps the room under the
    // message server's rate limits when lots of people join at once.
    let batch: RTCIceCandidateInit[] = [], bt: ReturnType<typeof setTimeout> | null = null;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      batch.push(e.candidate.toJSON());
      if (!bt) bt = setTimeout(() => { const c = batch; batch = []; bt = null; send("ice", { to: remote, key, candidates: c }); }, 150);
    };
    pc.ontrack = (e) => {
      if (e.track.kind === "video") {
        const st = e.streams[0] || new MediaStream([e.track]);
        setVideos((v) => ({ ...v, [remote]: st }));
        e.track.onended = () => setVideos((v) => { const n = { ...v }; delete n[remote]; return n; });
        return;
      }
      let a = audios.current.get(key);
      if (!a) { a = takeAudio(); audios.current.set(key, a); }
      a.srcObject = e.streams[0] || new MediaStream([e.track]);
      voices.current.set(key, a.srcObject as MediaStream);
      if (recorder.current) mixIn(key, a.srcObject as MediaStream);
      a.play().catch(() => { setNeedTap(true); });
      watchLevel(remote, a.srcObject as MediaStream);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") { retries.current.delete(key); return; }
      if (st !== "failed" && st !== "disconnected") return;
      // A short drop (switching networks, weak signal): heal the same link first, so the voice doesn't cut out.
      const [f0, t0] = key.split(">");
      if (st === "disconnected" && f0 === me.id) setTimeout(() => { if (pcs.current.get(key) === pc && pc.connectionState === "disconnected") healPc(key, t0, pc); }, 1500);
      // A dropped or failed voice link: the sender calls again (a few times, a little later each time).
      setTimeout(() => {
        if (pcs.current.get(key) !== pc || pc.connectionState === "connected") return;
        const [from, to] = key.split(">");
        if (from === me.id && retry(key, to)) return;
        if (pc.connectionState === "failed") { closePc(key); if (to === me.id) setMsg("A voice couldn't connect on this network. Try Wi-Fi, or leave and rejoin."); }
      }, st === "failed" ? 800 : 4000);
    };
    return pc;
  }

  /** Re-route an existing voice link (new network paths) without hanging up: no gap in the sound when it works. */
  async function healPc(key: string, to: string, pc: RTCPeerConnection) {
    try {
      await loadIce();
      pc.setConfiguration?.(ICE);
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      send("offer", { to, key, sdp: pc.localDescription, heal: true });
    } catch { /* the slower full re-call below still runs */ }
  }

  // I'm on stage: send my microphone (and camera, if on) to one person.
  async function callPeer(to: string) {
    if (!mic.current || to === me.id) return;
    await loadIce();
    if (!mic.current) return;
    const key = `${me.id}>${to}`;
    const pc = newPc(key, to);
    mic.current.getTracks().forEach((t) => pc.addTrack(t, mic.current!));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send("offer", { to, key, sdp: pc.localDescription });
    // No answer (the message got lost, or they weren't ready yet): call again.
    setTimeout(() => { if (pcs.current.get(key) === pc && pc.signalingState === "have-local-offer") retry(key, to); }, 6000);
  }

  // Who's talking: a simple loudness meter per voice, all on one shared audio engine (phones allow only a few).
  const meter = useRef<AudioContext | null>(null);
  function meterCtx() {
    if (!meter.current) meter.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return meter.current;
  }
  const levels = useRef(new Map<string, () => void>());
  function watchLevel(id: string, stream: MediaStream) {
    levels.current.get(id)?.();
    try {
      const ctx = meterCtx();
      const an = ctx.createAnalyser(); an.fftSize = 256;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const t = setInterval(() => {
        an.getByteFrequencyData(buf);
        const v = buf.reduce((s, x) => s + x, 0) / buf.length;
        // Turns on above 18, off only below 10: the glow doesn't flicker between words.
        setTalking((m) => { const was = !!m[id]; const now = was ? v > 10 : v > 18; return was === now ? m : { ...m, [id]: now }; });
      }, 300);
      levels.current.set(id, () => { clearInterval(t); try { src.disconnect(); } catch {} });
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
    if (!mic.current || (!cam && !coinLive)) return;
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
    if (chan.current) return;
    if (!joinedRef.current) { if (joining) return; setMsg(""); setJoining(true); }
    unlockAudio();
    const sb = supabaseBrowser();
    const ch = sb.channel(`room:${room.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    chan.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, any[]>;
      const next: Record<string, Peer> = {};
      for (const [id, metas] of Object.entries(st)) { const m = metas[metas.length - 1]; if (m) next[id] = { id, alias: m.alias, color: m.color, avatar_url: m.avatar_url, role: m.role, hand: !!m.hand, muted: !!m.muted, at: m.at || 0, ver: !!m.ver, vb: m.vb ?? null }; }
      setPeers(next);
      // Presence can blink (a reconnect, a phone switching network): only hang up on someone still gone 15s later.
      const gone = [...pcs.current.keys()].filter((k) => { const [a, b] = k.split(">"); return !next[a] || !next[b]; });
      if (gone.length) setTimeout(() => {
        if (!live.current) return; // reconnecting to the room: the voices keep playing meanwhile
        const now = (chan.current?.presenceState?.() || {}) as Record<string, unknown>;
        for (const k of gone) { const [a, b] = k.split(">"); if (!now[a] || !now[b]) closePc(k); }
      }, 15000);
      // The host's lists of speakers and co-hosts are the ones that count.
      const h = st[room.host_id]?.[st[room.host_id].length - 1];
      if (h && !isHost) {
        if (h.speakers) { setSpeakers(h.speakers); speakersRef.current = h.speakers; }
        if (h.cohosts) { setCohosts(h.cohosts); cohostsRef.current = h.cohosts; }
        setRecOn(!!h.rec);
        setOpenMic(!!h.open);
      }
    });
    ch.on("broadcast", { event: "offer" }, async ({ payload }: any) => {
      if (payload.to !== me.id) return;
      // Voice only from people on stage. A new speaker's call can arrive a moment before the news that they were
      // invited up: wait a few seconds for it instead of dropping the call (that left people unable to hear them).
      for (let i = 0; i < 25 && !onStageNow(payload.from); i++) await sleep(300);
      if (!onStageNow(payload.from) || !chan.current) return;
      await loadIce();
      const old = pcs.current.get(payload.key);
      const heal = !!payload.heal && old && old.signalingState === "stable";
      const early = pendingIce.current.get(payload.key);
      const pc = heal ? old! : newPc(payload.key, payload.from);
      if (early && !heal) pendingIce.current.set(payload.key, early);
      try {
        await pc.setRemoteDescription(payload.sdp);
        await flushIce(payload.key, pc);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        send("answer", { to: payload.from, key: payload.key, sdp: pc.localDescription });
      } catch { closePc(payload.key); }
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }: any) => {
      if (payload.to !== me.id) return;
      const pc = pcs.current.get(payload.key);
      if (pc && pc.signalingState === "have-local-offer") { await pc.setRemoteDescription(payload.sdp).catch(() => {}); await flushIce(payload.key, pc); }
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }: any) => {
      if (payload.to !== me.id) return;
      const pc = pcs.current.get(payload.key);
      const list: RTCIceCandidateInit[] = Array.isArray(payload.candidates) ? payload.candidates : payload.candidate ? [payload.candidate] : [];
      // Not ready yet (no offer/answer applied, or the call hasn't started here): keep them for a moment.
      if (!pc || !pc.remoteDescription) {
        const q = pendingIce.current.get(payload.key) || [];
        for (const c of list) if (q.length < 80) q.push(c);
        pendingIce.current.set(payload.key, q);
        return;
      }
      for (const c of list) await pc.addIceCandidate(c).catch(() => {});
    });
    // The host and co-hosts run the stage.
    ch.on("broadcast", { event: "speakers" }, ({ payload }: any) => {
      if (!runners().includes(payload.from)) return;
      setSpeakers(payload.speakers); speakersRef.current = payload.speakers;
      if (isHost) track("host", false, mutedRef.current);
    });
    ch.on("broadcast", { event: "cohosts" }, ({ payload }: any) => { if (payload.from === room.host_id) { setCohosts(payload.cohosts); cohostsRef.current = payload.cohosts; } });
    ch.on("broadcast", { event: "open" }, ({ payload }: any) => { if (payload.from === room.host_id) setOpenMic(!!payload.on); });
    // Muted by the host or a co-host (one person, or everyone on stage). You can unmute again yourself.
    ch.on("broadcast", { event: "mute" }, ({ payload }: any) => {
      if (!runners().includes(payload.from) || (payload.to !== me.id && payload.to !== "*") || payload.from === me.id) return;
      if (payload.to === "*" && me.id === room.host_id) return;
      if (!mutedRef.current) { setMicOn(false); setMsg(payload.to === "*" ? "The host muted everyone. Tap your mic to talk again." : "The host muted you. Tap your mic to talk again."); }
    });
    ch.on("broadcast", { event: "cam" }, ({ payload }: any) => {
      if (payload.on === false) setVideos((v) => { const n = { ...v }; delete n[payload.from]; return n; });
    });
    ch.on("broadcast", { event: "drop" }, ({ payload }: any) => { if (peersRef.current[payload.from]) setDrop(String(payload.text || "").slice(0, 160)); });
    ch.on("broadcast", { event: "fire" }, () => fireBurst());
    ch.on("broadcast", { event: "lower" }, ({ payload }: any) => {
      if (!runners().includes(payload.from) || payload.to !== me.id) return;
      setHand(false); track(myRoleRef.current, false, true); setMsg("The host can't bring you up right now. You can request again later.");
    });
    ch.on("broadcast", { event: "rec" }, ({ payload }: any) => { if (payload.from === room.host_id) setRecOn(!!payload.on); });
    ch.on("broadcast", { event: "react" }, ({ payload }: any) => { if (REACTIONS.includes(payload.e)) float(payload.e); });
    ch.on("broadcast", { event: "end" }, ({ payload }: any) => { if (payload.from === room.host_id) { setEnded(true); leave(); } });
    ch.subscribe(async (status: string) => {
      if (chan.current !== ch) return; // an old connection (left, or replaced by a fresh one)
      if (status !== "SUBSCRIBED") {
        live.current = false;
        if (!joinedRef.current) {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { setMsg("Couldn't connect to the room. Check your internet and try again."); setJoining(false); try { ch.unsubscribe(); } catch {} chan.current = null; }
          return;
        }
        // Already in the live: a network blip. The voices keep playing (they go phone to phone); the room
        // connection rejoins by itself, and if it hasn't in 12 seconds it's replaced with a fresh one.
        setMsg("Reconnecting to the live…");
        clearTimeout(watchdog.current);
        watchdog.current = setTimeout(() => { if (!live.current && chan.current === ch && joinedRef.current) rejoin(); }, 12_000);
        return;
      }
      live.current = true;
      clearTimeout(watchdog.current);
      if (joinedRef.current) { setMsg(""); await track(myRoleRef.current, false, mutedRef.current); return; } // reconnected
      if (isHost) await startMic();
      if (isHost) { try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {}); } catch {} }
      await track(isHost ? "host" : "listener", false, true);
      setJoined(true); setJoining(false);
      rememberLive(room.id, room.title);
      if (isHost) setMsg("You're live but muted. Tap the mic under your picture to talk.");
    });
  }

  // The room connection is up (presence and messages flowing); a watchdog replaces it if a blip lasts too long.
  const live = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A fresh room connection without leaving: your mic and the voices you hear keep going. */
  function rejoin() {
    const old = chan.current;
    chan.current = null;
    try { old?.unsubscribe(); } catch {}
    setJoining(false);
    join();
  }
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const myRoleRef = useRef(myRole);
  myRoleRef.current = myRole;
  async function track(role: Role, h: boolean, m: boolean) {
    await chan.current?.track({ alias: me.alias, color: me.color, avatar_url: me.avatar_url, ver: !!me.is_verified, vb: me.verified_badge ?? null, role, hand: h, muted: m, at: Date.now(), ...(isHost ? { speakers: speakersRef.current, cohosts: cohostsRef.current, rec: !!recorder.current, open: openRef.current } : {}) });
  }

  // Back to the site after leaving it: go straight back into the live you were in.
  useEffect(() => { if (autoJoin && ready && !joined && !ended && !chan.current) join(); }, [autoJoin, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Listeners are in the room the moment they open it: they show in the list and hear the voices straight away.
  // (Linking a wallet is only needed for drops, offered inside the room, never a wall in front of it.)
  useEffect(() => { if (!isHost && !mini && !joined && !ended && !chan.current) join(); }, [isHost, mini]); // eslint-disable-line react-hooks/exhaustive-deps

  // My role changed (invited up or moved down): start or stop sending my voice.
  const wasSpeaker = useRef(false);
  useEffect(() => {
    if (!joined) return;
    (async () => {
      if (canSpeak) {
        if (await startMic()) Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
        setPeers((p) => ({ ...p }));
        setHand(false);
        if (!isHost && !wasSpeaker.current) setMsg("You're on stage. Tap the mic under your picture to talk.");
      } else if (mic.current) { stopMic(); setMuted(true); if (wasSpeaker.current) setMsg("You're listening again."); }
      wasSpeaker.current = canSpeak;
      await track(myRole, canSpeak ? false : hand, canSpeak ? mutedRef.current : true);
    })();
  }, [joined, myRole]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everyone on stage sends their voice to everyone in the room, including people who join later.
  useEffect(() => {
    if (!joined || !canSpeak || !mic.current) return;
    Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
  }, [peers, joined, canSpeak]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone moved back to listening: stop playing their voice here.
  useEffect(() => {
    for (const k of [...pcs.current.keys()]) { const [from, to] = k.split(">"); if (to === me.id && !onStageNow(from)) closePc(k); }
  }, [speakers, cohosts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follower counts for the pictures (public numbers), fetched for new faces only.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const fresh = Object.keys(peers).filter((id) => !asked.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => asked.current.add(id));
    fetch(`/api/rooms/followers?ids=${fresh.slice(0, 80).join(",")}`).then((r) => r.json()).then((m) => setFollowers((f) => ({ ...f, ...m }))).catch(() => {});
  }, [peers]);

  // Lock screen / notification shade: show what's playing, so the phone treats the live like a call or a podcast.
  useEffect(() => {
    const ms = (navigator as any).mediaSession;
    if (!ms || typeof (window as any).MediaMetadata === "undefined") return;
    if (joined) {
      try { ms.metadata = new (window as any).MediaMetadata({ title: room.title, artist: "AUTISTIK Live", artwork: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] }); ms.playbackState = "playing"; } catch {}
    } else { try { ms.metadata = null; ms.playbackState = "none"; } catch {} }
  }, [joined, room.title]);

  // Keep the screen on while you're in a live, so the phone doesn't sleep and drop you after a few minutes.
  const wake = useRef<any>(null);
  function keepAwake() {
    try { if (!wake.current && (navigator as any).wakeLock) (navigator as any).wakeLock.request("screen").then((w: any) => { wake.current = w; w.addEventListener?.("release", () => { wake.current = null; }); }).catch(() => {}); } catch {}
  }
  useEffect(() => { if (joined) keepAwake(); }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the page after the phone was locked or the app was in the background: wake the sound up.
  useEffect(() => {
    if (!joined) return;
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      audios.current.forEach((a) => { if (a.paused) a.play().catch(() => setNeedTap(true)); });
      if (meter.current?.state === "suspended") meter.current.resume().catch(() => {});
      if (!live.current && chan.current) { clearTimeout(watchdog.current); watchdog.current = setTimeout(() => { if (!live.current && joinedRef.current) rejoin(); }, 3_000); }
      if (joinedRef.current) keepAwake();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("pageshow", wake); };
  }, [joined]);

  function leave(forget = true) {
    clearTimeout(watchdog.current); live.current = false;
    try { wake.current?.release(); } catch {} wake.current = null;
    stopMic();
    for (const k of [...pcs.current.keys()]) closePc(k);
    levels.current.forEach((f) => f()); levels.current.clear();
    try { chan.current?.unsubscribe(); } catch {}
    chan.current = null;
    setJoined(false); setJoining(false); setPeers({}); setHand(false);
    if (forget) forgetLive(room.id);
  }
  useEffect(() => () => {
    if (recorder.current) { try { recorder.current.stop(); } catch {} }
    leave(false);
    for (const a of pool.current) a.remove();
    pool.current = [];
    meter.current?.close().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function setMicOn(on: boolean) {
    mic.current?.getAudioTracks().forEach((t) => (t.enabled = on));
    setMuted(!on); mutedRef.current = !on;
    track(myRoleRef.current, false, !on);
  }
  function toggleMute() {
    if (!canSpeak) return;
    if (!mic.current) { startMic().then((ok) => ok && setMicOn(true)); return; }
    setMicOn(!!mutedRef.current);
  }
  function raiseHand() { const h = !hand; setHand(h); track(myRole, h, true); if (h) setMsg(openMic ? "Coming up to speak…" : "Request sent ✋ The host will see it and can bring you up."); }

  // ---- running the stage (host and co-hosts)
  async function setSpeakerList(list: string[]) {
    setSpeakers(list); speakersRef.current = list;
    send("speakers", { speakers: list });
    if (isHost) {
      await track("host", false, mutedRef.current);
      supabaseBrowser().from("live_rooms").update({ speakers: list.filter((x) => x !== room.host_id) }).eq("id", room.id).then(() => {}, () => {});
    }
  }
  const stageCount = () => new Set([room.host_id, ...cohostsRef.current, ...speakersRef.current]).size;
  const invite = (id: string) => { if (speakersRef.current.includes(id)) return; if (stageCount() >= MAX_STAGE) { setMsg(`Up to ${MAX_STAGE} people on stage at a time.`); return; } setSpeakerList([...new Set([...speakersRef.current, id])]); };
  const moveDown = (id: string) => setSpeakerList(speakersRef.current.filter((s) => s !== id));
  async function setCohostList(list: string[]) {
    setCohosts(list); cohostsRef.current = list;
    send("cohosts", { cohosts: list });
    await supabaseBrowser().from("live_rooms").update({ cohosts: list }).eq("id", room.id);
    await track("host", false, mutedRef.current);
  }
  const makeCohost = (id: string) => {
    if (cohosts.length >= MAX_COHOSTS) { setMsg(`Up to ${MAX_COHOSTS} co-hosts.`); return; }
    setCohostList([...cohosts, id]);
    if (!speakersRef.current.includes(id)) setSpeakerList([...speakersRef.current, id]);
  };
  const removeCohost = (id: string) => setCohostList(cohosts.filter((c) => c !== id));
  const muteOne = (id: string) => { send("mute", { to: id }); setMsg("Muted. They can unmute again if they need to."); };
  const muteAll = () => { send("mute", { to: "*" }); setMsg("Everyone on stage is muted."); };
  function toggleOpen() {
    const on = !openMic;
    setOpenMic(on); openRef.current = on;
    send("open", { on });
    track("host", false, mutedRef.current);
    setMsg(on ? "Open mic: anyone can come up to speak (up to 8 on stage). Their mic starts muted." : "Invite only: people raise a hand and you invite them to speak.");
  }

  // ---- recording (host only)
  function mixIn(key: string, stream: MediaStream) {
    if (!mixCtx.current || !mixDest.current || mixSrc.current.has(key) || !stream.getAudioTracks().length) return;
    try { const src = mixCtx.current.createMediaStreamSource(stream); src.connect(mixDest.current); mixSrc.current.set(key, src); } catch { /* skip this voice */ }
  }
  async function startRec() {
    if (recorder.current || !isHost) return;
    if (!confirm("Record this live? Everyone will see 🔴 REC. When you stop, it's saved to the live's page and your profile, and you can save it on your device.")) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await ctx.resume().catch(() => {});
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
      track("host", false, mutedRef.current);
    } catch { setMsg("This browser can't record. Try Chrome or Safari on a recent phone or computer."); }
  }
  function stopRec(): Promise<void> {
    const r = recorder.current;
    if (!r) return Promise.resolve();
    recorder.current = null;
    setRec(false); setRecOn(false);
    send("rec", { on: false });
    track("host", false, mutedRef.current);
    return new Promise((done) => {
      r.onstop = async () => {
        mixSrc.current.forEach((n) => { try { n.disconnect(); } catch {} }); mixSrc.current.clear();
        mixCtx.current?.close().catch(() => {}); mixCtx.current = null; mixDest.current = null;
        const type = (r.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];
        const secs = Math.round((Date.now() - recStart.current) / 1000);
        if (blob.size < 2000) { setMsg("The recording was too short to save."); done(); return; }
        const ext = type.includes("mp4") ? "m4a" : "webm";
        // Keep a copy here first, so it can be saved on this device even if the upload fails.
        setLocal((old) => { if (old) URL.revokeObjectURL(old.url); return { url: URL.createObjectURL(blob), name: `${room.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "live"}-${new Date().toISOString().slice(0, 10)}.${ext}` }; });
        setSaving("Saving your recording…");
        try {
          const sb = supabaseBrowser();
          const path = `${me.id}/${room.id}-${Date.now()}.${ext}`;
          const up = await sb.storage.from("live-recordings").upload(path, blob, { contentType: type, upsert: false });
          if (up.error) throw up.error;
          const url = sb.storage.from("live-recordings").getPublicUrl(path).data.publicUrl;
          const { data, error } = await sb.from("live_recordings").insert({ room_id: room.id, title: room.title.slice(0, 120), path, url, duration_s: secs, size_bytes: blob.size }).select("id").single();
          if (error || !data) throw error || new Error("save");
          setSaved({ id: data.id, pinned: false, url }); setSaving("");
        } catch { setSaving("Couldn't upload the recording. Save it on your device below."); }
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
    setFloaters((f) => [...f.slice(-14), { k, e, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2600);
  }
  // Reactions show on your screen every tap, but go to the room at most ~4 a second (keeps it under rate limits).
  const lastSend = useRef(0);
  const react = (e: string) => { float(e); const t = Date.now(); if (t - lastSend.current > 250) { lastSend.current = t; send("react", { e }); } };
  const blazeT = useRef<any>(null);
  function fireBurst() {
    setFires((n) => n + 1);
    for (let i = 0; i < 6; i++) setTimeout(() => {
      const k = ++fk.current;
      setFloaters((f) => [...f.slice(-16), { k, e: "🔥", x: 4 + Math.random() * 92, big: true }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2800);
    }, i * 70);
    setBlaze(true);
    clearTimeout(blazeT.current);
    blazeT.current = setTimeout(() => setBlaze(false), 1400);
  }
  const lastFire = useRef(0);
  const moreFire = () => { fireBurst(); const t = Date.now(); if (t - lastFire.current > 350) { lastFire.current = t; send("fire", {}); } try { navigator.vibrate?.(30); } catch {} };

  const list = useMemo(() => Object.values(peers).sort((a, b) => a.at - b.at), [peers]);
  const onStage = list.filter((p) => roleOf(p.id) !== "listener").sort((a, b) => ["host", "cohost", "speaker"].indexOf(roleOf(a.id)) - ["host", "cohost", "speaker"].indexOf(roleOf(b.id)));
  const audience = list.filter((p) => roleOf(p.id) === "listener");
  const hands = audience.filter((p) => p.hand);
  const badge = { host: "Host", cohost: "Co-host", speaker: "Speaker", listener: "" } as const;
  // Requests to speak pop up for the host one at a time (Accept / Not now); all of them stay listed under the stage.
  const [seenReq, setSeenReq] = useState<string[]>([]);
  const dismissReq = (id: string) => setSeenReq((s) => [...s, id]);
  const newReq = hands.find((p) => !seenReq.includes(p.id)) || null;
  // The host can't miss a request: a chime, a buzz, a phone notification if they're in another app, and the tab title.
  useEffect(() => {
    if (!newReq || !canRun || openMic) return;
    try { navigator.vibrate?.([60, 40, 60]); } catch {}
    try {
      const c = meterCtx(), o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(880, c.currentTime); o.frequency.setValueAtTime(1320, c.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.18, c.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.4);
    } catch {}
    try {
      if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification(`✋ ${newReq.alias} wants to speak`, { body: `In your live "${room.title}". Tap to open and accept.`, tag: `req-${room.id}`, icon: "/icons/icon-192.png" });
        n.onclick = () => { window.focus(); n.close(); };
      }
    } catch {}
    const t0 = document.title; let on = false;
    const flash = setInterval(() => { on = !on; document.title = on ? `✋ ${newReq.alias} wants to speak` : t0; }, 1000);
    const stop = () => { if (document.visibilityState === "visible") { clearInterval(flash); document.title = t0; } };
    document.addEventListener("visibilitychange", stop);
    const end = setTimeout(() => { clearInterval(flash); document.title = t0; }, 30_000);
    if (document.visibilityState === "visible") setTimeout(() => { clearInterval(flash); document.title = t0; }, 4000);
    return () => { clearInterval(flash); clearTimeout(end); document.title = t0; document.removeEventListener("visibilitychange", stop); };
  }, [newReq?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Someone lowered their hand: they can ask again later and the pop-up shows again.
  useEffect(() => { setSeenReq((s) => s.filter((id) => hands.some((h) => h.id === id))); }, [hands.map((h) => h.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  function openChat() {
    const el = document.getElementById("lv-chat");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => (el?.querySelector('input[aria-label="Comment"]') as HTMLInputElement | null)?.focus(), 350);
  }

  // Open mic: the host's page brings up anyone who asks, while there's room on stage.
  useEffect(() => {
    if (!isHost || !openMic || !joined) return;
    for (const p of hands) if (stageCount() < MAX_STAGE) invite(p.id);
  }, [hands.map((h) => h.id).join(","), openMic, joined]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ended) return (
    <div className="room card stack">
      <b>This live has ended.</b>
      {local && isHost && <a className="btn" href={local.url} download={local.name}>⬇️ Save the recording on this device</a>}
      {saved && <a className="btn" href={`/spaces/${room.id}`}>🎧 Listen back on the live&apos;s page</a>}
      <Link className="btn primary" href="/spaces">See other lives</Link>
    </div>
  );

  const myTile = (p: Peer) => p.id === me.id;

  return (
    <div className={mini ? "lv-mini" : "lv stack" + (blaze ? " blaze" : "")} onClick={() => { if (needTap || [...audios.current.values()].some((a) => a.paused)) unlockAudio(); }}>
      {mini ? (
        <Link href={`/spaces/${room.id}`} className="lv-mini-t" title="Open the live">
          <span className="room-live"><i />Live</span>
          <span className="lv-mini-txt"><b>{room.title}</b><small>{onStage.filter((p) => talking[p.id] && !p.muted).map((p) => p.alias).slice(0, 2).join(", ") || `${list.length} here`}{recOn ? " · 🔴 REC" : ""}</small></span>
        </Link>
      ) : (
        <div className="lv-top">
          <span className="room-live"><i />Live</span>
          <h1>{room.title}</h1>
          <small className="muted">👥 {list.length} here{openMic ? " · 🎙️ Open mic" : ""}{room.token && room.chain ? <> · <Link href={`/launchpad/${room.chain}/${room.token}`} target="_blank">View the coin</Link></> : null}</small>
        </div>
      )}

      {!mini && !ready && isHost ? (
        <WalletGate roomId={room.id} meId={me.id} isHost={isHost} onReady={(s, a) => { setReady(s); setMyAddr(a); }} />
      ) : !mini && !joined ? (
        <div className="lv-gate">
          <div className="lv-gate-orb" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              {isHost ? <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></> : <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4.5" height="6" rx="1.6" /><rect x="16.5" y="14" width="4.5" height="6" rx="1.6" /></>}
            </svg>
          </div>
          <b>{isHost ? "You're the host" : "You're in"}</b>
          <p>{isHost ? "Your microphone starts muted." : "Listen, comment, react, and raise your hand to speak."} {ready && <small className="muted">🔒 Drops go to your wallet {ready}, only you see this.</small>}</p>
          <button type="button" className="btn primary" disabled={joining} onClick={join}>{joining ? "Joining…" : isHost ? "Start the live" : "Join the live"}</button>
        </div>
      ) : !mini ? (
        <>
          {needTap && <button type="button" className="lv-tap" onClick={unlockAudio}>🔊 Tap here to hear the room</button>}
          {!ready && !isHost && (
            <details className="lv-dropgate">
              <summary>🎁 Link a wallet to get the host&apos;s drops</summary>
              <WalletGate roomId={room.id} meId={me.id} isHost={false} onReady={(s, a) => { setReady(s); setMyAddr(a); }} />
            </details>
          )}
          {recOn && <div className="lv-rec" role="status" title="This live is being recorded"><i /><b>REC</b>{rec && <span className="lv-rec-t">{Math.floor(recSecs / 60)}:{String(recSecs % 60).padStart(2, "0")}</span>}</div>}
          {(saving || saved || local) && isHost && (
            <div className="lv-saved" role="status">
              <span>{saving || (saved?.pinned ? "📌 Saved and pinned to your profile." : saved ? "✅ Recording saved to this live's page and your profile." : "")}</span>
              {saved && !saved.pinned && <button type="button" className="btn small primary" onClick={pinSaved}>📌 Pin to my profile</button>}
              {local && <a className="btn small" href={local.url} download={local.name}>⬇️ Save on my device</a>}
            </div>
          )}
          {drop && <div className="room-drop-banner" role="status">{drop} <small>Check your wallet.</small></div>}
          {(cam || Object.keys(videos).length > 0) && (
            <section className="room-videos" aria-label="Video">
              {cam && mic.current && <VideoTile stream={mic.current} mine label="You" />}
              {Object.entries(videos).map(([id, st]) => <VideoTile key={id} stream={st} label={peers[id]?.alias || "Speaker"} />)}
            </section>
          )}

          {canRun && (
            <div className="lv-runbar" role="group" aria-label="Host controls">
              <small>Host controls</small>
              <button type="button" className="btn small" onClick={muteAll} disabled={onStage.filter((p) => p.id !== me.id && !p.muted).length === 0}>🔇 Mute everyone</button>
              {isHost && <button type="button" className={"btn small" + (openMic ? " primary" : "")} onClick={toggleOpen} aria-pressed={openMic}>{openMic ? "🎙️ Open mic: on" : "✋ Invite only"}</button>}
            </div>
          )}

          <section className="lv-stage" aria-label="On stage">
            {onStage.map((p) => {
              const role = roleOf(p.id);
              const mine = myTile(p);
              const isTalking = talking[p.id] && !p.muted && !(mine && muted);
              const pMuted = mine ? muted : p.muted;
              return (
                <div key={p.id} className={"lv-box" + (isTalking ? " talking" : "") + (mine ? " me" : "")}>
                  <button type="button" className={"lv-face big" + (isTalking ? " talking" : "")} onClick={() => setSheet(p)} aria-label={`${p.alias}, ${badge[role]}`}>
                    <span className="lv-ring"><Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} /></span>
                    <span className="lv-name">{mine ? "You" : p.alias}{p.ver && <VerifiedBadge n={p.vb} size={15} className="vbadge-name" />}</span>
                    <span className={"lv-role " + role}>{badge[role]}</span>
                  </button>
                  {/* The mic for this person, right under their name. */}
                  <div className="lv-box-ctl">
                    {mine ? (
                      <button type="button" className={"lv-mic" + (pMuted ? " off" : " on") + (isTalking ? " talk" : "")} onClick={toggleMute} aria-pressed={!pMuted}>
                        <MicIcon off={pMuted} /> {pMuted ? "Unmute" : isTalking ? "Speaking" : "Mute"}
                      </button>
                    ) : (
                      <span className={"lv-mic-st" + (pMuted ? " off" : " on")} title={pMuted ? "Muted" : "Mic on"}><MicIcon off={pMuted} />{pMuted ? "Muted" : isTalking ? "Speaking" : "Mic on"}</span>
                    )}
                    {!mine && canRun && role !== "host" && !p.muted && <button type="button" className="lv-mini-btn" onClick={() => muteOne(p.id)}>Mute</button>}
                    {!mine && canRun && role === "speaker" && <button type="button" className="lv-mini-btn" onClick={() => moveDown(p.id)}>Move down</button>}
                    {mine && role === "speaker" && <button type="button" className="lv-mini-btn" onClick={() => setSpeakerList(speakersRef.current.filter((s) => s !== me.id))}>Leave stage</button>}
                  </div>
                  <span className="lv-f">{fmt(followers[p.id] ?? 0)} followers</span>
                </div>
              );
            })}
          </section>

          {canRun && !openMic && newReq && (
            <div className="lv-req" role="alertdialog" aria-label="Request to speak">
              <Avatar className="avatar lv-av xs" alias={newReq.alias} color={newReq.color} url={newReq.avatar_url} />
              <span><b>{newReq.alias}</b><small>wants to speak</small></span>
              <button type="button" className="lv-req-ok" onClick={() => { invite(newReq.id); dismissReq(newReq.id); }}>Accept</button>
              <button type="button" className="lv-req-no" onClick={() => { send("lower", { to: newReq.id }); dismissReq(newReq.id); }}>Not now</button>
            </div>
          )}
          {canRun && hands.length > 0 && !openMic && (
            <section className="lv-hands" aria-label="Raised hands">
              <small>✋ Want to speak</small>
              {hands.map((p) => <button key={p.id} type="button" className="lv-hand" onClick={() => invite(p.id)}><Avatar className="avatar lv-av xs" alias={p.alias} color={p.color} url={p.avatar_url} /> {p.alias} · Invite</button>)}
            </section>
          )}

          <section className="lv-crowd" aria-label="Listening">
            {audience.map((p) => (
              <div key={p.id} className={"lv-box sm" + (myTile(p) ? " me" : "")}>
                <button type="button" className="lv-face" onClick={() => setSheet(p)} title={p.alias} aria-label={`${p.alias}, ${followers[p.id] ?? 0} followers`}>
                  <span className="lv-ring">{p.hand && <i className="lv-handdot" aria-hidden="true">✋</i>}<Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} /></span>
                  <span className="lv-name sm">{myTile(p) ? "You" : p.alias}</span>
                </button>
                {myTile(p) ? (
                  <button type="button" className={"lv-mic off" + (hand ? " hand" : "")} onClick={raiseHand} aria-pressed={hand}>{openMic ? "🎙️ Speak" : hand ? "✋ Lower" : "✋ Ask to speak"}</button>
                ) : canRun ? (
                  <button type="button" className="lv-mini-btn" onClick={() => invite(p.id)}>{p.hand ? "✋ Invite" : "Invite"}</button>
                ) : <span className="lv-f">{fmt(followers[p.id] ?? 0)}</span>}
              </div>
            ))}
            {!audience.length && <small className="muted">No listeners yet. Share the link so people can join.</small>}
          </section>

          <div className="lv-floats" aria-hidden="true">{floaters.map((f) => <span key={f.k} className={f.big ? "big" : undefined} style={{ left: `${f.x}%` }}><Emo e={f.e} size={f.big ? 44 : 32} /></span>)}</div>

          <div className="lv-hype" role="group" aria-label="Hype">
            <button type="button" className="lv-fire sm" onClick={moreFire} aria-label="More fire">
              <span className="lv-fire-ic" aria-hidden="true"><Emo e="🔥" size={20} /></span>
              <span className="lv-fire-t"><b>FIRE</b>{fires > 0 && <small>{fmt(fires)}</small>}</span>
            </button>
            {REACTIONS.filter((e) => e !== "🔥").map((e) => <button key={e} type="button" className="lv-emo" onClick={() => react(e)} aria-label={`React ${e}`}><Emo e={e} size={20} /></button>)}
          </div>

          <div id="lv-chat" className="lv-chat-wrap"><LiveChat roomId={room.id} me={me} canModerate={canRun} /></div>

          <LiveWallet roomId={room.id} address={myAddr} sol={me.wallet?.member?.sol ?? null} canAll={canRun}
            people={list.filter((p) => p.id !== me.id).map((p) => ({ id: p.id, alias: p.alias, color: p.color, avatar_url: p.avatar_url }))}
            target={sendTo} onTargetDone={() => setSendTo(null)} appId={me.wallet?.appId ?? null} member={me.wallet?.member ?? null}
            onSent={(text) => { setDrop(text); send("drop", { text }); }} />
        </>
      ) : null}

      {/* The controls stay in the same place in the full room and the small player, so the sound never restarts. */}
      {(joined || !mini) && (
        <div className={"lv-ctl" + (mini ? " mini" : "")} role="toolbar" aria-label="Live controls" style={!joined ? { display: "none" } : undefined}>
          {canSpeak
            ? <MicBtn muted={muted} talking={!!talking[me.id]} onClick={toggleMute} />
            : <Ctl icon="hand" label={openMic ? "Speak" : hand ? "Requested" : "Request"} title={openMic ? "Speak" : hand ? "Cancel your request to speak" : "Request to speak"} on={hand} tone={hand ? "gold" : undefined} onClick={raiseHand} pressed={hand} />}
          {!mini && <Ctl icon="chat" label="Comment" onClick={openChat} />}
          <SpeakerOut audios={allAudios} />
          {!mini && canSpeak && coinLive && <Ctl icon={cam ? "cam" : "camOff"} label={cam ? "Camera on" : "Camera"} on={cam} onClick={toggleCam} pressed={cam} />}
          {isHost && <Ctl icon={rec ? "stop" : "rec"} label={rec ? "Stop rec" : "Record"} on={rec} tone="red" onClick={() => (rec ? stopRec() : startRec())} pressed={rec} />}
          {!mini && isHost && <Ctl icon="rocket" label="Launch" href="/launchpad/new" />}
          {!mini && <Ctl icon="link" label="Share" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/spaces/${room.id}`).then(() => setMsg("Link copied. Share it so people can join.")).catch(() => {}); }} />}
          {isHost ? <Ctl icon="end" label="End" tone="red" on onClick={endRoom} /> : <Ctl icon="leave" label="Leave" onClick={() => leave()} />}
        </div>
      )}
      {!mini && msg && <small className="muted" role="status">{msg}</small>}
      {!mini && joined && <small className="lv-credit">Your live keeps playing while you browse the site. Animated emoji: <a href="https://googlefonts.github.io/noto-emoji-animation/" target="_blank" rel="noopener noreferrer">Noto Emoji by Google</a>, CC BY 4.0.</small>}

      {!mini && sheet && (
        <ProfileSheet id={sheet.id} alias={sheet.alias} onClose={() => setSheet(null)} act={{
          role: roleOf(sheet.id), canRun, isHost, muted: sheet.muted,
          invite: () => { invite(sheet.id); setSheet(null); },
          moveDown: () => { moveDown(sheet.id); setSheet(null); },
          makeCohost: () => { makeCohost(sheet.id); setSheet(null); },
          removeCohost: () => { removeCohost(sheet.id); setSheet(null); },
          mute: () => { muteOne(sheet.id); setSheet(null); },
          send: () => { setSendTo({ id: sheet.id, alias: sheet.alias }); setSheet(null); },
        }} />
      )}
    </div>
  );
}
