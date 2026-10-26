"use client";
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TIK_COLS, shapeTiks, type Tik } from "@/lib/mood";

/** Loads Tiks (the feed, or the replies to one Tik) for the signed-in member, newest first. */
export function useTiks(opts: { replyTo?: string | null; limit?: number; refreshKey?: number }) {
  const { replyTo = null, limit = 20, refreshKey = 0 } = opts;
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
    const shaped = shapeTiks(page, mine);
    setTiks((t) => (before && t ? [...t, ...shaped] : shaped));
  }, [replyTo, limit]);
  useEffect(() => { load(); }, [load, refreshKey]);
  const loadMore = () => { if (tiks?.length) load(tiks[tiks.length - 1].created_at); };
  return { tiks, setTiks, me, more, loadMore, err, reload: () => load() };
}
