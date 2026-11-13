"use client";
/**
 * The front page plays in order as you scroll, like the AI sites: each heading types itself out (TypeText), then
 * the text under it comes in word by word out of a blur (Words), then the buttons and cards rise in one after
 * another (SeqReveal + data-sq="up").
 * - Before the page script runs, and for people with "reduce motion" or the site in another language (the
 *   translator works on whole sentences), everything simply shows.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentLang } from "@/lib/i18n-client";

const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;
const calm = () => typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || currentLang() !== "en" || typeof IntersectionObserver === "undefined";

/** How long TypeText takes to type `text` (about), so what comes next can start right after. */
export const typedMs = (text: string, speed = 34) => Math.ceil(text.length / Math.max(1, Math.round(text.length / 45))) * (speed + 15);

/** A paragraph's words coming in one after another, out of a blur, when it scrolls into view. */
export function Words({ text, delay = 0 }: { text: string; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [split, setSplit] = useState(false);
  const [shown, setShown] = useState(false);
  useIsoLayout(() => {
    if (calm() || !ref.current) return;
    setSplit(true);
    const el = ref.current;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.3, rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    const onLang = (e: Event) => { if ((e as CustomEvent).detail !== "en") setSplit(false); };
    window.addEventListener("site-lang", onLang);
    return () => { io.disconnect(); window.removeEventListener("site-lang", onLang); };
  }, [text]);
  if (!split) return <span ref={ref}>{text}</span>;
  const words = text.split(/(\s+)/);
  let i = 0;
  return (
    <span ref={ref} className={"wd" + (shown ? " in" : "")} style={{ ["--wd" as string]: `${delay}ms` }}>
      {words.map((w, k) => (/^\s+$/.test(w) ? w : <span key={k} className="w" style={{ ["--i" as string]: i++ }}>{w}</span>))}
    </span>
  );
}

/** Rises in the children of every [data-sq="up"] block, one after another, as each block scrolls into view. */
export function SeqReveal() {
  useIsoLayout(() => {
    if (calm()) return;
    const root = document.documentElement;
    const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-sq="up"]'));
    blocks.forEach((b) => Array.from(b.children).forEach((c, k) => (c as HTMLElement).style.setProperty("--k", String(k))));
    root.classList.add("sq-on");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("sq-in"); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    blocks.forEach((b) => io.observe(b));
    const showAll = () => { blocks.forEach((b) => b.classList.add("sq-in")); io.disconnect(); };
    const onLang = (e: Event) => { if ((e as CustomEvent).detail !== "en") showAll(); };
    window.addEventListener("site-lang", onLang);
    return () => { io.disconnect(); window.removeEventListener("site-lang", onLang); root.classList.remove("sq-on"); };
  }, []);
  return null;
}
