"use client";
import { useEffect, useRef, useState } from "react";

/** How long the page takes to open after "Go to site". */
const OPEN_MS = 800;

/** How many visits get the welcome. After that, the site opens straight away. */
const SHOW_TIMES = 2;

/**
 * The first thing a visitor sees: Autistik, the AUTISTIK mascot, says hi. "Go to site" (or Escape) opens the page
 * around it. Shown on a visitor's first SHOW_TIMES visits, once per visit. With calm mode or reduced motion nothing
 * moves and the page appears straight away. The layout's early script hides it before the page paints when it was
 * already shown this visit, so it never flashes.
 */
export default function Welcome() {
  const [phase, setPhase] = useState<"hello" | "open" | "gone">("hello");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const go = useRef<HTMLButtonElement>(null);

  const open = () => {
    try {
      if (sessionStorage.getItem("welcomed") !== "1") localStorage.setItem("welcomes", String(Number(localStorage.getItem("welcomes") || 0) + 1));
      sessionStorage.setItem("welcomed", "1");
    } catch {}
    const still = document.documentElement.dataset.calm === "on" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { setPhase("gone"); return; }
    setPhase("open");
    timer.current = setTimeout(() => setPhase("gone"), OPEN_MS);
  };

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("welcomed") === "1" || Number(localStorage.getItem("welcomes") || 0) >= SHOW_TIMES; } catch {}
    if (seen) { setPhase("gone"); return; }
    go.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") open(); };
    document.addEventListener("keydown", key);
    return () => { clearTimeout(timer.current); document.removeEventListener("keydown", key); };
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={"welcome" + (phase === "open" ? " opening" : "")} role="dialog" aria-modal="true" aria-label="Welcome to AUTISTIK">
      <div className="welcome-in">
        <div className="welcome-bubble">
          <b>Hi, welcome to AUTISTIK!</b>
          <span>I&apos;m Autistik, the mascot.</span>
        </div>
        <Mascot />
        <button ref={go} type="button" className="welcome-go" onClick={open}>Go to site <span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}

/** Autistik, drawn big for the welcome: floats, blinks, waves and its antenna glows. */
function Mascot() {
  const inf = "M12 4C6.5 4 3 7.8 3 12s3.5 8 9 8c4.6 0 7.7-3.6 12-8 4.3-4.4 7.4-8 12-8 5.5 0 9 3.8 9 8s-3.5 8-9 8c-4.6 0-7.7-3.6-12-8C19.7 7.6 16.6 4 12 4z";
  return (
    <svg className="welcome-bot" viewBox="0 0 200 224" role="img" aria-label="Autistik, the AUTISTIK mascot, waving hello">
      <defs>
        <linearGradient id="wm-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#C7CEDD" /></linearGradient>
        <linearGradient id="wm-visor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#202742" /><stop offset="1" stopColor="#05070E" /></linearGradient>
        <linearGradient id="wm-acc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFB347" /><stop offset="1" stopColor="#FF5A5F" /></linearGradient>
        <linearGradient id="wm-rainbow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF5A5F" /><stop offset=".2" stopColor="#FFB347" /><stop offset=".4" stopColor="#F5E663" />
          <stop offset=".6" stopColor="#4CD48A" /><stop offset=".8" stopColor="#4FA3FF" /><stop offset="1" stopColor="#A86BFF" />
        </linearGradient>
        <radialGradient id="wm-halo"><stop offset="0" stopColor="#5CE1FF" stopOpacity=".45" /><stop offset="1" stopColor="#5CE1FF" stopOpacity="0" /></radialGradient>
        <filter id="wm-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      <circle cx="100" cy="104" r="96" fill="url(#wm-halo)" />
      <g className="wm-sparkles" fill="#FFE27A">
        <path d="M28 52l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
        <path d="M176 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
        <path d="M170 150l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" />
      </g>
      <ellipse className="wm-shadow" cx="100" cy="214" rx="42" ry="6" fill="#000" opacity=".35" />

      <g className="wm-float">
        {/* antenna */}
        <path d="M100 42V24" stroke="#C3CAD8" strokeWidth="4" strokeLinecap="round" />
        <circle className="wm-bulb-glow" cx="100" cy="18" r="13" fill="#FFB347" opacity=".35" />
        <circle cx="100" cy="18" r="8" fill="url(#wm-acc)" />
        <circle cx="97" cy="15" r="2.4" fill="#fff" opacity=".8" />

        {/* legs */}
        <rect x="78" y="176" width="17" height="26" rx="8.5" fill="url(#wm-shell)" />
        <rect x="105" y="176" width="17" height="26" rx="8.5" fill="url(#wm-shell)" />
        <path d="M76 198h21a6 6 0 0 1 0 8H76a4 4 0 0 1 0-8zM103 198h21a4 4 0 0 1 0 8h-21a6 6 0 0 1 0-8z" fill="url(#wm-acc)" />

        {/* resting arm */}
        <rect x="50" y="134" width="17" height="40" rx="8.5" fill="url(#wm-shell)" transform="rotate(14 58 138)" />
        <circle cx="52" cy="176" r="9" fill="url(#wm-acc)" />

        {/* body */}
        <rect x="64" y="128" width="72" height="56" rx="24" fill="url(#wm-shell)" />
        <circle cx="100" cy="155" r="15" fill="#0C0F1C" />
        <g transform="translate(88.5 149) scale(.48)"><path d={inf} fill="none" stroke="url(#wm-rainbow)" strokeWidth="5" strokeLinecap="round" /></g>

        {/* waving arm */}
        <g className="wm-wave">
          <rect x="133" y="96" width="17" height="44" rx="8.5" fill="url(#wm-shell)" transform="rotate(18 141 138)" />
          <circle cx="153" cy="94" r="11" fill="url(#wm-acc)" />
          <path d="M147 88q6-5 12 0" stroke="#fff" strokeOpacity=".6" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>

        {/* head */}
        <circle cx="42" cy="86" r="13" fill="url(#wm-acc)" />
        <circle cx="158" cy="86" r="13" fill="url(#wm-acc)" />
        <rect x="44" y="40" width="112" height="92" rx="42" fill="url(#wm-shell)" />
        <ellipse cx="74" cy="52" rx="16" ry="6" fill="#fff" opacity=".95" transform="rotate(-16 74 52)" />
        <rect x="58" y="60" width="84" height="56" rx="26" fill="url(#wm-visor)" />
        <rect x="58" y="60" width="84" height="56" rx="26" fill="none" stroke="#5CE1FF" strokeOpacity=".35" strokeWidth="1.5" />
        <g filter="url(#wm-glow)">
          <g className="wm-eyes" fill="#5CE1FF">
            <ellipse cx="84" cy="84" rx="7.5" ry="9.5" />
            <ellipse cx="116" cy="84" rx="7.5" ry="9.5" />
          </g>
          <path d="M88 99q12 10 24 0" stroke="#5CE1FF" strokeWidth="4" strokeLinecap="round" fill="none" />
        </g>
        <g className="wm-eyes" fill="#fff"><circle cx="86.5" cy="80.5" r="2.4" /><circle cx="118.5" cy="80.5" r="2.4" /></g>
        <ellipse cx="71" cy="100" rx="6" ry="3.5" fill="#FF7AB6" opacity=".55" />
        <ellipse cx="129" cy="100" rx="6" ry="3.5" fill="#FF7AB6" opacity=".55" />
      </g>
    </svg>
  );
}
