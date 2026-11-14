"use client";
/**
 * The App's TIK preview: the 2 newest Tiks from people you follow (or from everyone, if you follow nobody yet or
 * aren't signed in), "View more" to see a few more right here, and "Open TIK" for the full, newest feed.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";

export default function TikPreview() {
  const [follows, setFollows] = useState<string[] | null | undefined>(undefined); // undefined = still looking
  const [limit, setLimit] = useState(2);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { setFollows(null); return; }
      const { data } = await sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(300);
      const ids = (data || []).map((r: any) => String(r.followee_id));
      setFollows(ids.length ? ids : null);
    })().catch(() => setFollows(null));
  }, []);
  if (follows === undefined) return <small className="muted">Loading TIK…</small>;
  return <List authors={follows} limit={limit} onMore={() => setLimit((n) => n + 4)} />;
}

function List({ authors, limit, onMore }: { authors: string[] | null; limit: number; onMore: () => void }) {
  const { tiks, me, more, setTiks } = useTiks({ authors, limit });
  if (tiks === null) return <small className="muted">Loading TIK…</small>;
  return (
    <div className="tik-prev">
      <small className="tik-prev-cap">{authors ? "From people you follow" : "Newest on TIK"}</small>
      {!tiks.length ? <small className="muted">No Tiks yet from people you follow. Open TIK to see everyone&apos;s.</small>
        : tiks.map((t) => <TikCard key={t.id} t={t} me={me} onRemoved={(id) => setTiks((x) => x?.filter((y) => y.id !== id) ?? null)} />)}
      <div className="tik-prev-go">
        {more && <button type="button" className="tik-prev-more" onClick={onMore}>View more</button>}
        <Link href="/mood" className="tik-prev-open">Open TIK →</Link>
      </div>
    </div>
  );
}
