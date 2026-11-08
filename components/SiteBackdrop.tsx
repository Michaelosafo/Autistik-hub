"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * The faint, funny artwork behind every page. A set of scenes (Derp the mascot, the Autistik Dog, the brain network,
 * Big Brain Mode, Holo Infinity, Derp going to the moon, the Derp gang) takes turns: a slow crossfade every little
 * while, and a new one when you open another page. Calm mode turns it off; with reduced motion it only changes
 * between pages, without fades.
 */
type Scene = { id: string; tile?: string; tileSize?: number; hero: string; shape: "tall" | "wide" | "round"; glow: string };
const SCENES: Scene[] = [
  { id: "derp", tile: "/bg/doodles.svg", tileSize: 460, hero: "/bg/derp.svg", shape: "tall", glow: "violet" },
  { id: "dog", tile: "/bg/stars.svg", tileSize: 420, hero: "/bg/dog.webp", shape: "round", glow: "gold" },
  { id: "neural", tile: "/bg/neural.svg", tileSize: 600, hero: "/bg/holo-inf.svg", shape: "wide", glow: "cyan" },
  { id: "brain", tile: "/bg/doodles.svg", tileSize: 460, hero: "/bg/bigbrain.svg", shape: "tall", glow: "pink" },
  { id: "holo", hero: "/bg/holo-inf.svg", shape: "wide", glow: "aurora" },
  { id: "moon", tile: "/bg/stars.svg", tileSize: 420, hero: "/bg/derp-moon.svg", shape: "tall", glow: "night" },
  { id: "gang", tile: "/bg/doodles.svg", tileSize: 460, hero: "/bg/derp-gang.svg", shape: "wide", glow: "violet" },
];
const EVERY = 35_000; // a new scene every 35 seconds on the same page
const KEY = "sbg-scene";

export default function SiteBackdrop() {
  const path = usePathname();
  const [cur, setCur] = useState<number | null>(null);
  const [prev, setPrev] = useState<number | null>(null);
  const first = useRef(true);
  const still = useRef(false);

  const curRef = useRef<number | null>(null);
  const go = (to?: number) => {
    const c = curRef.current;
    const n = to ?? ((c ?? 0) + 1) % SCENES.length;
    if (c !== null && c !== n) setPrev(c);
    curRef.current = n;
    setCur(n);
    try { sessionStorage.setItem(KEY, String(n)); } catch {}
  };

  // Start where this tab left off (or anywhere, the first time).
  useEffect(() => {
    still.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let start = Math.floor(Math.random() * SCENES.length);
    try { const v = sessionStorage.getItem(KEY); const s = v === null ? -1 : Number(v); if (Number.isInteger(s) && s >= 0 && s < SCENES.length) start = s; } catch {}
    curRef.current = start;
    setCur(start);
  }, []);

  // A new scene on every page you open.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    go();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  // And slowly over time (not with reduced motion, and not while the tab is hidden).
  useEffect(() => {
    if (cur === null || still.current) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") go(); }, EVERY);
    return () => clearInterval(t);
  }, [cur === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // The old scene finishes fading out, then goes away.
  useEffect(() => {
    if (prev === null) return;
    const t = setTimeout(() => setPrev(null), 2600);
    return () => clearTimeout(t);
  }, [prev]);

  if (cur === null) return null;
  const show = prev !== null && prev !== cur ? [prev, cur] : [cur];
  const next = SCENES[(cur + 1) % SCENES.length];
  return (
    <div className="sbg" aria-hidden="true">
      {show.map((i) => {
        const s = SCENES[i];
        return (
          <div key={s.id} className={`sbg-scene sbg-${s.glow}${i === cur ? " on" : " off"}`}>
            {s.tile && <div className="sbg-tile" style={{ backgroundImage: `url(${s.tile})`, backgroundSize: `${s.tileSize}px ${s.tileSize}px` }} />}
            {s.glow === "aurora" && <div className="sbg-dots" />}
            <img className={`sbg-hero ${s.shape}`} src={s.hero} alt="" decoding="async" />
          </div>
        );
      })}
      {/* Fetch the next scene's picture early, so it fades in already loaded. */}
      <link rel="prefetch" href={next.hero} as="image" />
    </div>
  );
}
