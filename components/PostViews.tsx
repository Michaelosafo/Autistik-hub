"use client";
/**
 * Post views: counts how many different members saw each post, and shows it on the post.
 * - A post counts as seen once at least half of it has been on screen for a second. Seeing it again doesn't add
 *   more, and your own posts don't count your views (supabase/post-views.sql).
 * - On your own posts the count is highlighted in gold ("Seen by 12"); on others it's a small "12 views".
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Ctx = { counts: Record<string, number>; watch: (id: string, el: Element | null) => void };
const ViewsCtx = createContext<Ctx>({ counts: {}, watch: () => {} });

/** Wrap a list of posts: loads their view counts and records the ones you see. */
export function PostViewsProvider({ ids, children }: { ids: string[]; children?: React.ReactNode }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const queue = useRef(new Set<string>());
  const sent = useRef(new Set<string>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const io = useRef<IntersectionObserver | null>(null);
  const key = ids.join(",");

  const load = useCallback(async () => {
    if (!ids.length) return;
    const { data, error } = await supabaseBrowser().rpc("post_view_counts", { ids: ids.slice(0, 200) });
    if (error || !data) return; // supabase/post-views.sql not run yet: posts just show no count
    setCounts((old) => {
      const next = { ...old };
      for (const r of data as { post_id: string; views: number }[]) next[r.post_id] = Math.max(Number(r.views) || 0, next[r.post_id] || 0);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  // Send what you saw every couple of seconds, in one small batch.
  useEffect(() => {
    const t = setInterval(async () => {
      if (!queue.current.size) return;
      const batch = [...queue.current].slice(0, 100);
      batch.forEach((id) => { queue.current.delete(id); sent.current.add(id); });
      const { error } = await supabaseBrowser().rpc("mark_post_views", { ids: batch });
      if (!error) load();
    }, 2500);
    return () => clearInterval(t);
  }, [load]);

  // Made on first use: the posts' refs run before this component's effects.
  const observer = useCallback(() => {
    if (io.current || typeof IntersectionObserver === "undefined") return io.current;
    const tm = timers.current;
    io.current = new IntersectionObserver((es) => es.forEach((e) => {
      const id = (e.target as HTMLElement).dataset.postId;
      if (!id || sent.current.has(id)) return;
      if (e.isIntersecting) { if (!tm.has(id)) tm.set(id, setTimeout(() => { tm.delete(id); if (!document.hidden) queue.current.add(id); }, 1000)); }
      else { clearTimeout(tm.get(id)); tm.delete(id); }
    }), { threshold: 0.5 });
    return io.current;
  }, []);
  useEffect(() => () => { io.current?.disconnect(); io.current = null; timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const watch = useCallback((id: string, el: Element | null) => {
    const o = observer();
    if (!el || !o) return;
    (el as HTMLElement).dataset.postId = id;
    o.observe(el);
  }, [observer]);

  return <ViewsCtx.Provider value={{ counts, watch }}>{children}</ViewsCtx.Provider>;
}

/** Put on a post's outer element: `ref={useSeen(p.id)}`. */
export function useSeen(id: string) {
  const { watch } = useContext(ViewsCtx);
  return useCallback((el: Element | null) => watch(id, el), [id, watch]);
}

/** The count on a post. Gold and "Seen by …" on your own post. */
export function ViewCount({ id, mine }: { id: string; mine?: boolean }) {
  const n = useContext(ViewsCtx).counts[id] || 0;
  if (!mine && !n) return null;
  const label = mine ? (n ? `Seen by ${n.toLocaleString("en-US")} ${n === 1 ? "member" : "members"}` : "No views yet") : `${n.toLocaleString("en-US")} ${n === 1 ? "view" : "views"}`;
  return (
    <span className={"pv" + (mine ? " mine" : "") + (n ? "" : " zero")} title="Different members who saw this post">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
      {label}
    </span>
  );
}
