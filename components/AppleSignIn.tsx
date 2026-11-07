"use client";
/**
 * "Continue with Apple" on autistik.io (Sign in with Apple JS, popup). Apple's window says AUTISTIK, not the Supabase
 * project address that the old redirect showed. The signed ID token goes to /api/auth/apple, which hands it to
 * Supabase. Shown only when NEXT_PUBLIC_APPLE_CLIENT_ID (the Apple Services ID) is set; otherwise the old redirect.
 *
 * Apple setup: the Services ID lists autistik.io under Domains and https://autistik.io/login under Return URLs, and
 * Supabase → Sign In / Providers → Apple lists the Services ID under Client IDs. No secret key is needed for this.
 */
import { useEffect, useRef, useState } from "react";

export const APPLE_CLIENT_ID = (process.env.NEXT_PUBLIC_APPLE_CLIENT_ID || "").trim();

declare global { interface Window { AppleID?: any } }

const SRC = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");

let loading: Promise<void> | null = null;
function loadApple() {
  if (window.AppleID?.auth) return Promise.resolve();
  loading ??= new Promise<void>((ok, fail) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => { loading = null; fail(new Error("load")); };
    document.head.appendChild(s);
  });
  return loading;
}

export default function AppleSignIn({ next, onError, onBusy, disabled }: { next: string; onError: (m: string) => void; onBusy: (b: boolean) => void; disabled?: boolean }) {
  const raw = useRef("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Load Apple's script and get a one-time code ready before the tap, so the popup opens straight from the tap
  // (iPhones block popups that open later).
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        await loadApple();
        raw.current = randomHex();
        const hashed = await sha256(raw.current);
        if (gone) return;
        window.AppleID.auth.init({
          clientId: APPLE_CLIENT_ID,
          scope: "name email",
          redirectURI: `${window.location.origin}/login`,
          state: randomHex(),
          nonce: hashed, // Apple puts this hash in its token; Supabase checks it against the code itself.
          usePopup: true,
        });
        setReady(true);
      } catch { if (!gone) setFailed(true); }
    })();
    return () => { gone = true; };
  }, []);

  async function go() {
    if (!ready) { onError("One moment: Apple sign-in is still loading."); return; }
    onError("");
    let data: any;
    try {
      data = await window.AppleID.auth.signIn();
    } catch (e: any) {
      const code = String(e?.error || e?.message || "");
      if (!/popup_closed_by_user|user_cancelled_authorize/i.test(code)) onError("Apple sign-in didn't finish. Please try again, or use your email.");
      return;
    }
    const credential = data?.authorization?.id_token;
    if (!credential) { onError("Apple sign-in didn't finish. Please try again."); return; }
    onBusy(true);
    const res = await fetch("/api/auth/apple", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential, nonce: raw.current, next }) })
      .then((x) => x.json()).catch(() => null);
    if (res?.to) { window.location.assign(res.to); return; }
    onBusy(false);
    onError(res?.error || "Apple sign-in didn't finish. Please try again, or use your email.");
  }

  if (failed) return <p className="muted" style={{ margin: 0, fontSize: ".86em" }}>Apple sign-in couldn&apos;t load. Check your connection, or use your email below.</p>;
  return (
    <button type="button" className="btn oauth-btn apple" disabled={disabled || !ready} onClick={go}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.4-4.3zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" /></svg>
      Continue with Apple
    </button>
  );
}
