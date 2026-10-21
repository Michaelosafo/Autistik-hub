"use client";
import { useEffect, useRef, useState } from "react";
import Art from "@/components/Art";

/** How long Autistik says hi before the page opens, and how long the opening takes. */
const HELLO_MS = 2800;
const OPEN_MS = 800;

/**
 * The first thing a visitor sees: Autistik, the AUTISTIK mascot, pops up and says hi, then the page opens around it.
 * Once per visit (a new tab or a fresh visit shows it again). Tap, Enter or Escape skips it. With calm mode or
 * reduced motion there's no movement: Autistik just says hi and the page appears.
 * The layout's early script hides it before the page paints when it was already shown this visit, so it never flashes.
 */
export default function Welcome() {
  const [phase, setPhase] = useState<"hello" | "open" | "gone">("hello");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const still = useRef(false);

  const open = () => {
    timers.current.forEach(clearTimeout);
    if (still.current) { setPhase("gone"); return; }
    setPhase("open");
    timers.current = [setTimeout(() => setPhase("gone"), OPEN_MS)];
  };

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("welcomed") === "1"; sessionStorage.setItem("welcomed", "1"); } catch {}
    if (seen) { setPhase("gone"); return; }
    still.current = document.documentElement.dataset.calm === "on" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    timers.current = [setTimeout(open, HELLO_MS)];
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") open(); };
    document.addEventListener("keydown", key);
    return () => { timers.current.forEach(clearTimeout); document.removeEventListener("keydown", key); };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={"welcome" + (phase === "open" ? " opening" : "")} role="dialog" aria-modal="true" aria-label="Welcome to AUTISTIK" onClick={open}>
      <div className="welcome-in">
        <div className="welcome-bubble" aria-live="polite">
          <b>Hi, welcome to AUTISTIK!</b>
          <span>I&apos;m Autistik, the mascot.</span>
        </div>
        <Art kind="robot" who="autistik" mood="okay" className="welcome-bot" />
        <button type="button" className="welcome-skip" onClick={(e) => { e.stopPropagation(); open(); }}>Open the site</button>
      </div>
    </div>
  );
}
