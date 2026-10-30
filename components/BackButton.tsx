"use client";
/**
 * "← Back": returns to the page you came from on AUTISTIK (the game arena, the Board, a dev wallet…), like the
 * browser's back button. When there's no earlier AUTISTIK page (opened from a link or a new tab), it goes to
 * `fallback` instead of leaving the site. <NavTrail> (in the layout) remembers the pages visited in this tab.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const KEY = "nav-trail";
const read = (): string[] => { try { const v = JSON.parse(sessionStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (v: string[]) => { try { sessionStorage.setItem(KEY, JSON.stringify(v.slice(-30))); } catch {} };

export function NavTrail() {
  const path = usePathname();
  const q = useSearchParams()?.toString();
  useEffect(() => {
    const here = path + (q ? "?" + q : "");
    const t = read();
    if (t[t.length - 1] === here) return;
    // Same path with new filters (tabs, ?show=): replace, so Back skips them.
    if (t.length && t[t.length - 1].split("?")[0] === path) { t[t.length - 1] = here; write(t); return; }
    if (t[t.length - 2] === here) { t.pop(); write(t); return; } // that was a Back
    t.push(here); write(t);
  }, [path, q]);
  return null;
}

export default function BackButton({ fallback = "/", label = "Back", className = "back-btn" }: { fallback?: string; label?: string; className?: string }) {
  const router = useRouter();
  function go() {
    const t = read();
    if (t.length > 1) router.push(t[t.length - 2]);
    else router.push(fallback);
  }
  return <button type="button" className={className} onClick={go} aria-label={`${label}: go to the previous page`}>← {label}</button>;
}
