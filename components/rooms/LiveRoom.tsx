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
import { SfuPull, SfuPush, sfuReady, type PullWant } from "@/lib/sfu";
import RoomMusic, { MusicPanel, type Music } from "./RoomMusic";

export type LiveMe = { id: string; alias: string; color: string | null; avatar_url: string | null; is_verified?: boolean; verified_badge?: number | null;
  /** For the wallet in the room: the built-in wallet's app ID and the member's wallet details. */
  wallet?: { appId: string | null; member: Member | null } };
export type LiveRoomInfo = { id: string; title: string; host_id: string; ended_at: string | null; chain?: string | null; token?: string | null; cohosts?: string[] | null; speakers?: string[] | null };
type Me = LiveMe;
type Room = LiveRoomInfo;
type Role = "host" | "cohost" | "speaker" | "listener";
type Peer = { id: string; alias: string; color: string | null; avatar_url: string | null; role: Role; hand: boolean; muted: boolean; at: number; ver?: boolean; vb?: number | null; hid?: boolean;
  /** Through the voice relay: the speaker's relay session and the tracks they send (mic, cam, music, mv). */
  sf?: { s: string; t: string[] } | null;
  /** What this host / co-host is playing for the room. */
  mus?: Music | null };
/** A live this big switches to crowd mode: plain listeners check in every 30 s instead of live presence. */
const CROWD = 120;

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
const MAX_STAGE = 10; // host + co-hosts + speakers
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

/**
 * Voice at speech quality (32 kbps mono, no data sent in silences, repair of lost packets). Each speaker sends their
 * voice to everyone in the room separately, so a lighter voice lets many more people hear everyone without the phone's
 * upload choking (that's what cut people out before). Written into the connection offer / answer.
 */
/**
 * Phone-to-phone voice: the more people listening, the lighter each copy, so a speaker's phone keeps up.
 * Opus stays clear for speech down to 16 kbps.
 */
let voiceKbps = 32;
export function setVoiceFor(listeners: number) { voiceKbps = listeners > 60 ? 16 : listeners > 25 ? 20 : listeners > 10 ? 24 : 32; }
function lightVoice(sdp?: string) {
  if (!sdp) return sdp;
  const m = /a=rtpmap:(\d+) opus\/48000[^\r\n]*/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1], add = [`maxaveragebitrate=${voiceKbps * 1000}`, "stereo=0", "sprop-stereo=0", "useinbandfec=1", "usedtx=1"];
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (re.test(sdp)) return sdp.replace(re, (_l, p: string) => `a=fmtp:${pt} ${[...p.split(";").map((x) => x.trim()).filter((x) => x && !/^(maxaveragebitrate|stereo|sprop-stereo|useinbandfec|usedtx)=/.test(x)), ...add].join(";")}`);
  return sdp.replace(m[0], `${m[0]}\r\na=fmtp:${pt} ${add.join(";")}`);
}
/** The voice goes first on a busy connection, capped at speech quality. */
function voiceFirst(pc: RTCPeerConnection) {
  for (const snd of pc.getSenders()) {
    if (snd.track?.kind !== "audio") continue;
    try {
      const p = snd.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = voiceKbps * 1000;
      (p.encodings[0] as any).priority = "high"; (p.encodings[0] as any).networkPriority = "high";
      snd.setParameters(p).catch(() => {});
    } catch { /* older browser: the offer / answer cap still applies */ }
  }
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
  const [floaters, setFloaters] = useState<{ k: number; e: string; x: number; big?: boolean; n?: string }[]>([]);
  // Who reacted, newest first (a few seconds each), so reactions show the person behind them.
  const [reacts, setReacts] = useState<{ k: number; e: string; n: string }[]>([]);
  // Everyone in the room in one list (instead of scrolling the crowd).
  const [showAll, setShowAll] = useState(false);
  const [allQ, setAllQ] = useState("");
  // Hide who I am: others see "Hidden listener" with no picture. Remembered on this device.
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem("lv-hide") === "1"); } catch {} }, []);
  const hiddenRef = useRef(false); hiddenRef.current = hidden;
  const [needTap, setNeedTap] = useState(false);
  // 🔥 MORE FIRE: the room's signature reaction. Everyone sees a burst of flames and the counter climbs.
  const [fires, setFires] = useState(0);
  // Who just sent fire: a flame shows on their picture for a moment, so you can see where it came from.
  const [fireOn, setFireOn] = useState<Record<string, number>>({});
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
  // Voice relay (big lives): one connection up for my tracks, one down for everyone on stage.
  const sfu = useRef(false);
  const push = useRef<SfuPush | null>(null);
  const pull = useRef<SfuPull | null>(null);
  const sfuMeta = useRef<{ s: string; t: string[] } | null>(null);
  // Room music (host / co-hosts): what's playing, and the device song's sound and picture going to the relay.
  const [music, setMusic] = useState<Music | null>(null); // what I'm playing
  const musicRef = useRef<Music | null>(null); musicRef.current = music;
  const musicTrack = useRef<MediaStreamTrack | null>(null);
  const musicVideo = useRef<MediaStreamTrack | null>(null);
  const musicEl = useRef<HTMLMediaElement | null>(null);
  const [musicStreams, setMusicStreams] = useState<Record<string, MediaStream>>({}); // from → song picture (video songs)
  const [musicPanel, setMusicPanel] = useState(false);
  // Crowd mode: the room's real size (from check-ins) and the listeners not on live presence.
  const [crowd, setCrowd] = useState<{ count: number; people: Peer[] }>({ count: 0, people: [] });
  const crowdMode = sfu.current && crowd.count >= CROWD;
  const crowdRef = useRef(false); crowdRef.current = crowdMode;
  const tracked = useRef(false);
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
    while (pool.current.length + audios.current.size < MAX_STAGE + 8) pool.current.push(makeAudio());
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
    if (to === me.id && from.endsWith("~m")) {
      const f = from.slice(0, -2);
      setMusicStreams((v) => { if (!v[f]) return v; const n = { ...v }; delete n[f]; return n; });
    } else if (to === me.id) {
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
    if (sfu.current) return; // the relay carries my voice to everyone (sfuSend)
    if (!mic.current || to === me.id) return;
    setVoiceFor(Object.keys(peersRef.current).length);
    await loadIce();
    if (!mic.current) return;
    const key = `${me.id}>${to}`;
    const pc = newPc(key, to);
    mic.current.getTracks().forEach((t) => pc.addTrack(t, mic.current!));
    const offer = await pc.createOffer();
    await pc.setLocalDescription({ type: offer.type, sdp: lightVoice(offer.sdp) });
    voiceFirst(pc);
    send("offer", { to, key, sdp: pc.localDescription });
    // No answer (the message got lost, or they weren't ready yet): call again.
    setTimeout(() => { if (pcs.current.get(key) === pc && pc.signalingState === "have-local-offer") retry(key, to); }, 6000);
  }

  // ---- Voice relay (big lives) ----
  const sendTries = useRef(0);
  const sending = useRef<Promise<void> | null>(null);
  /** Send my tracks (mic, camera, room music) up to the relay, then tell the room where to find them. */
  function sfuSend(): Promise<void> {
    if (!sfu.current || !joinedRef.current) return Promise.resolve();
    const run = (sending.current || Promise.resolve()).then(async () => {
      const wantMic = !!mic.current && canSpeakRef.current;
      const wantMusic = !!musicTrack.current && runners().includes(me.id);
      if (!wantMic && !wantMusic) {
        if (push.current) { push.current.close(); push.current = null; }
        if (sfuMeta.current) { sfuMeta.current = null; await track(myRoleRef.current, hand, mutedRef.current); }
        return;
      }
      try {
        if (!push.current) {
          await loadIce();
          const p = new SfuPush({ roomId: room.id, ice: ICE, onFail: () => { if (push.current !== p) return; p.close(); push.current = null; setTimeout(() => { sfuSend(); }, 1000); } });
          await p.open(); push.current = p;
        }
        const p = push.current;
        const a = wantMic ? mic.current!.getAudioTracks()[0] : null;
        const v = wantMic ? mic.current!.getVideoTracks()[0] : null;
        if (a) await p.publish("mic", a, 40_000); else if (p.has("mic")) await p.unpublish("mic");
        if (v) await p.publish("cam", v, 600_000); else if (p.has("cam")) await p.unpublish("cam");
        if (wantMusic) await p.publish("music", musicTrack.current!, 128_000); else if (p.has("music")) await p.unpublish("music");
        if (wantMusic && musicVideo.current) await p.publish("mv", musicVideo.current, 900_000); else if (p.has("mv")) await p.unpublish("mv");
        const t = ["mic", "cam", "music", "mv"].filter((n) => p.has(n));
        sfuMeta.current = { s: p.sessionId, t };
        sendTries.current = 0;
        await track(myRoleRef.current, false, mutedRef.current);
      } catch {
        const n = ++sendTries.current;
        if (push.current) { push.current.close(); push.current = null; }
        if (n <= 6) { setMsg("Connecting your voice…"); setTimeout(() => { sfuSend(); }, 1500 * n); }
        else setMsg("Your voice couldn't reach the room. Check your internet, or leave and rejoin.");
      }
    });
    sending.current = run.catch(() => {});
    return run;
  }

  /** A speaker's track arrived from the relay. */
  function onRelayTrack(key: string, t: MediaStreamTrack) {
    const [from, name] = key.split("|");
    if (name === "cam" || name === "mv") {
      const st = new MediaStream([t]);
      if (name === "cam") setVideos((v) => ({ ...v, [from]: st })); else setMusicStreams((v) => ({ ...v, [from]: st }));
      return;
    }
    const pk = name === "music" ? `${from}~m>${me.id}` : `${from}>${me.id}`;
    let a = audios.current.get(pk);
    if (!a) { a = takeAudio(); audios.current.set(pk, a); }
    const st = new MediaStream([t]);
    a.srcObject = st;
    voices.current.set(pk, st);
    if (recorder.current) mixIn(pk, st);
    a.play().catch(() => setNeedTap(true));
    if (name === "mic") watchLevel(from, st);
  }
  function dropRelay(key: string) {
    const [from, name] = key.split("|");
    if (name === "cam") setVideos((v) => { if (!v[from]) return v; const n = { ...v }; delete n[from]; return n; });
    else if (name === "mv") setMusicStreams((v) => { if (!v[from]) return v; const n = { ...v }; delete n[from]; return n; });
    else closePc(name === "music" ? `${from}~m>${me.id}` : `${from}>${me.id}`);
  }
  const pulling = useRef(false);
  /** Receive exactly the tracks of the people on stage (and room music), over one relay connection. */
  async function syncPulls() {
    if (!sfu.current || !joinedRef.current || pulling.current) return;
    pulling.current = true;
    try {
      const here = peersRef.current;
      const want: PullWant[] = [];
      for (const p of Object.values(here)) {
        if (p.id === me.id || !p.sf?.s || !onStageNow(p.id)) continue;
        for (const t of p.sf.t) if (/^(mic|cam|music|mv)$/.test(t)) want.push({ key: `${p.id}|${t}`, sessionId: p.sf.s, trackName: t });
      }
      if (!pull.current) {
        if (!want.length) return;
        await loadIce();
        const pl: SfuPull = new SfuPull({ roomId: room.id, ice: ICE, onTrack: onRelayTrack, onFail: () => {
          if (pull.current !== pl) return;
          pl.keys().forEach(dropRelay); pl.close(); pull.current = null;
          setTimeout(() => { syncPulls(); }, 1000);
        } });
        await pl.open(); pull.current = pl;
      }
      const pl = pull.current;
      const wk = new Set(want.map((w) => w.key));
      // Off stage, or stopped a track: stop now. Gone from the room: give a blip 15 s before hanging up.
      const off = pl.keys().filter((k) => !wk.has(k) && here[k.split("|")[0]]);
      const away = pl.keys().filter((k) => !wk.has(k) && !here[k.split("|")[0]]);
      if (off.length) { off.forEach(dropRelay); pl.drop(off); }
      if (away.length) setTimeout(() => {
        const still = away.filter((k) => pull.current === pl && !peersRef.current[k.split("|")[0]]);
        if (still.length) { still.forEach(dropRelay); pl.drop(still); }
      }, 15_000);
      const fresh = want.filter((w) => { const c = pl.current(w.key); return !c || c.sessionId !== w.sessionId; });
      if (fresh.length) await pl.pull(fresh);
    } catch {
      setTimeout(() => { syncPulls(); }, 3000);
    } finally { pulling.current = false; }
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
    if (sfu.current) { sfuSend(); return; }
    Object.keys(peers).forEach((id) => { if (id !== me.id) callPeer(id); });
  }

  function stopMic() {
    setCam(false);
    mic.current?.getTracks().forEach((t) => t.stop());
    mic.current = null;
    levels.current.get(me.id)?.();
    for (const k of [...pcs.current.keys()]) if (k.startsWith(`${me.id}>`)) closePc(k);
    if (sfu.current && joinedRef.current) sfuSend();
  }

  const runners = () => [room.host_id, ...cohostsRef.current];

  async function join() {
    if (chan.current) return;
    if (!joinedRef.current) { if (joining) return; setMsg(""); setJoining(true); }
    unlockAudio();
    if (!joinedRef.current) {
      sfu.current = await sfuReady(room.id);
      // Learn the live's size first: a full live says so, and a big one keeps listeners off live presence.
      if (!isHost) {
        try {
          const j = await fetch(`/api/rooms/${room.id}/here`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: hiddenRef.current }) }).then((r) => r.json());
          if (j?.full) { setMsg(`This live is full (${j.max} people). Try again in a little while.`); setJoining(false); return; }
          if (j && Array.isArray(j.people)) {
            const c = { count: Number(j.count) || 0, people: j.people.map((p: any) => ({ ...p, role: "listener" as Role, hand: false, muted: true, at: 0 })) };
            setCrowd(c); crowdRef.current = sfu.current && c.count >= CROWD;
          }
        } catch { /* small-room behaviour */ }
      }
    }
    if (chan.current) return;
    const sb = supabaseBrowser();
    // A leftover connection to this room (left earlier, or a dropped one) would be handed back instead of a new one.
    for (const c of sb.getChannels()) if ((c as any).topic === `realtime:room:${room.id}`) { try { sb.removeChannel(c); } catch {} }
    const ch = sb.channel(`room:${room.id}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    chan.current = ch;
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState() as Record<string, any[]>;
      const next: Record<string, Peer> = {};
      for (const [id, metas] of Object.entries(st)) { const m = metas[metas.length - 1]; if (m) next[id] = { id, alias: m.alias, color: m.color, avatar_url: m.avatar_url, role: m.role, hand: !!m.hand, muted: !!m.muted, at: m.at || 0, ver: !!m.ver, vb: m.vb ?? null, hid: !!m.hid, sf: m.sf || null, mus: m.mus || null }; }
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
        await pc.setLocalDescription({ type: ans.type, sdp: lightVoice(ans.sdp) });
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
    ch.on("broadcast", { event: "fire" }, ({ payload }: any) => { const n = String(payload?.n || "").slice(0, 24); fireBurst(n, n && n !== "Someone" ? String(payload?.from || "") : ""); });
    // A listener isn't getting my voice (a lost connection message): call them again.
    ch.on("broadcast", { event: "need" }, ({ payload }: any) => {
      if (payload.to !== me.id || !mic.current || !canSpeakRef.current) return;
      const pc = pcs.current.get(`${me.id}>${payload.from}`);
      if (!pc || pc.connectionState === "failed" || pc.connectionState === "closed" || pc.signalingState === "have-local-offer") callPeer(payload.from);
    });
    ch.on("broadcast", { event: "lower" }, ({ payload }: any) => {
      if (!runners().includes(payload.from) || payload.to !== me.id) return;
      setHand(false); track(myRoleRef.current, false, true); setMsg("The host can't bring you up right now. You can request again later.");
    });
    ch.on("broadcast", { event: "rec" }, ({ payload }: any) => { if (payload.from === room.host_id) setRecOn(!!payload.on); });
    ch.on("broadcast", { event: "react" }, ({ payload }: any) => { if (REACTIONS.includes(payload.e)) float(payload.e, String(payload.n || "").slice(0, 24)); });
    ch.on("broadcast", { event: "end" }, ({ payload }: any) => { if (payload.from === room.host_id) { setEnded(true); leave(); } });
    ch.subscribe(async (status: string) => {
      if (chan.current !== ch) return; // an old connection (left, or replaced by a fresh one)
      if (status !== "SUBSCRIBED") {
        live.current = false;
        if (!joinedRef.current) {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { setMsg("Couldn't connect to the room. Check your internet and try again."); setJoining(false); chan.current = null; try { sb.removeChannel(ch); } catch { try { ch.unsubscribe(); } catch {} } }
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
    if (old) { try { supabaseBrowser().removeChannel(old); } catch { try { old.unsubscribe(); } catch {} } }
    setJoining(false);
    join();
  }
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const myRoleRef = useRef(myRole);
  myRoleRef.current = myRole;
  async function track(role: Role, h: boolean, m: boolean) {
    const hid = hiddenRef.current && role === "listener"; // speakers are always shown
    // Crowd mode: a plain listener stays off live presence (the check-ins count them); a raised hand goes on it.
    if (crowdRef.current && role === "listener" && !h && !isHost) {
      if (tracked.current) { tracked.current = false; await chan.current?.untrack?.().catch?.(() => {}); }
      return;
    }
    tracked.current = true;
    const mine = role !== "listener" || isHost ? sfuMeta.current : null;
    const canMus = isHost || cohostsRef.current.includes(me.id);
    await chan.current?.track({ ...(mine ? { sf: mine } : {}), ...(canMus && musicRef.current ? { mus: musicRef.current } : {}), alias: hid ? "Hidden listener" : me.alias, color: hid ? "#6b6480" : me.color, avatar_url: hid ? null : me.avatar_url, ver: hid ? false : !!me.is_verified, vb: hid ? null : me.verified_badge ?? null, hid, role, hand: h, muted: m, at: Date.now(), ...(isHost ? { speakers: speakersRef.current, cohosts: cohostsRef.current, rec: !!recorder.current, open: openRef.current } : {}) });
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
        if (await startMic()) { if (sfu.current) await sfuSend(); else Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); }); }
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
    if (!joined || !canSpeak || !mic.current || sfu.current) return;
    Object.keys(peers).forEach((id) => { if (id !== me.id && !pcs.current.has(`${me.id}>${id}`)) callPeer(id); });
  }, [peers, joined, canSpeak]); // eslint-disable-line react-hooks/exhaustive-deps

  // Someone moved back to listening: stop playing their voice here.
  useEffect(() => {
    for (const k of [...pcs.current.keys()]) { const [from, to] = k.split(">"); if (to === me.id && !onStageNow(from)) closePc(k); }
  }, [speakers, cohosts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relay: who's on stage (or what they send) changed, so receive exactly their tracks.
  useEffect(() => { if (joined && sfu.current) syncPulls(); }, [peers, speakers, cohosts, joined]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check-ins (every ~30 s): the real room size, and the listeners who stay off live presence in a big live.
  useEffect(() => {
    if (!joined) return;
    let stop = false, t: ReturnType<typeof setTimeout>;
    const beat = async () => {
      try {
        const r = await fetch(`/api/rooms/${room.id}/here`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: hiddenRef.current }) });
        const j = await r.json().catch(() => null);
        if (!stop && j && Array.isArray(j.people)) setCrowd({ count: Number(j.count) || 0, people: j.people.map((p: any) => ({ ...p, role: "listener", hand: false, muted: true, at: 0 })) });
      } catch { /* next time */ }
      if (!stop) t = setTimeout(beat, 25_000 + Math.random() * 10_000); // spread out, so 1,000 phones don't all check in at once
    };
    t = setTimeout(beat, 1500 + Math.random() * 4000);
    return () => { stop = true; clearTimeout(t); };
  }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  // The live just got big (or small again): plain listeners leave (or rejoin) live presence.
  useEffect(() => { if (joined) track(myRoleRef.current, hand, mutedRef.current); }, [crowdMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Room music (host and co-hosts) ----
  /** Play a link for everyone (YouTube, Vimeo, SoundCloud, Spotify…): it shows like a video on everyone's screen. */
  async function playLink(m: Music) {
    stopDeviceMusic();
    setMusic(m); musicRef.current = m;
    await track(myRoleRef.current, false, mutedRef.current);
    setMusicPanel(false);
  }
  /** Play a song or video from this phone straight into the room. */
  async function playFile(f: File) {
    if (!sfu.current) { setMsg("Playing from your phone needs the voice relay switched on. Paste a YouTube link instead."); return; }
    stopDeviceMusic();
    const isVid = f.type.startsWith("video/");
    const el = document.createElement(isVid ? "video" : "audio") as HTMLMediaElement;
    el.src = URL.createObjectURL(f); (el as any).playsInline = true; el.setAttribute("playsinline", ""); el.crossOrigin = "anonymous";
    try {
      const ctx = meterCtx(); if (ctx.state === "suspended") await ctx.resume();
      const src = ctx.createMediaElementSource(el);
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest); src.connect(ctx.destination); // the room hears it, and so do you
      await el.play();
      musicEl.current = el;
      musicTrack.current = dest.stream.getAudioTracks()[0] || null;
      // A video file: its picture goes too, where the browser can capture it.
      if (isVid) { try { const cs = (el as any).captureStream?.() || (el as any).mozCaptureStream?.(); musicVideo.current = cs?.getVideoTracks?.()[0] || null; } catch { musicVideo.current = null; } }
      el.onended = () => { stopMusic(); };
      const m: Music = { k: "file", t: f.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80), at: Date.now(), by: me.alias, vid: !!musicVideo.current };
      setMusic(m); musicRef.current = m;
      setMusicPanel(false);
      await sfuSend();
    } catch {
      try { URL.revokeObjectURL(el.src); } catch {}
      setMsg("That file couldn't play here. Try an MP3, M4A or MP4.");
    }
  }
  function stopDeviceMusic() {
    const el = musicEl.current; musicEl.current = null;
    if (el) { try { el.pause(); URL.revokeObjectURL(el.src); } catch {} }
    try { musicTrack.current?.stop(); musicVideo.current?.stop(); } catch {}
    musicTrack.current = null; musicVideo.current = null;
  }
  async function stopMusic() {
    const had = !!musicTrack.current;
    stopDeviceMusic();
    setMusic(null); musicRef.current = null;
    if (had) await sfuSend();
    await track(myRoleRef.current, false, mutedRef.current);
  }
  function pauseMusic() {
    const el = musicEl.current; if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
    const m = musicRef.current; if (m) { const nm = { ...m, paused: el.paused }; setMusic(nm); musicRef.current = nm; track(myRoleRef.current, false, mutedRef.current); }
  }
  // What the room is playing: the newest from the host or a co-host.
  const roomMusic = useMemo(() => {
    let best: (Music & { from: string }) | null = music ? { ...music, from: me.id } : null;
    for (const p of Object.values(peers)) {
      if (p.id === me.id || !p.mus || !(p.id === room.host_id || cohosts.includes(p.id))) continue;
      if (!best || p.mus.at > best.at) best = { ...p.mus, from: p.id };
    }
    return best;
  }, [peers, music, cohosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const musicVol = useRef(1);
  function setMusicVolume(v: number) {
    musicVol.current = v;
    audios.current.forEach((a, k) => { if (k.includes("~m>")) a.volume = v; });
  }

  // Not hearing someone on stage (a connection message got lost, or their link dropped): ask them to send their voice
  // again. Checked every 8 s, at most once every 15 s per speaker. Also wakes any voice the phone paused.
  const askedAt = useRef(new Map<string, number>());
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      const here = peersRef.current;
      if (sfu.current) syncPulls(); // relay: make sure every voice on stage is coming in
      else for (const id of new Set([room.host_id, ...cohostsRef.current, ...speakersRef.current])) {
        if (id === me.id || !here[id]) continue;
        const pc = pcs.current.get(`${id}>${me.id}`);
        if (pc && (pc.connectionState === "connected" || pc.connectionState === "connecting")) continue;
        if (Date.now() - (askedAt.current.get(id) || 0) < 15_000) continue;
        askedAt.current.set(id, Date.now());
        send("need", { to: id });
      }
      audios.current.forEach((a) => { if (a.paused && a.srcObject) a.play().catch(() => setNeedTap(true)); });
    }, 8000);
    return () => clearInterval(t);
  }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleHide() {
    const h = !hidden;
    setHidden(h); hiddenRef.current = h;
    try { localStorage.setItem("lv-hide", h ? "1" : "0"); } catch {}
    track(myRoleRef.current, hand, mutedRef.current);
    setMsg(h ? "You're hidden: others see \u201cHidden listener\u201d. If you go up to speak, your name shows." : "Your name and picture show again.");
  }

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

  // ---- Float: the live in a small window that stays on screen over other apps (Picture-in-Picture). The window
  // shows the room, who's speaking and your mic; its buttons mute/unmute and hang up. The sound keeps going.
  const canSpeakRef = useRef(false); canSpeakRef.current = canSpeak;
  const [floating, setFloating] = useState(false);
  const [pipOk, setPipOk] = useState(false);
  const pip = useRef<{ v: HTMLVideoElement; c: HTMLCanvasElement; t: ReturnType<typeof setInterval> } | null>(null);
  const pipInfo = useRef({ title: room.title, speaking: "", count: 0, muted: true, canSpeak: false });
  useEffect(() => { try { setPipOk(!!(document as any).pictureInPictureEnabled && typeof HTMLCanvasElement.prototype.captureStream === "function"); } catch {} }, []);
  function drawPip() {
    const p = pip.current; if (!p) return;
    const g = p.c.getContext("2d"); if (!g) return;
    const { title, speaking, count, muted: m, canSpeak: cs } = pipInfo.current;
    const W = p.c.width, H = p.c.height;
    const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, "#2A1F45"); bg.addColorStop(1, "#120C20");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = "#FF3B5C"; g.beginPath(); g.arc(28, 30, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "700 22px system-ui, sans-serif"; g.fillText("LIVE", 44, 38);
    g.font = "800 30px system-ui, sans-serif"; g.fillText(title.slice(0, 22), 20, 92);
    g.font = "600 22px system-ui, sans-serif"; g.fillStyle = "#cbb8ff";
    g.fillText(speaking ? `🎙 ${speaking}`.slice(0, 32) : `${count} in the live`, 20, 132);
    g.fillStyle = cs ? (m ? "#E5484D" : "#22c55e") : "#9aa0a6"; g.font = "700 22px system-ui, sans-serif";
    g.fillText(cs ? (m ? "Your mic: off" : "Your mic: on") : "Listening", 20, 168);
  }
  async function popOut() {
    try {
      if ((document as any).pictureInPictureElement) { await (document as any).exitPictureInPicture(); return; }
      if (!pip.current) {
        const c = document.createElement("canvas"); c.width = 480; c.height = 190;
        const v = document.createElement("video"); v.muted = true; v.playsInline = true; v.autoplay = true;
        v.srcObject = (c as any).captureStream(4);
        v.addEventListener("enterpictureinpicture", () => setFloating(true));
        v.addEventListener("leavepictureinpicture", () => setFloating(false));
        pip.current = { v, c, t: setInterval(drawPip, 500) };
        drawPip();
      }
      await pip.current.v.play().catch(() => {});
      await (pip.current.v as any).requestPictureInPicture();
    } catch { setMsg("Your browser can't float the live. It keeps playing while you browse the site."); }
  }
  // Mic and hang-up buttons in the floating window / lock screen (where the browser supports them).
  useEffect(() => {
    const ms: any = (navigator as any).mediaSession; if (!ms || !joined) return;
    const set = (a: string, f: (() => void) | null) => { try { ms.setActionHandler(a, f); } catch {} };
    set("togglemicrophone", () => { if (canSpeakRef.current) toggleMute(); });
    set("hangup", () => leave());
    set("enterpictureinpicture", () => { popOut(); }); // some browsers float it by themselves when you leave the app
    return () => { set("togglemicrophone", null); set("hangup", null); set("enterpictureinpicture", null); };
  }, [joined]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { const p = pip.current; if (p) { clearInterval(p.t); try { (p.v.srcObject as MediaStream)?.getTracks().forEach((t) => t.stop()); } catch {} } }, []);
  useEffect(() => { if (!joined && (document as any).pictureInPictureElement) (document as any).exitPictureInPicture?.().catch(() => {}); }, [joined]);

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

  // Left on purpose (the page offers "Join again"; opening the link again joins straight away).
  const [left, setLeft] = useState(false);
  function leave(forget = true) {
    clearTimeout(watchdog.current); live.current = false;
    joinedRef.current = false;
    try { wake.current?.release(); } catch {} wake.current = null;
    stopDeviceMusic(); setMusic(null); musicRef.current = null;
    stopMic();
    for (const k of [...pcs.current.keys()]) closePc(k);
    if (pull.current) { pull.current.keys().forEach(dropRelay); pull.current.close(); pull.current = null; }
    if (push.current) { push.current.close(); push.current = null; }
    sfuMeta.current = null; tracked.current = false;
    levels.current.forEach((f) => f()); levels.current.clear();
    // Remove the room connection completely (not just switch it off): opening the live again must get a fresh one.
    const old = chan.current; chan.current = null;
    if (old) { try { supabaseBrowser().removeChannel(old); } catch { try { old.unsubscribe(); } catch {} } }
    setJoined(false); setJoining(false); setPeers({}); setHand(false); setLeft(true);
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
  // Each reaction goes to everyone in the room, so in a big live only a share of taps is sent (about one a second for
  // the whole room); you always see your own. Stage people's reactions always go.
  const countRef = useRef(0);
  const share = () => canSpeakRef.current || Math.random() < Math.min(1, 25 / Math.max(1, countRef.current));
  const myName = () => (hiddenRef.current && !canSpeakRef.current ? "Someone" : me.alias);
  function float(e: string, n?: string) {
    const k = ++fk.current;
    setFloaters((f) => [...f.slice(-14), { k, e, x: 10 + Math.random() * 80, n }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2600);
    if (n) { setReacts((r) => [{ k, e, n }, ...r.filter((x) => !(x.n === n && x.e === e))].slice(0, 6)); setTimeout(() => setReacts((r) => r.filter((x) => x.k !== k)), 6000); }
  }
  // Reactions show on your screen every tap, but go to the room at most ~4 a second (keeps it under rate limits).
  const lastSend = useRef(0);
  const react = (e: string) => { float(e, "You"); const t = Date.now(); if (t - lastSend.current > 250 && share()) { lastSend.current = t; send("react", { e, n: myName() }); } };
  const blazeT = useRef<any>(null);
  function fireBurst(who?: string, fromId?: string) {
    setFires((n) => n + 1);
    if (fromId) {
      const at = Date.now();
      setFireOn((m) => ({ ...m, [fromId]: at }));
      setTimeout(() => setFireOn((m) => { if (m[fromId] !== at) return m; const { [fromId]: _gone, ...rest } = m; return rest; }), 2500);
    }
    if (who) { const k = ++fk.current; setReacts((r) => [{ k, e: "🔥", n: who }, ...r.filter((x) => !(x.n === who && x.e === "🔥"))].slice(0, 6)); setTimeout(() => setReacts((r) => r.filter((x) => x.k !== k)), 6000); }
    for (let i = 0; i < 4; i++) setTimeout(() => {
      const k = ++fk.current;
      setFloaters((f) => [...f.slice(-16), { k, e: "🔥", x: 4 + Math.random() * 92, big: true, n: i === 0 ? who : undefined }]);
      setTimeout(() => setFloaters((f) => f.filter((x) => x.k !== k)), 2800);
    }, i * 70);
    setBlaze(true);
    clearTimeout(blazeT.current);
    blazeT.current = setTimeout(() => setBlaze(false), 1400);
  }
  const lastFire = useRef(0);
  const moreFire = () => { fireBurst("You", hiddenRef.current && !canSpeakRef.current ? "" : me.id); const t = Date.now(); if (t - lastFire.current > 350 && share()) { lastFire.current = t; send("fire", { n: myName() }); } try { navigator.vibrate?.(30); } catch {} };

  // Everyone on live presence, plus (in a big live) the listeners known from check-ins.
  const list = useMemo(() => {
    const out = Object.values(peers).sort((a, b) => a.at - b.at);
    if (crowd.people.length) { const seen = new Set(out.map((p) => p.id)); for (const p of crowd.people) if (!seen.has(p.id)) out.push(p); }
    return out;
  }, [peers, crowd.people]);
  const roomCount = Math.max(list.length, crowd.count);
  countRef.current = roomCount;
  const onStage = list.filter((p) => roleOf(p.id) !== "listener").sort((a, b) => ["host", "cohost", "speaker"].indexOf(roleOf(a.id)) - ["host", "cohost", "speaker"].indexOf(roleOf(b.id)));
  const audience = list.filter((p) => roleOf(p.id) === "listener");
  // What the floating window shows (read by its drawing timer).
  pipInfo.current = { title: room.title, speaking: onStage.filter((p) => talking[p.id] && !p.muted).map((p) => (p.id === me.id ? "You" : p.alias)).slice(0, 2).join(", "),
    count: roomCount, muted, canSpeak };
  try { (navigator as any).mediaSession?.setMicrophoneActive?.(canSpeak && !muted); } catch {}
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
      <a className="btn primary" href={`/spaces/${room.id}`}>📊 See the summary: who joined, comments and tokens sent</a>
      {saved && <a className="btn" href={`/spaces/${room.id}`}>🎧 Listen back on the live&apos;s page</a>}
      <Link className="btn" href="/spaces">See other lives</Link>
    </div>
  );

  const myTile = (p: Peer) => p.id === me.id;

  return (
    <div className={mini ? "lv-mini" : "lv stack" + (blaze ? " blaze" : "")} onClick={() => { if (needTap || [...audios.current.values()].some((a) => a.paused)) unlockAudio(); }}>
      {mini ? (
        <Link href={`/spaces/${room.id}`} className="lv-mini-t" title="Open the live">
          <span className="room-live"><i />Live</span>
          <span className="lv-mini-txt"><b>{room.title}</b><small>{onStage.filter((p) => talking[p.id] && !p.muted).map((p) => p.alias).slice(0, 2).join(", ") || `${fmt(roomCount)} here`}{recOn ? " · 🔴 REC" : ""}</small></span>
        </Link>
      ) : (
        <div className="lv-top">
          <span className="room-live"><i />Live</span>
          <h1>{room.title}</h1>
          <div className="lv-count">
            <b>👥 {fmt(roomCount)} in the room</b>
            <small className="muted">🎙 {onStage.length} speaking · 🎧 {fmt(Math.max(audience.length, roomCount - onStage.length))} listening{openMic ? " · Open mic" : ""}</small>
            {joined && <button type="button" className="lv-mini-btn" onClick={() => setShowAll(true)}>See all</button>}
            {joined && canRun && hands.length > 0 && !openMic && <button type="button" className="lv-mini-btn hand" onClick={() => document.querySelector(".lv-hands")?.scrollIntoView({ behavior: "smooth", block: "center" })}>✋ {hands.length} want{hands.length === 1 ? "s" : ""} to speak</button>}
            {joined && !canSpeak && <button type="button" className="lv-mini-btn" onClick={toggleHide} aria-pressed={hidden}>{hidden ? "👁 Show me" : "🙈 Hide me"}</button>}
            {room.token && room.chain ? <Link className="lv-mini-btn" href={`/launchpad/${room.chain}/${room.token}`} target="_blank">View the coin</Link> : null}
          </div>
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
          <button type="button" className="btn primary" disabled={joining} onClick={join}>{joining ? "Joining…" : isHost ? "Start the live" : left ? "Join again" : "Join the live"}</button>
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
          {roomMusic && (
            <RoomMusic music={roomMusic} mine={roomMusic.from === me.id} picture={roomMusic.from === me.id ? null : musicStreams[roomMusic.from] || null}
              onStop={roomMusic.from === me.id ? stopMusic : undefined} onPause={roomMusic.from === me.id && roomMusic.k === "file" ? pauseMusic : undefined}
              onVolume={roomMusic.from !== me.id && roomMusic.k === "file" ? setMusicVolume : undefined} />
          )}
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
              <button type="button" className={"btn small" + (music ? " primary" : "")} onClick={() => setMusicPanel((v) => !v)} aria-expanded={musicPanel}>🎵 {music ? "Music: on" : "Music"}</button>
            </div>
          )}
          {canRun && musicPanel && <MusicPanel me={me.alias} canFile={sfu.current} playing={!!music} onLink={playLink} onFile={playFile} onStop={stopMusic} onClose={() => setMusicPanel(false)} />}

          <section className={"lv-stage" + (onStage.length > 4 ? " dense" : "")} aria-label="On stage">
            {onStage.map((p) => {
              const role = roleOf(p.id);
              const mine = myTile(p);
              const isTalking = talking[p.id] && !p.muted && !(mine && muted);
              const pMuted = mine ? muted : p.muted;
              return (
                <div key={p.id} className={"lv-box flat" + (isTalking ? " talking" : "") + (mine ? " me" : "")}>
                  <button type="button" className={"lv-face big" + (isTalking ? " talking" : "")} onClick={() => setSheet(p)} aria-label={`${p.alias}, ${badge[role]}`}>
                    <Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} />
                    {fireOn[p.id] && <i className="lv-firedot" aria-label={`${mine ? "You" : p.alias} sent fire`}><Emo e="🔥" size={16} /></i>}
                    <span className="lv-name xs">{mine ? "You" : p.alias}{p.ver && <VerifiedBadge n={p.vb} size={12} className="vbadge-name" />}{role === "host" ? " · Host" : role === "cohost" ? " · Co-host" : ""}</span>
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

          <section className={"lv-crowd" + (audience.length > 24 ? " packed" : audience.length > 10 ? " dense" : "")} aria-label="Listening">
            {[...audience.filter((p) => myTile(p)), ...audience.filter((p) => !myTile(p))].slice(0, 30).map((p) => (
              <div key={p.id} className={"lv-box sm" + (myTile(p) ? " me" : "")}>
                <button type="button" className="lv-face" onClick={() => setSheet(p)} title={p.alias} aria-label={`${p.alias}, ${followers[p.id] ?? 0} followers`}>
                  <span className="lv-ring">{p.hand && <i className="lv-handdot" aria-hidden="true">✋</i>}{fireOn[p.id] && <i className="lv-firedot sm" aria-label={`${myTile(p) ? "You" : p.alias} sent fire`}><Emo e="🔥" size={12} /></i>}<Avatar className="avatar lv-av" alias={p.alias} color={p.color} url={p.avatar_url} /></span>
                  <span className="lv-name sm">{myTile(p) ? "You" : p.alias}</span>
                </button>
                {myTile(p) ? (
                  <button type="button" className={"lv-mic off" + (hand ? " hand" : "")} onClick={raiseHand} aria-pressed={hand}>{openMic ? "🎙️ Speak" : hand ? "✋ Lower" : "✋ Ask to speak"}</button>
                ) : canRun ? (
                  <button type="button" className="lv-mini-btn" onClick={() => invite(p.id)}>{p.hand ? "✋ Invite" : "Invite"}</button>
                ) : <span className="lv-f">{fmt(followers[p.id] ?? 0)}</span>}
              </div>
            ))}
            {audience.length > 30 && <button type="button" className="lv-mini-btn" onClick={() => setShowAll(true)}>+{audience.length - 30} more · See all</button>}
            {!audience.length && <small className="muted">No listeners yet. Share the link so people can join.</small>}
          </section>

          <div className="lv-floats" aria-hidden="true">{floaters.map((f) => <span key={f.k} className={f.big ? "big" : undefined} style={{ left: `${f.x}%` }}><Emo e={f.e} size={f.big ? 28 : 22} />{f.n && <em className="lv-float-n">{f.n}</em>}</span>)}</div>
          {reacts.length > 0 && <div className="lv-reacts" aria-live="polite">{reacts.map((r) => <span key={r.k} className="lv-react-chip"><Emo e={r.e} size={14} /> {r.n}</span>)}</div>}

          <div className="lv-hype" role="group" aria-label="Hype">
            <button type="button" className="lv-fire sm" onClick={moreFire} aria-label="More fire">
              <span className="lv-fire-ic" aria-hidden="true"><Emo e="🔥" size={16} /></span>
              <span className="lv-fire-t"><b>FIRE</b>{fires > 0 && <small>{fmt(fires)}</small>}</span>
            </button>
            {REACTIONS.filter((e) => e !== "🔥").map((e) => <button key={e} type="button" className="lv-emo" onClick={() => react(e)} aria-label={`React ${e}`}><Emo e={e} size={16} /></button>)}
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
          {pipOk && <Ctl icon="float" label={floating ? "Floating" : "Float"} on={floating} title="Keep the live in a small window over other apps" onClick={popOut} pressed={floating} />}
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

      {!mini && showAll && (
        <div className="lv-all-bg" onClick={() => setShowAll(false)}>
          <div className="lv-all" role="dialog" aria-modal="true" aria-label="Everyone in the room" onClick={(e) => e.stopPropagation()}>
            <div className="lv-all-h"><b>👥 {fmt(roomCount)} in the room</b><button type="button" className="lv-mini-btn" onClick={() => setShowAll(false)}>Close</button></div>
            <input className="input" placeholder="Search names" value={allQ} onChange={(e) => setAllQ(e.target.value)} aria-label="Search people in the room" />
            <div className="lv-all-list">
              {[...onStage, ...audience].filter((p) => !allQ.trim() || p.alias.toLowerCase().includes(allQ.trim().toLowerCase())).map((p) => {
                const role = roleOf(p.id);
                return (
                  <div key={p.id} className="lv-all-row">
                    <button type="button" className="lv-all-who" onClick={() => { if (!p.hid) { setSheet(p); setShowAll(false); } }}>
                      <Avatar className="avatar lv-av xs" alias={p.alias} color={p.color} url={p.avatar_url} />
                      <span><b>{myTile(p) ? "You" : p.alias}</b><small className="muted">{role === "listener" ? (p.hand ? "✋ wants to speak" : "Listening") : badge[role]}{role !== "listener" ? (p.muted ? " · muted" : " · mic on") : ""}</small></span>
                    </button>
                    {canRun && !myTile(p) && role === "listener" && <button type="button" className="lv-mini-btn" onClick={() => invite(p.id)}>{p.hand ? "✋ Invite" : "Invite"}</button>}
                    {canRun && !myTile(p) && role === "speaker" && <button type="button" className="lv-mini-btn" onClick={() => moveDown(p.id)}>Move down</button>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
