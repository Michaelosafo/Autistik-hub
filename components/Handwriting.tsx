"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Calm mode and "reduce motion" show replies straight away, with no writing animation. */
function still() {
  try {
    return document.documentElement.dataset.calm === "on" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

/** Shown while the AI hasn't started its reply yet: a small sheet of lined paper with a pencil scribbling on it. */
export function WritingNote({ name }: { name: string }) {
  return (
    <div className="msg ai paper writing-note" role="status">
      <span className="sr-only">{name} is writing…</span>
      <svg viewBox="0 0 132 40" aria-hidden="true">
        <path className="w1" pathLength={100} d="M4 13 q5 -7 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0" />
        <path className="w2" pathLength={100} d="M4 31 q5 -7 10 0 t10 0 t10 0 t10 0 t10 0 t10 0" />
      </svg>
      <span className="pencil" aria-hidden="true">✏️</span>
    </div>
  );
}

/**
 * An AI reply written out on paper: the words appear a few at a time with a pencil at the end, then the paper
 * turns back into a normal bubble. `done` is false while the reply is still arriving. `fresh` makes a reply that
 * arrived all at once still be written out; older messages show in full straight away.
 */
export function Handwritten({ text, done, fresh, className = "msg ai", after }: {
  text: string; done: boolean; fresh?: boolean; className?: string; after?: ReactNode;
}) {
  const [n, setN] = useState(() => (done && !fresh ? text.length : 0));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (n >= text.length) return;
    if (still()) { setN(text.length); return; }
    // About 60 letters a second, catching up faster when a lot has arrived.
    const t = setTimeout(() => setN((v) => Math.min(text.length, v + Math.max(1, Math.ceil((text.length - v) / 40)))), 16);
    return () => clearTimeout(t);
  }, [n, text]);

  // Keep the newest words in view while writing, unless the person scrolled up to read.
  useEffect(() => {
    const box = ref.current?.closest(".msgs") as HTMLElement | null;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }, [n]);

  const writing = !done || n < text.length;
  return (
    <div ref={ref} className={className + (writing ? " paper" : "")}>
      {writing ? <span aria-hidden="true">{text.slice(0, n)}</span> : text}
      {writing && <span className="sr-only">{text}</span>}
      {writing && <span className="pencil" aria-hidden="true">✏️</span>}
      {!writing && after}
    </div>
  );
}
