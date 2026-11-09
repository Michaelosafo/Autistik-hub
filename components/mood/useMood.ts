"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TIK_COLS, shapeTiks, type Tik } from "@/lib/mood";

/** Loads Tiks (the feed, or the replies to one Tik) for the signed-in member, newest first. */
export function useTiks(opts: { replyTo?: string | null; limit?: number; refreshKey?: number; authors?: string[] | null; only?: string | null; ids?: string[] | null }) {
  const { replyTo = null, limit = 20, refreshKey = 0, authors = null, only = null, ids = null } = opts;
  const idsKey = ids ? ids.join(",") : "";
  const authorsKey = authors ? authors.join(",") : "";
  const [tiks, setTiks] = useState<Tik[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async (before?: string) => {
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    setMe(user?.id ?? null);
    let q = sb.from("tiks").select(TIK_COLS).eq("hidden", false).order("created_at", { ascending: !!replyTo }).limit(limit + 1);
    q = replyTo ? q.eq("reply_to", replyTo) : q.is("reply_to", null);
    if (before) q = replyTo ? q.gt("created_at", before) : q.lt("created_at", before);
    if (only) q = sb.from("tiks").select(TIK_COLS).eq("id", only).limit(1);
    else if (ids) {
      // A set list (trending): fetch those, keep the given order.
      if (!ids.length) { setTiks([]); setMore(false); return; }
      q = sb.from("tiks").select(TIK_COLS).in("id", ids.slice(0, 50)).eq("hidden", false);
    }
    else if (authors) {
      if (!authors.length) { setTiks([]); setMore(false); return; }
      q = q.in("author_id", authors.slice(0, 300));
    }
    const { data, error } = await q;
    if (error) { setErr("Couldn't load Tiks right now."); setTiks((t) => t ?? []); return; }
    const rows = (data || []) as any[];
    setMore(rows.length > limit);
    const page = rows.slice(0, limit);
    let mine = new Set<string>();
    if (user && page.length) {
      const { data: l } = await sb.from("tik_likes").select("tik_id").eq("user_id", user.id).in("tik_id", page.map((r) => r.id));
      mine = new Set((l || []).map((x: any) => x.tik_id));
    }
    let shaped = shapeTiks(page, mine);
    // Tickles: the original Tiks they point at, and Tickle counts (and the member's own) for everything shown.
    const origIds = [...new Set(shaped.map((x) => x.tickle_of).filter(Boolean) as string[])];
    if (origIds.length) {
      const { data: o } = await sb.from("tiks").select(TIK_COLS).in("id", origIds).eq("hidden", false);
      const { data: ol } = user ? await sb.from("tik_likes").select("tik_id").eq("user_id", user.id).in("tik_id", origIds) : { data: [] };
      const origs = new Map(shapeTiks((o || []) as any[], new Set((ol || []).map((x: any) => x.tik_id))).map((x) => [x.id, x]));
      shaped = shaped.map((x) => (x.tickle_of ? { ...x, orig: origs.get(x.tickle_of) ?? null } : x));
    }
    const countFor = [...new Set(shaped.map((x) => x.orig?.id ?? x.id))];
    if (countFor.length) {
      const { data: tk } = await sb.from("tiks").select("tickle_of,author_id").in("tickle_of", countFor).eq("hidden", false).limit(2000);
      const n = new Map<string, number>(); const own = new Set<string>();
      for (const r of (tk || []) as any[]) { n.set(r.tickle_of, (n.get(r.tickle_of) || 0) + 1); if (user && r.author_id === user.id) own.add(r.tickle_of); }
      const add = (x: Tik): Tik => ({ ...x, tickles: n.get(x.id) || 0, tickled: own.has(x.id) });
      shaped = shaped.map((x) => (x.orig ? { ...x, orig: add(x.orig) } : add(x)));
    }
    if (ids) { const at = new Map(ids.map((x, i) => [x, i])); shaped = shaped.sort((a, b) => (at.get(a.id) ?? 99) - (at.get(b.id) ?? 99)); }
    setTiks((t) => (before && t ? [...t, ...shaped] : shaped));
  }, [replyTo, limit, authorsKey, only, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, refreshKey]);
  const loadMore = () => { if (tiks?.length) load(tiks[tiks.length - 1].created_at); };
  return { tiks, setTiks, me, more, loadMore, err, reload: () => load() };
}
