"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { dismissPending, getState, subscribe } from "@/lib/connect";

/**
 * Shown while a request is waiting in the member's wallet: "Approve in Trust Wallet" with a button that opens the
 * wallet app (phones), or where to find the pop-up (extensions and wallet browsers). Goes away when it's answered.
 */
export default function ApproveBar() {
  const s = useSyncExternalStore(subscribe, getState, getState);
  const p = s.pending;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!p) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [p]);
  if (!p) return null;
  const secs = Math.round((Date.now() - p.since) / 1000);
  const ext = typeof navigator !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return (
    <div className="apb" role="status" aria-live="polite">
      <span className="apb-spin" aria-hidden="true" />
      <div className="apb-t">
        <b>Approve {p.what} in {p.name}</b>
        <small>
          {p.mobileWc
            ? (secs > 25 ? `Nothing in ${p.name}? Open it, check its notifications, then come back. If it still isn't there, close this and try again.` : `Open ${p.name}, approve, then come back here.`)
            : ext
              ? (secs > 20 ? "Still waiting. Click your wallet's icon in the browser's toolbar (top right, maybe under the puzzle icon) to find the request." : "No pop-up? Click your wallet's icon in the browser's toolbar.")
              : (secs > 20 ? "Still waiting. Look for the approval at the bottom of the wallet's screen, or close and try again." : "Approve it in the wallet's window.")}
        </small>
      </div>
      {p.href && <a className="btn small primary apb-open" href={p.href}>Open {p.name}</a>}
      <button type="button" className="apb-x" aria-label="Hide" onClick={dismissPending}>×</button>
    </div>
  );
}
