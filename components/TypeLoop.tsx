"use client";
/**
 * A key phrase that keeps typing itself: types a word, holds it, deletes it, types the next, round and round
 * (front page). Screen readers and search engines get the first phrase only, once. It stops while off screen or in
 * a hidden tab, and shows the first phrase still for "reduce motion" and for the site in another language.
 */
import { useEffect, useRef, useState } from "react";
import { currentLang } from "@/lib/i18n-client";

export default function TypeLoop({ words, delay = 0, speed = 55, hold = 2200, intro = false }: { words: string[]; delay?: number; speed?: number; hold?: number; intro?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(words[0]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || currentLang() !== "en") return;
    if (intro) setText("");
    let w = 0, n = words[0].length, back = false, seen = false, started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      if (!seen || document.hidden) return; // paused; resumes when it's back in view
      const word = words[w];
      if (!back && n < word.length) { n++; setText(word.slice(0, n)); timer = setTimeout(run, speed + Math.random() * 40); }
      else if (!back) { back = true; timer = setTimeout(run, hold); }
      else if (n > 0) { n--; setText(word.slice(0, n)); timer = setTimeout(run, speed * 0.55); }
      else { back = false; w = (w + 1) % words.length; timer = setTimeout(run, 380); }
    };
    const io = new IntersectionObserver(([e]) => {
      seen = e.isIntersecting;
      if (!seen) { clearTimeout(timer); return; }
      setLive(true);
      if (!started) {
        started = true;
        if (intro) { n = 0; back = false; timer = setTimeout(run, delay); } // type the first phrase in too
        else { back = true; timer = setTimeout(run, delay + hold); } // the first phrase is already there
      }
      else run();
    }, { threshold: 0.2 });
    io.observe(el);
    const onVis = () => { if (!document.hidden) run(); };
    const onLang = (e: Event) => { if ((e as CustomEvent).detail !== "en") { seen = false; clearTimeout(timer); setText(words[0]); setLive(false); } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("site-lang", onLang);
    return () => { io.disconnect(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("site-lang", onLang); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words.join("|"), delay, speed, hold, intro]);

  return (
    <span ref={ref} className="tl">
      <span className="sr-only">{words[0]}</span>
      <span aria-hidden="true">{text}{live && <i className="tt-caret" />}</span>
    </span>
  );
}
