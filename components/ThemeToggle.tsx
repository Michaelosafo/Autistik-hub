"use client";
import { useEffect, useState } from "react";
import { applyTheme, currentTheme, type Theme } from "@/lib/theme";

/** "Dark mode" / "Light mode" switch for the top bar. */
export default function ThemeToggle() {
  const [t, setT] = useState<Theme>("light");
  useEffect(() => {
    setT(currentTheme());
    const on = (e: Event) => setT((e as CustomEvent<Theme>).detail);
    window.addEventListener("autistik-theme", on);
    return () => window.removeEventListener("autistik-theme", on);
  }, []);
  const dark = t === "dark";
  return (
    <button type="button" className="theme-tg" onClick={() => applyTheme(dark ? "light" : "dark")} aria-pressed={dark}
      aria-label={dark ? "Turn on light mode" : "Turn on dark mode"} title={dark ? "Turn on light mode" : "Turn on dark mode"}>
      {dark
        ? <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>}
      <span>{dark ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}
