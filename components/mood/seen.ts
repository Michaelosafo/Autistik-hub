"use client";
/**
 * Records that the member saw a Tik (once it's been at least half on screen for a second). Sent in small batches;
 * the database keeps one view per member per Tik and never counts the author's own.
 */
import { supabaseBrowser } from "@/lib/supabase/client";

const sent = new Set<string>();
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let who: string | null = null;

function flush() {
  timer = null;
  const ids = queue; queue = [];
  if (!ids.length || !who) return;
  const me = who;
  supabaseBrowser().from("tik_views").upsert(ids.map((tik_id) => ({ tik_id, user_id: me })), { onConflict: "tik_id,user_id", ignoreDuplicates: true }).then(() => {}, () => {});
}

export function markSeen(id: string, me: string | null) {
  if (!me || sent.has(id)) return;
  sent.add(id); who = me; queue.push(id);
  if (!timer) timer = setTimeout(flush, 3000);
}

/**
 * Views like X: every look counts. In the feed once per page visit (after a second half on screen); opening a Tik
 * counts every time. Never the author's own. Batched into one call every 2 seconds (tik_seen).
 */
const looked = new Set<string>();
let vq: string[] = [];
let vt: ReturnType<typeof setTimeout> | null = null;
export function countView(id: string, opened = false) {
  if (!opened) { if (looked.has(id)) return; looked.add(id); }
  vq.push(id);
  if (!vt) vt = setTimeout(() => {
    vt = null;
    const ids = [...new Set(vq)]; vq = [];
    if (ids.length) supabaseBrowser().rpc("tik_seen", { ids: ids.slice(0, 50) }).then(() => {}, () => {});
  }, 2000);
}
