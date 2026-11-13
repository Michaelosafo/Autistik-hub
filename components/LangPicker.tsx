"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LANGS } from "@/lib/langs";
import { currentLang, savedLang, setLang } from "@/lib/i18n-client";

const TOP = ["en", "zh", "ja", "fr", "es", "pt", "ar", "hi", "ko", "de", "ru", "sw"];
let prompted = false; // one prompt per page, even with two top bars

/** First visit: ask once whether to keep English or switch, suggesting the browser's own language. */
function LangPrompt({ onPick, start = "ask" }: { onPick: (code: string) => void; start?: "ask" | "list" }) {
  // Step 1: just "Keep English?". Step 2 (only if they say no): the languages.
  const [step, setStep] = useState<"ask" | "list">(start);
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
        <button type="button" className="lp-keep" onClick={() => onPick("en")}>English</button>
        <small className="lp-note">You can change it any time: Menu → Language.</small>
      </div>
    </div>
  );
}

/**
 * Language: asked once, the first time someone opens the site (no button in the top bar). Changing it later:
 * Menu → Language, which calls openLangPicker().
 */
export function openLangPicker() {
  try { window.dispatchEvent(new Event("open-lang")); } catch { /* old browsers */ }
}

export default function LangPicker() {
  const [ask, setAsk] = useState<false | "ask" | "list">(false);
  useEffect(() => {
    const s = savedLang();
    if (s !== "en" && currentLang() !== s) setLang(s);
    // Never asked on this device: ask once, after the welcome screen (if any) has closed.
    let asked = true;
    try { asked = !!localStorage.getItem("site-lang") || localStorage.getItem("lang-asked") === "1"; } catch {}
    let waitT: ReturnType<typeof setInterval> | null = null;
    if (!asked && !prompted) {
      prompted = true;
      waitT = setInterval(() => { if (!document.querySelector(".welcome")) { clearInterval(waitT!); waitT = null; setAsk("ask"); } }, 600);
    }
    const open = () => setAsk("list");
    window.addEventListener("open-lang", open);
    return () => { if (waitT) clearInterval(waitT); window.removeEventListener("open-lang", open); };
  }, []);
  const choose = (code: string) => {
    try { localStorage.setItem("lang-asked", "1"); } catch {}
    setAsk(false);
    if (code !== currentLang()) setLang(code);
    else { try { localStorage.setItem("site-lang", code); } catch {} }
  };
  if (!ask) return null;
  return createPortal(<div className="notranslate" translate="no"><LangPrompt onPick={choose} start={ask} /></div>, document.body);
}
