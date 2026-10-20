"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Sign-in and account pages are never counted (their addresses can carry one-time codes). */
const PRIVATE = /^\/(admin|login|auth|reset-password|me)(\/|$)/;

/** Only which other site sent the visitor (e.g. "x.com"): never the full address, its query or fragment. */
function refHost() {
  try { const r = new URL(document.referrer); return r.protocol === "https:" && r.hostname !== location.hostname ? r.hostname : ""; } catch { return ""; }
}

/** Tells the site which page was opened, for the admin's visit counts. No personal details are sent. */
export default function Tracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || PRIVATE.test(path)) return;
    const body = JSON.stringify({ path, ref: refHost() });
    try {
      if (!navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) {
        fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }, [path]);
  return null;
}
