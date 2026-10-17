"use client";
import { useState } from "react";
import Link from "next/link";
import { enablePush, hasPush } from "@/lib/push-client";

/** Pin a token to get buy / take-profit / sell / wait alerts on this device. */
export default function PinButton({ signedIn, chain, token, pinned }: { signedIn: boolean; chain: string; token: string; pinned: boolean }) {
  const [on, setOn] = useState(pinned);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  if (!signedIn) return <Link className="btn pin-btn" href="/login?next=/analytics">📌 Pin for signals</Link>;

  async function toggle() {
    setBusy(true); setNote("");
    const r = await fetch("/api/analytics/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token, on: !on }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote(d.error || "Couldn't pin it. Try again."); return; }
    setOn(!on);
    if (!on && !(await hasPush())) {
      const res = await enablePush();
      setNote(res === "push" ? "📲 Alerts will reach this device, even with the site closed."
        : res === "local" ? "Alerts show in 🔔 and as pop-ups while the site is open. Add the Hub to your home screen for phone alerts."
        : "Notifications are blocked. Turn them on in your browser settings to get alerts.");
    } else if (!on) setNote("📲 Pinned. You'll get an alert when it's time to buy, take profit, sell or wait.");
  }
  return (
    <span className="stack" style={{ gap: 4 }}>
      <button className={"btn pin-btn" + (on ? " on" : "")} type="button" aria-pressed={on} disabled={busy} onClick={toggle}
        title={on ? "Stop signal alerts for this token" : "Get buy, take-profit, sell and wait alerts for this token"}>
        📌 {on ? "Pinned" : "Pin for signals"}
      </button>
      {note && <small className="muted" style={{ maxWidth: 260 }}>{note}</small>}
    </span>
  );
}
