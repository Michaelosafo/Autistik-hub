"use client";
import { useState } from "react";

/** For the host of a private live: the invite link to share (only people with it can get in). */
export default function InviteLink({ roomId, code }: { roomId: string; code: string }) {
  const [done, setDone] = useState(false);
  const url = typeof window === "undefined" ? `/spaces/${roomId}?key=${code}` : `${location.origin}/spaces/${roomId}?key=${code}`;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* copy blocked: the link is on screen */ }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: "Join my private live on AUTISTIK", url }); return; } catch { /* closed */ } }
    copy();
  }
  return (
    <section className="card stack lv-invite">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <b>🔒 Private live</b>
        <small className="muted">Not listed. Only people with this link can join.</small>
      </div>
      <code className="lv-invite-url">{url}</code>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" onClick={copy}>{done ? "Copied ✓" : "Copy invite link"}</button>
        <button type="button" className="btn" onClick={share}>Share</button>
      </div>
    </section>
  );
}
