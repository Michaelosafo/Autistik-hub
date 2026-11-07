"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";

type P = { id: string; alias: string; color: string; avatar_url: string | null; is_verified: boolean; is_team: boolean; verified_badge: number | null };

/** Home: your followers at a glance (counts, and the newest people who followed you). Members only. */
export default function MyPeople() {
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [n, setN] = useState<{ followers: number; following: number; tiks: number } | null>(null);
  const [recent, setRecent] = useState<P[]>([]);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      setMe(user?.id ?? null);
      if (!user) return;
      const [sum, { data: f }] = await Promise.all([
        fetch("/api/me/summary").then((r) => r.json()).catch(() => null),
        sb.from("follows").select("follower_id,created_at").eq("followee_id", user.id).order("created_at", { ascending: false }).limit(10),
      ]);
      setN({ followers: sum?.followers ?? 0, following: sum?.following ?? 0, tiks: sum?.tiks ?? 0 });
      const ids = (f || []).map((x: any) => x.follower_id);
      if (ids.length) {
        const { data: ps } = await sb.from("profiles").select("id,alias,color,avatar_url,is_verified,is_team,verified_badge").in("id", ids);
        setRecent(ids.map((id: string) => (ps || []).find((p: any) => p.id === id)).filter(Boolean) as P[]);
      }
    })().catch(() => setMe(null));
  }, []);
  if (me === null) return (
    <section className="myp" aria-label="Join">
      <div className="myp-h"><b>Your people</b></div>
      <small className="myp-dim">Sign in to see your followers, post on TIK and join lives.</small>
      <Link className="btn small primary" href="/login?next=/app" style={{ alignSelf: "flex-start" }}>Sign in / Join free</Link>
    </section>
  );
  return (
    <section className="myp" aria-label="Your people">
      <div className="myp-h"><b>Your people</b><Link href="/members?tab=followers">See all</Link></div>
      <div className="myp-n">
        <Link href="/members?tab=followers"><b>{n ? n.followers : "–"}</b><small>Followers</small></Link>
        <Link href="/members?tab=following"><b>{n ? n.following : "–"}</b><small>Following</small></Link>
        <Link href="/mood"><b>{n ? n.tiks : "–"}</b><small>Tiks</small></Link>
      </div>
      {recent.length > 0 ? (
        <div className="myp-faces" aria-label="Newest followers">
          {recent.map((p) => (
            <Link key={p.id} href={`/members/${p.id}`} className="myp-face" title={p.alias}>
              <Avatar className="avatar myp-av" alias={p.alias} color={p.color} url={p.avatar_url} />
              <small>{p.alias}{(p.is_verified || p.is_team) && <VerifiedBadge n={p.verified_badge} size={11} />}</small>
            </Link>
          ))}
        </div>
      ) : n && <small className="myp-dim">No followers yet. Post a Tik or go live to get noticed.</small>}
    </section>
  );
}
