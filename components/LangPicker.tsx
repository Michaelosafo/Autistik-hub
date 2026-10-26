"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGS } from "@/lib/langs";
import { currentLang, savedLang, setLang } from "@/lib/i18n-client";

const TOP = ["en", "zh", "ja", "fr", "es", "pt", "ar", "hi", "ko", "de", "ru", "sw"];
let prompted = false; // one prompt per page, even with two top bars

/** First visit: ask once whether to keep English or switch, suggesting the browser's own language. */
function LangPrompt({ onPick }: { onPick: (code: string) => void }) {
  // Step 1: just "Keep English?". Step 2 (only if they say no): the languages.
  const [step, setStep] = useState<"ask" | "list">("ask");
  const [all, setAll] = useState(false);
  const nav = (typeof navigator !== "undefined" ? navigator.language || "en" : "en").toLowerCase();
  const guess = LANGS.find((l) => l.code !== "en" && (nav === l.code || nav.startsWith(l.code + "-")));
  const list = (all ? LANGS : TOP.map((c) => LANGS.find((l) => l.code === c)!).filter(Boolean)).filter((l) => l.code !== "en");
  if (step === "ask") return (
    <div className="lp-bg" role="dialog" aria-modal="true" aria-label="Language">
      <div className="lp-box lp-small">
        <b className="lp-title">Keep English?</b>
        <small className="lp-sub">Language · 语言 · 言語 · Langue · Idioma · اللغة</small>
        <button type="button" className="lp-guess" onClick={() => onPick("en")}>Yes, keep English</button>
        <button type="button" className="lp-keep" onClick={() => setStep("list")}>No, choose my language</button>
      </div>
    </div>
  );
  return (
    <div className="lp-bg" role="dialog" aria-modal="true" aria-label="Choose your language">
      <div className="lp-box">
        <b className="lp-title">Choose your language</b>
        {guess && <button type="button" className="lp-guess" onClick={() => onPick(guess.code)}>{guess.native}</button>}
        <div className="lp-grid">
          {list.map((l) => (
            <button key={l.code} type="button" onClick={() => onPick(l.code)}>
              <b>{l.native}</b>{l.native !== l.name && <small>{l.name}</small>}
            </button>
          ))}
        </div>
        {!all && <button type="button" className="lp-more" onClick={() => setAll(true)}>More languages ({LANGS.length - 1})</button>}
        <button type="button" className="lp-keep" onClick={() => onPick("en")}>Back to English</button>
        <small className="lp-note">You can change it any time with the globe button at the top.</small>
      </div>
    </div>
  );
}

/** The language button in the top bar: pick a language and the whole site switches to it. */
export default function LangPicker() {
  const [ask, setAsk] = useState(false);
  const [lang, setL] = useState("en");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = savedLang();
    if (s !== "en" && currentLang() !== s) setLang(s);
    setL(currentLang() === "en" ? s : currentLang());
    // Never asked on this device: ask once, after the welcome screen (if any) has closed.
    let asked = true;
    try { asked = !!localStorage.getItem("site-lang") || localStorage.getItem("lang-asked") === "1"; } catch {}
    let waitT: ReturnType<typeof setInterval> | null = null;
    if (!asked && !prompted) {
      prompted = true;
      waitT = setInterval(() => { if (!document.querySelector(".welcome")) { clearInterval(waitT!); waitT = null; setAsk(true); } }, 600);
    }
    const on = (e: Event) => setL((e as CustomEvent<string>).detail);
    window.addEventListener("site-lang", on);
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { if (waitT) clearInterval(waitT); window.removeEventListener("site-lang", on); document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  const choose = (code: string) => {
    try { localStorage.setItem("lang-asked", "1"); } catch {}
    setAsk(false);
    if (code !== currentLang()) setLang(code);
    else { try { localStorage.setItem("site-lang", code); } catch {} }
    setL(code);
  };
  return (
    <div className="lang notranslate" ref={box} translate="no">
      {ask && createPortal(<LangPrompt onPick={choose} />, document.body)}
      <button type="button" className="lang-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} title="Language" aria-label={`Language: ${cur.name}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></svg>
        <span>{cur.code.toUpperCase()}</span>
      </button>
      {open && (
        <ul className="lang-menu" role="listbox" aria-label="Choose a language">
          {LANGS.map((l) => (
            <li key={l.code}>
              <button type="button" role="option" aria-selected={l.code === lang} onClick={() => { setLang(l.code); setL(l.code); setOpen(false); }}>
                <b>{l.native}</b><small>{l.name}</small>{l.code === lang && <i aria-hidden="true">✓</i>}
              </button>
            </li>
          ))}
          <li className="lang-note">Translated automatically. Addresses and prices stay the same.</li>
        </ul>
      )}
    </div>
  );
}
