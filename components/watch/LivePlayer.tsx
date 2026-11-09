"use client";
/**
 * Watches a live stream over WebRTC (WHEP): the picture arrives in about a second. Starts muted (phones only allow
 * silent autoplay); tap for sound. Reconnects if the connection drops.
 */
import { useEffect, useRef, useState } from "react";

export default function LivePlayer({ whep }: { whep: string }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState<"connecting" | "playing" | "lost">("connecting");
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let closed = false;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }], bundlePolicy: "max-bundle" });
    const ms = new MediaStream();
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.ontrack = (e) => { ms.addTrack(e.track); if (vid.current && vid.current.srcObject !== ms) { vid.current.srcObject = ms; vid.current.play().catch(() => {}); } };
    pc.onconnectionstatechange = () => {
      if (closed) return;
      if (pc.connectionState === "connected") setState("playing");
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") { setState("lost"); setTimeout(() => !closed && setTries((t) => t + 1), 4000); }
    };
    let res: string | null = null;
    (async () => {
      try {
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise<void>((done) => { if (pc.iceGatheringState === "complete") return done(); const t = setTimeout(done, 2000); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); done(); } }); });
        const r = await fetch(whep, { method: "POST", headers: { "content-type": "application/sdp" }, body: pc.localDescription!.sdp });
        if (!r.ok) throw new Error(String(r.status));
        const loc = r.headers.get("location"); res = loc ? new URL(loc, whep).toString() : null;
        await pc.setRemoteDescription({ type: "answer", sdp: await r.text() });
      } catch { if (!closed) { setState("lost"); setTimeout(() => !closed && setTries((t) => t + 1), 5000); } }
    })();
    return () => { closed = true; if (res) fetch(res, { method: "DELETE" }).catch(() => {}); pc.close(); };
  }, [whep, tries]);

  return (
    <div className="wv-liveplay">
      <video ref={vid} playsInline autoPlay muted={muted} />
      {state !== "playing" && <div className="wv-wait">{state === "connecting" ? "Connecting to the stream…" : "Reconnecting…"}</div>}
      {state === "playing" && muted && <button type="button" className="wv-unmute" onClick={() => { setMuted(false); vid.current?.play().catch(() => {}); }}>🔊 Tap for sound</button>}
    </div>
  );
}
