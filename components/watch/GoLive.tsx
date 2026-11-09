"use client";
/**
 * Go live on video from the browser: camera (front or back) or screen, with the mic. The picture goes to the video
 * service over WHIP (WebRTC), which plays it to everyone watching and records it. Comments show as live chat.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { videoApi } from "./data";

type Src = "user" | "environment" | "screen";

export default function GoLive({ resume }: { resume: { id: string; title: string } | null }) {
  const [title, setTitle] = useState(resume?.title || "");
  const [about, setAbout] = useState("");
  const [src, setSrc] = useState<Src>("user");
  const [micOn, setMicOn] = useState(true);
  const [state, setState] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [id, setId] = useState<string | null>(resume?.id ?? null);
  const [msg, setMsg] = useState("");
  const [secs, setSecs] = useState(0);
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const res = useRef<string | null>(null);

  async function capture(s: Src) {
    stream.current?.getTracks().forEach((t) => t.stop());
    const ms = s === "screen"
      ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true })
      : await navigator.mediaDevices.getUserMedia({ video: { facingMode: s, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    // The mic always comes from the microphone (a screen share's own sound is kept too).
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch(() => null);
    mic?.getAudioTracks().forEach((t) => { t.enabled = micOn; ms.addTrack(t); });
    stream.current = ms;
    if (vid.current) { vid.current.srcObject = ms; vid.current.muted = true; vid.current.play().catch(() => {}); }
    return ms;
  }
  useEffect(() => { capture(src).catch(() => setMsg("Allow the camera and microphone to go live.")); return () => { stream.current?.getTracks().forEach((t) => t.stop()); pc.current?.close(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state !== "live") return; const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [state]);

  async function switchSrc(s: Src) {
    setSrc(s);
    try {
      const ms = await capture(s);
      // Already live: swap the picture without stopping the stream.
      const send = pc.current?.getSenders() || [];
      for (const t of ms.getTracks()) { const sd = send.find((x) => x.track?.kind === t.kind); if (sd) await sd.replaceTrack(t); }
    } catch { setMsg(s === "screen" ? "Screen sharing was cancelled or isn't supported on this device." : "Couldn't open that camera."); }
  }
  function toggleMic() { const on = !micOn; setMicOn(on); stream.current?.getAudioTracks().forEach((t) => { t.enabled = on; }); }

  async function start() {
    setMsg(""); setState("connecting");
    try {
      const ms = stream.current || (await capture(src));
      const r = id ? await videoApi<{ whip: string }>("live-whip", { id }) : await videoApi<{ id: string; whip: string }>("live-start", { title, about });
      if ("id" in r) setId(r.id);
      const sid = "id" in r ? r.id : id!;
      const p = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
      pc.current = p;
      ms.getTracks().forEach((t) => p.addTransceiver(t, { direction: "sendonly", streams: [ms] }));
      await p.setLocalDescription(await p.createOffer());
      // Wait (briefly) for the network candidates, then send the offer in one go.
      await new Promise<void>((done) => { if (p.iceGatheringState === "complete") return done(); const t = setTimeout(done, 2500); p.addEventListener("icegatheringstatechange", () => { if (p.iceGatheringState === "complete") { clearTimeout(t); done(); } }); });
      const w = await fetch(r.whip, { method: "POST", headers: { "content-type": "application/sdp" }, body: p.localDescription!.sdp });
      if (!w.ok) throw new Error("The video service didn't accept the stream. Try again.");
      const loc = w.headers.get("location"); res.current = loc ? new URL(loc, r.whip).toString() : null;
      await p.setRemoteDescription({ type: "answer", sdp: await w.text() });
      p.addEventListener("connectionstatechange", () => {
        if (p.connectionState === "connected") { setState("live"); videoApi("live-on", { id: sid }).catch(() => {}); }
        if (p.connectionState === "failed") { setState("idle"); setMsg("The connection dropped. Tap Go live to reconnect."); }
      });
    } catch (e: any) { setState("idle"); setMsg(e.message || "Couldn't go live."); pc.current?.close(); }
  }
  async function end() {
    if (res.current) fetch(res.current, { method: "DELETE" }).catch(() => {});
    pc.current?.close(); pc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    if (id) await videoApi("live-end", { id }).catch(() => {});
    setState("ended");
  }
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <div className="wv-studio">
      <div className="wv-cam">
        <video ref={vid} playsInline muted />
        {state === "live" && <em className="wv-live big">LIVE · {mmss}</em>}
        {state === "ended" && <div className="wv-wait">Stream ended. Thanks for going live!</div>}
      </div>
      {state !== "ended" && (
        <div className="wv-ctl">
          <div className="row" role="group" aria-label="Video source" style={{ gap: 6, flexWrap: "wrap" }}>
            {([["user", "Front camera"], ["environment", "Back camera"], ["screen", "Screen"]] as const).map(([s, l]) => (
              <button key={s} type="button" className={"btn small" + (src === s ? " primary" : "")} onClick={() => switchSrc(s)} aria-pressed={src === s}>{l}</button>
            ))}
            <button type="button" className={"btn small" + (micOn ? "" : " danger")} onClick={toggleMic} aria-pressed={!micOn}>{micOn ? "Mic on" : "Mic off"}</button>
          </div>
          {state === "idle" && !id && <>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Stream title" aria-label="Stream title" />
            <textarea className="input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={2000} rows={2} placeholder="What's it about? (optional)" aria-label="Description" />
          </>}
          {state === "live" ? <button type="button" className="btn danger" onClick={end}>End stream</button>
            : <button type="button" className="btn primary" disabled={state === "connecting" || (!id && !title.trim())} onClick={start}>{state === "connecting" ? "Connecting…" : id ? "Reconnect" : "🎥 Go live"}</button>}
          {id && <Link className="btn small" href={`/watch/${id}`} target="_blank">Open the viewer page (and chat) ↗</Link>}
          <small className="muted">Everyone on TIK can watch while you&apos;re live. Live streams aren&apos;t saved: to keep one, record it on your phone and upload it under Videos.</small>
        </div>
      )}
      {state === "ended" && <div className="row" style={{ gap: 8 }}>{id && <Link className="btn primary" href={`/watch/${id}`}>See your stream</Link>}<Link className="btn" href="/mood?tab=videos">Upload a video</Link><Link className="btn" href="/mood?tab=streams">Back to Livestreams</Link></div>}
      {msg && <div className="notice warn">{msg}</div>}
    </div>
  );
}
