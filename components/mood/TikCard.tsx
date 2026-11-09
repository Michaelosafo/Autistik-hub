"use client";
import Link from "next/link";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, type Tik } from "@/lib/mood";
import TikComposer from "./TikComposer";
import { useTiks } from "./useMood";
import { refreshTrending, type Hot } from "./useTrending";

/** One Tik: who, what they wrote, a picture, likes and replies. */
export default function TikCard(props: { t: Tik; me: string | null; onRemoved?: (id: string) => void; compact?: boolean; hot?: Hot | null }) {
  const { t, me, onRemoved } = props;
  // A Tickle: "🔁 name tickled" over the original Tik. (Its original was deleted or hidden: nothing to show.)
  if (t.tickle_of) {
    if (!t.orig) return null;
    return (
      <div className="tik-tickled">
        <small className="tik-tickled-by">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></svg>
          {me === t.author_id ? "You" : t.author?.alias || "Someone"} tickled
        </small>
        <TikBody {...props} t={t.orig} onRemoved={() => onRemoved?.(t.id)} />
      </div>
    );
  }
  return <TikBody {...props} />;
}

function TikBody({ t, me, onRemoved, compact, hot }: { t: Tik; me: string | null; onRemoved?: (id: string) => void; compact?: boolean; hot?: Hot | null }) {
  const [liked, setLiked] = useState(t.liked);
  const [tickled, setTickled] = useState(!!t.tickled);
  const [tickles, setTickles] = useState(t.tickles ?? 0);
  const [copied, setCopied] = useState(false);
  const [likes, setLikes] = useState(t.likes);
  const [replies, setReplies] = useState(t.replies);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const a = t.author;

  async function like() {
    if (!me) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    const sb = supabaseBrowser();
    const next = !liked;
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    const { error } = next ? await sb.from("tik_likes").insert({ tik_id: t.id }) : await sb.from("tik_likes").delete().eq("tik_id", t.id).eq("user_id", me);
    if (error && error.code !== "23505") { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
    else refreshTrending();
  }
  /** Tickle (repost) this Tik to everyone's feed, or undo it. */
  async function tickle() {
    if (!me) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    const sb = supabaseBrowser();
    const next = !tickled;
    setTickled(next); setTickles((n) => n + (next ? 1 : -1));
    const { error } = next ? await sb.from("tiks").insert({ author_id: me, body: "", tickle_of: t.id }) : await sb.from("tiks").delete().eq("author_id", me).eq("tickle_of", t.id);
    if (error && error.code !== "23505") { setTickled(!next); setTickles((n) => n + (next ? -1 : 1)); }
    else refreshTrending();
  }
  /** A link that opens this Tik directly (share it anywhere). */
  async function copyLink() {
    const url = `${location.origin}/tik?tik=${t.id}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copy this link:", url); }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }
  async function remove() {
    if (!confirm("Delete this Tik?")) return;
    const { error } = await supabaseBrowser().from("tiks").delete().eq("id", t.id);
    if (!error) onRemoved?.(t.id);
  }

  return (
    <article className={"tik" + (compact ? " compact" : "") + (hot ? " hot" : "") + (hot && hot.rank <= 3 ? " top" : "")}>
      {hot && <span className="tik-hot" title={`${hot.replies} replies and ${hot.likes} likes in the last 24 hours`}>🔥 Trending{hot.rank <= 3 ? ` #${hot.rank}` : ""}<small>{hot.recent > 0 ? `${hot.recent} in the last hour` : `${hot.replies} replies · ${hot.likes} likes today`}</small></span>}
      <Link href={a ? `/members/${a.id}` : "#"} className="tik-av" aria-label={a?.alias || "Member"}>
        <Avatar className="me-av" alias={a?.alias || "?"} color={a?.color} url={a?.avatar_url} />
      </Link>
      <div className="tik-main">
        <div className="tik-head">
          <b>{a?.alias || "Member"}</b>
          {a?.is_verified && <VerifiedBadge n={a.verified_badge} size={15} className="vbadge-name" />}
          {a?.is_team && <span className="tik-team">Team</span>}
          <small className="tik-time">{ago(t.created_at)}</small>
        </div>
        <p className="tik-body">{t.body}</p>
        {t.image_url && (
          <button type="button" className="tik-img" onClick={() => setZoom(true)} aria-label="View the picture">
            <img src={t.image_url} alt="" loading="lazy" />
          </button>
        )}
        <div className="tik-actions">
          <button type="button" className={"tik-act" + (liked ? " on" : "")} onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.3 11.4 19 15.6 12 20 12 20z" /></svg>
            {likes > 0 && <span>{likes}</span>}
          </button>
          {!t.reply_to && (
            <button type="button" className={"tik-act" + (open ? " on" : "")} onClick={() => setOpen(!open)} aria-expanded={open}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z" /></svg>
              <span>{replies > 0 ? replies : "Reply"}</span>
            </button>
          )}
          {!t.reply_to && (
            <button type="button" className={"tik-act tickle" + (tickled ? " on" : "")} onClick={tickle} aria-pressed={tickled} aria-label={tickled ? "Undo Tickle" : "Tickle: repost to everyone"} title={tickled ? "Undo Tickle" : "Tickle (repost)"}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></svg>
              <span>{tickles > 0 ? tickles : "Tickle"}</span>
            </button>
          )}
          <button type="button" className={"tik-act" + (copied ? " on" : "")} onClick={copyLink} aria-label="Copy link to this Tik">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
            <span>{copied ? "Copied!" : "Copy link"}</span>
          </button>
          {me && me === t.author_id && <button type="button" className="tik-act del" onClick={remove}>Delete</button>}
        </div>
        {open && <Replies tik={t} me={me} onCount={(d) => { setReplies((n) => n + d); refreshTrending(); }} />}
      </div>
      {zoom && t.image_url && (
        <div className="tik-zoom" role="dialog" aria-modal="true" aria-label="Picture" onClick={() => setZoom(false)}>
          <img src={t.image_url} alt="" />
        </div>
      )}
    </article>
  );
}

function Replies({ tik, me, onCount }: { tik: Tik; me: string | null; onCount: (d: number) => void }) {
  const [k, setK] = useState(0);
  const { tiks, setTiks, more, loadMore } = useTiks({ replyTo: tik.id, limit: 20, refreshKey: k });
  return (
    <div className="tik-replies">
      {tiks === null ? <small className="muted">Loading replies…</small> : tiks.map((r) => (
        <TikCard key={r.id} t={r} me={me} compact onRemoved={(id) => { setTiks((x) => x?.filter((y) => y.id !== id) ?? null); onCount(-1); }} />
      ))}
      {more && <button type="button" className="tik-more" onClick={loadMore}>More replies</button>}
      {me ? <TikComposer replyTo={tik.id} compact onPosted={() => { setK((n) => n + 1); onCount(1); }} /> : <small className="muted"><Link href="/login">Sign in</Link> to reply.</small>}
    </div>
  );
}
