"use client";
import { useEffect, useState } from "react";
import { canPush, enablePush, hasPush } from "@/lib/push-client";

/** Turns on alerts for this phone or computer, and says when they're already on. */
export default function PushButton() {
  const [state, setState] = useState<"on" | "off" | "blocked" | "local" | "unknown">("unknown");
  useEffect(() => {
    if (!("Notification" in window)) { setState("blocked"); return; }
    if (Notification.permission === "denied") { setState("blocked"); return; }
    hasPush().then((on) => setState(on ? "on" : canPush() ? "off" : "local"));
  }, []);
  if (state === "unknown") return null;
  if (state === "on") return <small className="muted">📲 Alerts are on for this device.</small>;
  if (state === "blocked") return <small className="muted">🔕 Notifications are blocked. Turn them on in your browser or phone settings to get alerts.</small>;
  return (
    <button className="btn small" type="button" onClick={async () => { const r = await enablePush(); setState(r === "push" ? "on" : r === "denied" ? "blocked" : "local"); }}>
      📲 Turn on alerts for this device
    </button>
  );
}
