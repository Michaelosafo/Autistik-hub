"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Room music: the host or a co-host plays something for everyone while they wait (or any time).
 *  - A link (YouTube, Vimeo, SoundCloud, Spotify): it shows like a video on everyone's screen, started at the same
 *    point for everyone (people who join later pick it up where it is now).
 *  - A song or video from their own phone: its sound goes into the room through the voice relay (a video file's
 *    picture too, where the browser allows), with a "Now playing" card for everyone.
 */
export type Music = {
  k: "yt" | "vimeo" | "sc" | "spotify" | "link" | "file";
  id?: string; // YouTube / Vimeo video id, or "type/id" for Spotify
  u?: string; // the original link (SoundCloud, other sites)
  t: string; // title shown
  at: number; // when it started (for joining mid-song)
  by: string; // who's playing it
  paused?: boolean;
  vid?: boolean; // a video file with its picture going out
};

const YT = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO = /^\d{5,12}$/;
const SPOT = /^(track|album|playlist|episode|show)\/[A-Za-z0-9]{10,40}$/;

/** Read a pasted link. Null: not a link we can play. */
export function parseMusicLink(raw: string, by: string): Music | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  const at = Date.now();
  let id = "";
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") id = u.searchParams.get("v") || (u.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/)?.[1] ?? "");
  if (YT.test(id)) return { k: "yt", id, t: "YouTube", at, by };
  if (host === "vimeo.com" || host === "player.vimeo.com") { const v = u.pathname.match(/(\d{5,12})/)?.[1]; if (v) return { k: "vimeo", id: v, t: "Vimeo", at, by }; }
  if (host === "soundcloud.com" || host === "on.soundcloud.com") return { k: "sc", u: `https://${u.hostname}${u.pathname}`, t: "SoundCloud", at, by };
  if (host === "open.spotify.com") { const m = u.pathname.replace(/^\/intl-[a-z-]+/, "").match(/^\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/); if (m) return { k: "spotify", id: `${m[1]}/${m[2]}`, t: "Spotify", at, by }; }
  return { k: "link", u: u.toString().slice(0, 500), t: host, at, by };
}

/** The player's address (checked again here: the details come from other people's phones). */
function embedOf(m: Music, startSec: number): string | null {
  if (m.k === "yt" && m.id && YT.test(m.id)) return `https://www.youtube-nocookie.com/embed/${m.id}?autoplay=1&playsinline=1&rel=0&start=${startSec}`;
  if (m.k === "vimeo" && m.id && VIMEO.test(m.id)) return `https://player.vimeo.com/video/${m.id}?autoplay=1#t=${startSec}s`;
  if (m.k === "sc" && m.u && /^https:\/\/(on\.)?soundcloud\.com\/[\w\-/]+$/.test(m.u)) return `https://w.soundcloud.com/player/?url=${encodeURIComponent(m.u)}&auto_play=true&visual=true`;
  if (m.k === "spotify" && m.id && SPOT.test(m.id)) return `https://open.spotify.com/embed/${m.id}?autoplay=1`;
  return null;
}

/** What everyone sees while music plays. */
export default function RoomMusic({ music, mine, picture, onStop, onPause, onVolume }: {
  music: Music & { from: string }; mine: boolean; picture: MediaStream | null;
  onStop?: () => void; onPause?: () => void; onVolume?: (v: number) => void;
}) {
  // Join mid-song at the right point; the player is made once per song (not on every room update).
  const src = useMemo(() => embedOf(music, Math.max(0, Math.floor((Date.now() - music.at) / 1000))), [music.at, music.k, music.id, music.u]); // eslint-disable-line react-hooks/exhaustive-deps
  const vref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (vref.current && vref.current.srcObject !== picture) vref.current.srcObject = picture; }, [picture]);
  const [vol, setVol] = useState(1);
  const tall = music.k === "yt" || music.k === "vimeo";
  const safeLink = music.k === "link" && music.u && /^https:\/\//.test(music.u) ? music.u : null;

  return (
    <section className="lv-music" aria-label="Room music" style={{ margin: "10px 0", borderRadius: 14, overflow: "hidden", background: "rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.08)" }}>
      {src ? (
        <div style={{ position: "relative", width: "100%", aspectRatio: tall ? "16 / 9" : undefined, height: tall ? undefined : music.k === "spotify" ? 152 : 166 }}>
          <iframe key={src} src={src} title={`Room music: ${music.t}`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
        </div>
      ) : music.k === "file" ? (
        <div style={{ position: "relative", display: "grid", placeItems: "center", minHeight: picture ? undefined : 150, aspectRatio: picture ? "16 / 9" : undefined, background: "radial-gradient(circle at 30% 20%, #3b2a6b, #120d22 70%)" }}>
          {picture ? <video ref={vref} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} /> : (
            <div className={"lv-eq" + (music.paused ? " paused" : "")} aria-hidden="true" style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 64 }}>
              {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ display: "block", width: 7, borderRadius: 4, background: "linear-gradient(#c9a7ff,#7a4dff)", height: 14, animation: music.paused ? "none" : `lvEq ${0.7 + (i % 5) * 0.13}s ease-in-out ${i * 0.05}s infinite alternate` }} />)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 14 }}>{safeLink ? <a className="btn small" href={safeLink} target="_blank" rel="noopener noreferrer nofollow">▶ Open on {music.t}</a> : <small className="muted">Music is playing.</small>}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎵 {music.k === "file" ? music.t : `Playing from ${music.t}`}{music.paused ? " · paused" : ""}</b>
          <small className="muted">{mine ? "You're playing this for everyone" : `${music.by} is playing this for the room`}</small>
        </span>
        {onVolume && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}><small>🔈</small>
            <input type="range" min={0} max={1} step={0.05} value={vol} aria-label="Music volume" onChange={(e) => { const v = Number(e.target.value); setVol(v); onVolume(v); }} />
          </label>
        )}
        {onPause && <button type="button" className="btn small" onClick={onPause}>{music.paused ? "▶ Play" : "⏸ Pause"}</button>}
        {onStop && <button type="button" className="btn small" onClick={onStop}>⏹ Stop</button>}
      </div>
      <style>{`@keyframes lvEq{from{height:10px}to{height:62px}}`}</style>
    </section>
  );
}

/** Host / co-host panel: paste a link, or pick a song or video on this phone. */
export function MusicPanel({ me, canFile, playing, onLink, onFile, onStop, onClose }: {
  me: string; canFile: boolean; playing: boolean;
  onLink: (m: Music) => void; onFile: (f: File) => void; onStop: () => void; onClose: () => void;
}) {
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);
  function go() {
    const m = parseMusicLink(link, me);
    if (!m) { setErr("Paste a full link that starts with https://"); return; }
    setErr(""); onLink(m); setLink("");
  }
  return (
    <section className="lv-music-panel card" aria-label="Play music for the room" style={{ margin: "10px 0", padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>🎵 Play music for everyone</b>
        <button type="button" className="lv-mini-btn" onClick={onClose}>Close</button>
      </div>
      <small className="muted">Great while people are still coming in. Everyone sees and hears it; you can keep talking over it.</small>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" style={{ flex: 1, minWidth: 0 }} inputMode="url" placeholder="YouTube, Vimeo, SoundCloud or Spotify link" value={link}
          onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} />
        <button type="button" className="btn small primary" onClick={go} disabled={!link.trim()}>▶ Play</button>
      </div>
      {err && <small style={{ color: "#ff8a8a" }}>{err}</small>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn small" onClick={() => file.current?.click()} disabled={!canFile} title={canFile ? undefined : "Needs the voice relay (CLOUDFLARE_SFU_APP_ID)"}>📱 Play from my phone</button>
        {playing && <button type="button" className="btn small" onClick={onStop}>⏹ Stop music</button>}
        <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      </div>
      {!canFile && <small className="muted">Playing from your phone switches on once the voice relay is set up. Links work now.</small>}
    </section>
  );
}
