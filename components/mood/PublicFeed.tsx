/**
 * TIK for visitors who haven't signed in: a read-only look at the latest Tiks, rendered on the server with only
 * public fields (name, picture, badge, the post, counts). Only members whose activity is visible to "everyone" are
 * shown. Reacting, commenting and posting ask them to sign in.
 */
import Link from "next/link";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseService } from "@/lib/supabase/server";
import { ago } from "@/lib/mood";
import RichText from "./RichText";
import MoodFlash from "./MoodFlash";
import { MoodSticker, STICKERS, stickerOf } from "./MoodStickers";

type Row = {
  id: string; body: string; mood: string | null; image_url: string | null; created_at: string; author_id: string;
  author: { id: string; alias: string; handle: string | null; color: string | null; avatar_url: string | null; is_team: boolean; is_verified: boolean; verified_badge: number | null; activity_visibility: string | null; mood_status: string | null; mood_until: string | null } | null;
  tik_likes: { count: number }[]; replies: { count: number }[];
};

export default async function PublicFeed({ focus }: { focus?: string }) {
  let rows: Row[] = [];
  try {
    const sb = supabaseService();
    let q = sb.from("tiks")
      .select("id,body,mood,image_url,created_at,author_id,author:profiles!tiks_author_id_fkey(id,alias,handle,color,avatar_url,is_team,is_verified,verified_badge,activity_visibility,mood_status,mood_until),tik_likes(count),replies:tiks!reply_to(count)")
      .eq("hidden", false).is("reply_to", null).is("tickle_of", null).order("created_at", { ascending: false }).limit(30);
    if (focus) q = q.eq("id", focus);
    const { data } = await q;
    rows = ((data || []) as any[]).filter((r) => r.author && (r.author.activity_visibility || "everyone") === "everyone");
  } catch { rows = []; }
  const join = "/login?mode=join&next=/mood";
  return (
    <div className="pubtik stack">
      <section className="pubtik-join">
        <div className="pubtik-stk" aria-hidden="true">{STICKERS.slice(0, 5).map((s) => <MoodSticker key={s.key} k={s.key} size={34} />)}</div>
        <div className="pubtik-t"><b>You&apos;re looking at TIK</b><small>See what the community is feeling. Join free to post your mood, react with stickers and comment.</small></div>
        <div className="pubtik-btns"><Link className="pubtik-btn main" href={join}>Join free</Link><Link className="pubtik-btn" href="/login?next=/mood">Sign in</Link></div>
      </section>
      {!rows.length ? <div className="card"><small className="muted">No Tiks to show yet.</small></div> : rows.map((t) => {
        const a = t.author!, likes = t.tik_likes?.[0]?.count ?? 0, replies = t.replies?.[0]?.count ?? 0, st = stickerOf(t.mood);
        const v = a.is_verified || a.is_team;
        return (
          <article key={t.id} className="tik pubtik-card">
            <span className="tik-av"><Avatar className="me-av" alias={a.alias} color={a.color} url={a.avatar_url} /><MoodFlash mood={a.mood_status} until={a.mood_until} /></span>
            <div className="tik-main">
              <div className="tik-head">
                <b className="tik-name">{a.alias}</b>
                {v && <VerifiedBadge n={a.verified_badge} size={15} className="vbadge-name" title={a.is_team ? "AUTISTIK team" : "Verified by AUTISTIK"} />}
                {a.is_team && <span className="tik-team">Team</span>}
                {a.handle && <span className="tik-handle">@{a.handle}</span>}
                <span className="tik-dotsep" aria-hidden="true">·</span>
                <time className="tik-time" dateTime={t.created_at}>{ago(t.created_at)}</time>
              </div>
              {st && <span className="tik-msticker"><MoodSticker k={st.key} size={40} /><small>{st.label}</small></span>}
              <p className="tik-body"><RichText text={t.body} /></p>
              {t.image_url && <span className="tik-img pubtik-img"><img src={t.image_url} alt="" loading="lazy" /></span>}
              <div className="tik-actions">
                <Link className="tik-act reply" href={join} aria-label={`${replies} comments: join to comment`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z" /></svg><span>{replies || ""}</span>
                </Link>
                <Link className="tik-act like" href={join} aria-label={`${likes} reactions: join to react`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.3 11.4 19 15.6 12 20 12 20z" /></svg><span>{likes || ""}</span>
                </Link>
                <span className="pubtik-hint">Join to react &amp; comment</span>
              </div>
            </div>
          </article>
        );
      })}
      <Link className="pubtik-btn main" href={join} style={{ alignSelf: "center" }}>Join TIK free →</Link>
    </div>
  );
}
