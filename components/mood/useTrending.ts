"use client";
import { useEffect, useState } from "react";

export type Hot = { id: string; rank: number; replies: number; likes: number; recent: number; score: number };
type Listener = (m: Map<string, Hot>) => void;

// One shared poll for every feed on the page (refreshes every 30 seconds while the page is open).
let cache = new Map<string, Hot>();
let order: Hot[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<Listener>();
async function pull() {
  try {
    const d = await fetch("/api/tik/trending", { cache: "no-store" }).then((r) => r.json());
    order = Array.isArray(d?.trending) ? d.trending : [];
    cache = new Map(order.map((h) => [h.id, h]));
    subs.forEach((f) => f(cache));
  } catch { /* keep the last list */ }
}
/** Ask for a fresh trending list now (after liking or replying). */
export const refreshTrending = () => { setTimeout(pull, 800); };

/** Which Tiks are trending right now (people replying and liking), live. */
export function useTrending() {
  const [map, setMap] = useState<Map<string, Hot>>(cache);
  useEffect(() => {
    const f: Listener = (m) => setMap(m);
    subs.add(f);
    if (!timer) { pull(); timer = setInterval(() => { if (document.visibilityState === "visible") pull(); }, 30_000); }
    else setMap(cache);
    return () => { subs.delete(f); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
  }, []);
  return { map, list: [...map.values()].sort((a, b) => a.rank - b.rank) };
}
