"use client";
/**
 * "Get the AUTISTIK app" at the top of every page, so everyone can install the app now (before Google Play):
 * Android Chrome / desktop Chrome and Edge get the real install prompt; iPhone shows the two Safari taps; other
 * browsers show where the install option is. Hidden once installed, inside the Play app, or after "Not now" (7 days).
 */
import { useEffect, useState } from "react";

const KEY = "app-banner-hidden-until";

export default function AppBanner() {
  const [show, setShow] = useState(false);
  const [prompt, setPrompt] = useState<any>(null);
  const [help, setHelp] = useState<"" | "ios" | "other">("");

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    const inPlayApp = document.documentElement.dataset.app === "android" || document.referrer.startsWith("android-app://");
    let hiddenUntil = 0;
    try { hiddenUntil = Number(localStorage.getItem(KEY) || 0); } catch {}
    if (standalone || inPlayApp || Date.now() < hiddenUntil) return;
    setShow(true);
    const w = window as any;
    if (w.__bip) setPrompt(w.__bip);
    const got = () => setPrompt(w.__bip);
    const done = () => setShow(false);
    window.addEventListener("bip", got);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("bip", got); window.removeEventListener("appinstalled", done); };
  }, []);

  if (!show) return null;
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  async function install() {
    if (prompt) {
      prompt.prompt();
      try { const c = await prompt.userChoice; if (c?.outcome === "accepted") setShow(false); } catch {}
      (window as any).__bip = null; setPrompt(null);
      return;
    }
    setHelp(help ? "" : ios ? "ios" : "other");
  }
  function later() {
    try { localStorage.setItem(KEY, String(Date.now() + 7 * 86400_000)); } catch {}
    setShow(false);
  }

  return (
    <div className="appbar" role="region" aria-label="Get the AUTISTIK app">
      <div className="appbar-in">
        <img src="/icons/icon-192.png" alt="" width={34} height={34} />
        <span className="appbar-t"><b>Get the AUTISTIK app</b><small>Test version: install it now, before it&apos;s on Google Play</small></span>
        <button type="button" className="appbar-go" onClick={install}>{prompt ? "Install" : "How to install"}</button>
        <button type="button" className="appbar-x" onClick={later} aria-label="Not now">✕</button>
      </div>
      {help === "ios" && (
        <ol className="appbar-help">
          <li>Open autistik.io in <b>Safari</b>.</li>
          <li>Tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>, then <b>Add</b>.</li>
        </ol>
      )}
      {help === "other" && (
        <ol className="appbar-help">
          <li>On Android, open autistik.io in <b>Chrome</b>, tap the <b>⋮</b> menu, then <b>Install app</b> (or <b>Add to Home screen</b>).</li>
          <li>On a computer, use Chrome or Edge and click the <b>install icon</b> at the right of the address bar.</li>
        </ol>
      )}
    </div>
  );
}
