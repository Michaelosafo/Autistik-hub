"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Tells the site which page was opened, for the admin's visit counts. No personal details are sent. */
export default function Tracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path.startsWith("/admin")) return;
    const body = JSON.stringify({ path, ref: document.referrer });
    try {
      if (!navigator.sendBeacon?.("/api/track", new Blob([body], { type: "application/json" }))) {
        fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }, [path]);
  return null;
}
