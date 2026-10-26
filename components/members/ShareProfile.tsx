"use client";
import { useState } from "react";

/** Share a member's profile link (autistik.io/@name): the phone's share sheet, or copy the link. */
export default function ShareProfile({ handle, id, name, small, className }: { handle: string | null; id: string; name: string; small?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  async function share() {
    const url = `${location.origin}${handle ? `/@${handle}` : `/members/${id}`}`;
    try {
      if (navigator.share) { await navigator.share({ title: `${name} on AUTISTIK`, text: `Follow ${name} on AUTISTIK`, url }); return; }
    } catch { /* closed the share sheet: fall back to copying */ }
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt("Copy this link", url); }
  }
  return (
    <button type="button" className={className || `btn ${small ? "small" : ""}`} onClick={share}>
      {done ? "Link copied" : handle ? `Share @${handle}` : "Share profile"}
    </button>
  );
}
