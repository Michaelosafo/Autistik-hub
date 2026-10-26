"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type R = { id: string; title: string; created_at: string; host: { alias: string } | null };

/** Live rooms happening now, with a Host a live button (for the panel and the Mood page). */
export default function LiveNow({ max = 4 }: { max?: number }) {
  const [rooms, setRooms] = useState<R[] | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const since = new Date(Date.now() - 12 * 3600e3).toISOString();
      const { data } = await supabaseBrowser().from("live_rooms").select("id,title,created_at,host:profiles!live_rooms_host_id_fkey(alias)").is("ended_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(max);
      if (!stop) setRooms(((data || []) as any[]).map((r) => ({ ...r, host: Array.isArray(r.host) ? r.host[0] ?? null : r.host })));
    };
    load();
    const t = setInterval(load, 20000);
    return () => { stop = true; clearInterval(t); };
  }, [max]);
  return (
    <div className="live-now">
      {rooms === null ? <small className="muted">Checking who&apos;s live…</small> : rooms.length ? rooms.map((r) => (
        <Link key={r.id} href={`/spaces/${r.id}`} className="live-row">
          <span className="room-live"><i />Live</span>
          <span className="live-t"><b>{r.title}</b><small>Hosted by {r.host?.alias || "a member"}</small></span>
          <span className="live-join">Join</span>
        </Link>
      )) : <small className="muted">Nobody is live right now.</small>}
      <Link href="/spaces?host=1" className="live-host">Host a live</Link>
    </div>
  );
}
