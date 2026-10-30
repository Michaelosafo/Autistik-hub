"use client";
/**
 * Google's own "Continue with Google" button (Google Identity Services). Google signs the person in on this page, so
 * its screen shows "autistik.io", not the Supabase project address that the old redirect showed. The signed ID token
 * goes to /api/auth/google, which hands it to Supabase. Shown only when NEXT_PUBLIC_GOOGLE_CLIENT_ID is set.
 */
import { useEffect, useRef, useState } from "react";

export const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "").trim();

declare global { interface Window { google?: any } }

const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

let loading: Promise<void> | null = null;
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => { loading = null; fail(new Error("load")); };
    document.head.appendChild(s);
  });
  return loading;
}

export default function GoogleSignIn({ next, onError, onBusy }: { next: string; onError: (m: string) => void; onBusy: (b: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        await loadGis();
        // Google puts a hash of this one-time code in its token; Supabase checks it against the code itself.
        const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, "0")).join("");
        const hashed = await sha256(raw);
        if (gone || !box.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: hashed,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          callback: async (r: { credential?: string }) => {
            if (!r?.credential) { onError("Google sign-in didn't finish. Please try again."); return; }
            onBusy(true); onError("");
            const res = await fetch("/api/auth/google", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ credential: r.credential, nonce: raw, next }) })
              .then((x) => x.json()).catch(() => null);
            if (res?.to) { window.location.assign(res.to); return; }
            onBusy(false);
            onError(res?.error || "Google sign-in didn't finish. Please try again, or use your email.");
          },
        });
        window.google.accounts.id.renderButton(box.current, {
          type: "standard", theme: "outline", size: "large", shape: "rectangular", text: "continue_with", logo_alignment: "center",
          width: Math.min(400, Math.max(200, Math.round(box.current.getBoundingClientRect().width) || 320)),
        });
      } catch { if (!gone) setFailed(true); }
    })();
    return () => { gone = true; };
  }, [next, onError, onBusy]);

  if (failed) return <p className="muted" style={{ margin: 0, fontSize: ".86em" }}>Google sign-in couldn&apos;t load. Check your connection, or use your email below.</p>;
  return <div ref={box} className="gsi-box" aria-label="Continue with Google" />;
}
