"use client";
import { useEffect, useState } from "react";

/**
 * "Install app" button. On Android/Chrome it opens the install prompt. On iPhone/iPad (no prompt there)
 * it shows the two taps to add the Hub to the home screen. Hidden once the Hub is opened as an app.
 */
export default function InstallApp() {
  const [prompt, setPrompt] = useState<any>(null);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setInstalled(standalone);
    if (standalone) return;
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  async function install() {
    if (prompt) {
      prompt.prompt();
      try { await prompt.userChoice; } catch {}
      setPrompt(null);
    } else setHelp(!help);
  }

  return (
    <>
      <button className="chip toggle" type="button" onClick={install} aria-expanded={ios ? help : undefined}>📲 Install app</button>
      {help && (
        <div className="install-help notice" role="dialog" aria-label="Add the Hub to your home screen">
          <b>Add the Hub to your home screen</b>
          <ol>
            <li>Tap the <b>Share</b> button (the square with an arrow) at the bottom of Safari.</li>
            <li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
          </ol>
          <button className="btn small" type="button" onClick={() => setHelp(false)}>Got it</button>
        </div>
      )}
    </>
  );
}
