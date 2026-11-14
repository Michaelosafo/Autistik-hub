"use client";
/**
 * Writing that types itself out, letter by letter like a computer, when you scroll to it (front page headings).
 * - The whole text is in the page from the start (search engines and screen readers get all of it at once), and
 *   the letters still to come hold their space, so nothing below jumps while it types.
 * - Types again (with its soft key clicks) every time it comes back into view after leaving the screen. Shows straight away for people who turned on "reduce motion", and when the
 *   site is in another language (lib/i18n-client.ts translates whole sentences, not half-typed ones).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentLang } from "@/lib/i18n-client";
import { typeTick } from "@/lib/type-sound";

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function TypeText({ text, speed = 24, delay = 0 }: { text: string; speed?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(text.length);
  const [typing, setTyping] = useState(false);

  useIsoLayout(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || currentLang() !== "en") return;
    setN(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let i = 0, first = true, armed = true, stopped = false;
    const finish = () => { stopped = true; clearTimeout(timer); setN(text.length); setTyping(false); io.disconnect(); };
    const tick = () => {
      // A few letters at a time on long lines, so every heading takes about the same short time.
      i = Math.min(text.length, i + Math.max(1, Math.round(text.length / 45)));
      setN(i);
      typeTick(text[i - 1] === " "); // a soft key click per step (lib/type-sound.ts)
      if (i < text.length) timer = setTimeout(tick, speed + (text[i - 1] === " " ? 0 : Math.random() * 30));
      else timer = setTimeout(() => setTyping(false), 900);
    };
    const io = new IntersectionObserver(([e]) => {
      if (stopped) return;
      if (!e.isIntersecting) {
        // Fully off screen: clear it, ready to type again next time it's scrolled to.
        clearTimeout(timer); i = 0; setN(0); setTyping(false); armed = true;
        return;
      }
      if (e.intersectionRatio < 0.2 || !armed) return;
      armed = false; i = 0; setTyping(true);
      timer = setTimeout(tick, first ? delay : 120);
      first = false;
    }, { threshold: [0, 0.2], rootMargin: "0px 0px -4% 0px" });
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
