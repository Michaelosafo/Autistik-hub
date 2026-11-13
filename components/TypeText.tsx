"use client";
/**
 * Writing that types itself out, letter by letter like a computer, when you scroll to it (front page headings).
 * - The whole text is in the page from the start (search engines and screen readers get all of it at once), and
 *   the letters still to come hold their space, so nothing below jumps while it types.
 * - Types once per visit to the page. Shows straight away for people who turned on "reduce motion", and when the
 *   site is in another language (lib/i18n-client.ts translates whole sentences, not half-typed ones).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentLang } from "@/lib/i18n-client";

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function TypeText({ text, speed = 34, delay = 0 }: { text: string; speed?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(text.length);
  const [typing, setTyping] = useState(false);

  useIsoLayout(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || currentLang() !== "en") return;
    setN(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let i = 0, started = false;
    const finish = () => { clearTimeout(timer); setN(text.length); setTyping(false); };
    const tick = () => {
      // A few letters at a time on long lines, so every heading takes about the same short time.
      i = Math.min(text.length, i + Math.max(1, Math.round(text.length / 45)));
      setN(i);
      if (i < text.length) timer = setTimeout(tick, speed + (text[i - 1] === " " ? 0 : Math.random() * 30));
      else setTimeout(() => setTyping(false), 900);
    };
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || started) return;
      started = true; io.disconnect(); setTyping(true);
      timer = setTimeout(tick, delay);
    }, { threshold: 0.5, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    const onLang = (e: Event) => { if ((e as CustomEvent).detail !== "en") finish(); };
    window.addEventListener("site-lang", onLang);
    return () => { io.disconnect(); clearTimeout(timer); window.removeEventListener("site-lang", onLang); };
  }, [text, speed, delay]);

  return (
    <span ref={ref} className="tt">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.slice(0, n)}
        {typing && <i className="tt-caret" />}
        <span className="tt-rest">{text.slice(n)}</span>
      </span>
    </span>
  );
}
