"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** Cloudflare Turnstile site key. When it isn't set, the check is switched off and nothing shows. */
export const TURNSTILE_SITE_KEY = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();

export type HumanCheckHandle = { reset: () => void };

declare global {
  interface Window { turnstile?: any; __turnstileLoading?: Promise<void> }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileLoading) {
    window.__turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { window.__turnstileLoading = undefined; reject(new Error("Turnstile didn't load")); };
      document.head.appendChild(s);
    });
  }
  return window.__turnstileLoading;
}

/**
 * The "are you human" check (Cloudflare Turnstile). Most people never see it: it only asks for a click when
 * something looks like a bot. Calls `onToken` with a one-time token, or "" when the token expires.
 */
const HumanCheck = forwardRef<HumanCheckHandle, { onToken: (t: string) => void }>(function HumanCheck({ onToken }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useImperativeHandle(ref, () => ({
    reset() {
      cb.current("");
      try { if (widget.current && window.turnstile) window.turnstile.reset(widget.current); } catch {}
    },
  }), []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        callback: (t: string) => cb.current(t),
        "expired-callback": () => cb.current(""),
        "error-callback": () => cb.current(""),
      });
    }).catch(() => {});
    return () => {
      gone = true;
      try { if (widget.current && window.turnstile) window.turnstile.remove(widget.current); } catch {}
      widget.current = null;
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="human-check" />;
});

export default HumanCheck;
