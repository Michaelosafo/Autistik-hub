/**
 * Trades the member approved in their own chat message ("approved sell $1 of AUTISTIK") run by themselves, once.
 * Each request may fire only if it was typed in the last 3 minutes and never fired before in this browser, so
 * reopening a chat or reloading the page can never repeat a trade. Browser only.
 */
const KEY = "auto-trades-fired";
const FRESH_MS = 3 * 60_000;

export function claimAuto(at: number | undefined): boolean {
  if (!at || Date.now() - at > FRESH_MS || at > Date.now() + 60_000) return false;
  try {
    const fired: number[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (fired.includes(at)) return false;
    localStorage.setItem(KEY, JSON.stringify([...fired.filter((x) => Date.now() - x < 86_400_000), at].slice(-50)));
    return true;
  } catch {
    // No storage (private window): only within this page view.
    const w = window as any;
    w.__autoFired = w.__autoFired || new Set<number>();
    if (w.__autoFired.has(at)) return false;
    w.__autoFired.add(at);
    return true;
  }
}
