"use client";
import { useEffect, useRef, useState } from "react";
import { LANGS } from "@/lib/langs";
import { currentLang, savedLang, setLang } from "@/lib/i18n-client";

/** The language button in the top bar: pick a language and the whole site switches to it. */
export default function LangPicker() {
  const [lang, setL] = useState("en");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = savedLang();
    if (s !== "en" && currentLang() !== s) setLang(s);
    setL(currentLang() === "en" ? s : currentLang());
    const on = (e: Event) => setL((e as CustomEvent<string>).detail);
    window.addEventListener("site-lang", on);
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { window.removeEventListener("site-lang", on); document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  const cur = LANGS.find((l) => l.code === lang) || LANGS[0];
  return (
    <div className="lang notranslate" ref={box} translate="no">
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
