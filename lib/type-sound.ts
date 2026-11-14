"use client";
/**
 * The soft keyboard sound of the front page's typing headings (TypeText / TypeLoop). Made in the browser with Web
 * Audio (a tiny burst of filtered noise per key, slightly different each time), so there's no sound file to load.
 * - Browsers only allow sound after the visitor has touched, clicked or pressed a key once: until then it's silent,
 *   and the first tap / scroll-touch turns it on.
 * - On by default; the 🔊 button turns it off (remembered on this device). Always off for "reduce motion".
 * - At most one click every 28 ms, quiet, and never while the tab is hidden.
 */
const KEY = "autistik-type-sound";
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let unlocked = false;
let last = 0;
const subs = new Set<(on: boolean) => void>();

function prefOn(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export const typeSoundOn = prefOn;

export function setTypeSound(on: boolean) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: this visit only */ }
  if (on) unlock();
  subs.forEach((f) => f(on));
}
export function onTypeSound(f: (on: boolean) => void) { subs.add(f); return () => { subs.delete(f); }; }

function unlock() {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      // 40 ms of noise that fades out: each key click is a slice of it through a filter.
      const len = Math.floor(ctx.sampleRate * 0.04);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    unlocked = true;
  } catch { /* no audio on this device */ }
}

if (typeof window !== "undefined") {
  const first = () => { if (prefOn()) unlock(); };
  for (const ev of ["pointerdown", "touchend", "keydown", "click"]) window.addEventListener(ev, first, { passive: true });
}

/** One key press. space: a softer, lower key (the space bar). */
export function typeTick(space = false) {
  if (!unlocked || !ctx || !noise || document.hidden || !prefOn()) return;
  const now = performance.now();
  if (now - last < 28) return;
  last = now;
  try {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = space ? 900 + Math.random() * 200 : 1900 + Math.random() * 1400;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const vol = (space ? 0.03 : 0.042) * (0.8 + Math.random() * 0.4); // soft: background texture, not a noise
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.045);
  } catch { /* ignore */ }
}
