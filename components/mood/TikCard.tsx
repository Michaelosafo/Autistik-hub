"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { markSeen } from "./seen";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, type Tik } from "@/lib/mood";
import TikComposer from "./TikComposer";
import RichText from "./RichText";
import { canStyle } from "./tik-styles";
import { useTiks } from "./useMood";
import { refreshTrending, type Hot } from "./useTrending";

/** One Tik: who, what they wrote, a picture, likes and replies. */
type CardProps = {
  t: Tik; me: string | null; onRemoved?: (id: string) => void; compact?: boolean; hot?: Hot | null;
  /** In a thread: who the Tik being replied to is by, and "Reply" to this person. */
  parentAlias?: string;
};
export default function TikCard(props: CardProps) {
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

function TikBody({ t, me, onRemoved, compact, hot, parentAlias }: CardProps) {
  const box = useRef<HTMLElement>(null);
  const [viewers, setViewers] = useState(false);
  // Counts as seen once it's at least half on screen for a second (the author's own looks don't count).
  useEffect(() => {
    if (!me || me === t.author_id || !box.current) return;
    let tm: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) tm = setTimeout(() => { markSeen(t.id, me); io.disconnect(); }, 1000);
      else if (tm) { clearTimeout(tm); tm = null; }
    }, { threshold: 0.5 });
    io.observe(box.current);
    return () => { io.disconnect(); if (tm) clearTimeout(tm); };
  }, [t.id, me, t.author_id]);
  const [liked, setLiked] = useState(t.liked);
  const [tickled, setTickled] = useState(!!t.tickled);
  const [tickles, setTickles] = useState(t.tickles ?? 0);
  const [copied, setCopied] = useState(false);
  const [likes, setLikes] = useState(t.likes);
  const [replies, setReplies] = useState(t.replies);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [menu, setMenu] = useState(false);
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
    const { error } = next ? await sb.from("tiks").insert({ body: "", tickle_of: t.id }) : await sb.from("tiks").delete().eq("author_id", me).eq("tickle_of", t.id);
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
    <article ref={box} className={"tik" + (compact ? " compact" : "") + (hot ? " hot" : "") + (hot && hot.rank <= 3 ? " top" : "")}>
      {hot && <span className="tik-hot" title={`${hot.replies} replies and ${hot.likes} likes in the last 24 hours`}>🔥 Trending{hot.rank <= 3 ? ` #${hot.rank}` : ""}<small>{hot.recent > 0 ? `${hot.recent} in the last hour` : `${hot.replies} replies · ${hot.likes} likes today`}</small></span>}
      <Link href={a ? `/members/${a.id}` : "#"} className="tik-av" aria-label={a?.alias || "Member"}>
        <Avatar className="me-av" alias={a?.alias || "?"} color={a?.color} url={a?.avatar_url} />
      </Link>
      <div className="tik-main">
        <div className="tik-head">
          <Link href={a ? `/members/${a.id}` : "#"} className="tik-name">{a?.alias || "Member"}</Link>
          {a?.is_verified && <VerifiedBadge n={a.verified_badge} size={15} className="vbadge-name" />}
          {a?.is_team && <span className="tik-team">Team</span>}
          {a?.handle && <span className="tik-handle">@{a.handle}</span>}
          <span className="tik-dotsep" aria-hidden="true">·</span>
          <time className="tik-time" dateTime={t.created_at} title={new Date(t.created_at).toLocaleString()}>{ago(t.created_at)}</time>
          <div className="tik-menu-wrap">
            <button type="button" className="tik-menu-btn" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
            </button>
            {menu && (
              <>
                <div className="tik-menu-bg" onClick={() => setMenu(false)} />
                <div className="tik-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setMenu(false); copyLink(); }}>🔗 Copy link</button>
                  {a && <Link role="menuitem" href={`/members/${a.id}`} onClick={() => setMenu(false)}>👤 View profile</Link>}
                  {me && me === t.author_id && <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(false); remove(); }}>🗑 Delete</button>}
                </div>
              </>
            )}
          </div>
        </div>
        {t.reply_to && (t.to?.alias || parentAlias) && <small className="tik-replying">Replying to <b>@{t.to?.handle || t.to?.alias || parentAlias}</b></small>}
        {t.style && !t.reply_to && canStyle(t.body, !!t.image_url)
          ? <div className={`tik-style s-${t.style}`}><p><RichText text={t.body} /></p></div>
          : <p className="tik-body"><RichText text={t.body} /></p>}
        {t.image_url && (
          <button type="button" className="tik-img" onClick={() => setZoom(true)} aria-label="View the picture">
            <img src={t.image_url} alt="" loading="lazy" />
          </button>
        )}
        <div className="tik-actions">
          <button type="button" className={"tik-act reply" + (open ? " on" : "")} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${replies} replies`} title="Reply">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z" /></svg>
            <span>{replies > 0 ? replies : ""}</span>
          </button>
          {!t.reply_to && (
            <button type="button" className={"tik-act tickle" + (tickled ? " on" : "")} onClick={tickle} aria-pressed={tickled} aria-label={tickled ? "Undo Tickle" : "Tickle: repost to everyone"} title={tickled ? "Undo Tickle" : "Tickle (repost)"}>
              <svg viewBox="0 0 24 24" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></svg>
              <span>{tickles > 0 ? tickles : ""}</span>
            </button>
          )}
          <button type="button" className={"tik-act like" + (liked ? " on" : "")} onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} title="Like">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.3 11.4 19 15.6 12 20 12 20z" /></svg>
            <span>{likes > 0 ? likes : ""}</span>
          </button>
          {!t.reply_to && (me === t.author_id
            ? <button type="button" className="tik-act views" onClick={() => setViewers(true)} aria-label={`${t.views ?? 0} views: see who`} title="See who viewed">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
                <span>{t.views ?? 0}</span>
              </button>
            : <span className="tik-act views static" aria-label={`${t.views ?? 0} views`} title="Views">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
                <span>{(t.views ?? 0) > 0 ? t.views : ""}</span>
              </span>)}
          <button type="button" className={"tik-act share" + (copied ? " on" : "")} onClick={copyLink} aria-label="Copy link to this Tik" title="Copy link">
            <svg viewBox="0 0 24 24" aria-hidden="true" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
            <span>{copied ? "Copied" : ""}</span>
          </button>
        </div>
        {!open && replies > 0 && <button type="button" className="tik-show" onClick={() => setOpen(true)}><i aria-hidden="true" />Show {replies} {replies === 1 ? "reply" : "replies"}</button>}
        {open && <Replies tik={t} me={me} onCount={(d) => { setReplies((n) => n + d); refreshTrending(); }} />}
        {viewers && typeof document !== "undefined" && createPortal(<Viewers tikId={t.id} count={t.views ?? 0} onClose={() => setViewers(false)} />, document.body)}
      </div>
      {zoom && t.image_url && (
        <div className="tik-zoom" role="dialog" aria-modal="true" aria-label="Picture" onClick={() => setZoom(false)}>
          <img src={t.image_url} alt="" />
        </div>
      )}
    </article>
  );
}

/** The replies under one Tik or one comment; each reply can have its own replies underneath (a thread). */
function Replies({ tik, me, onCount }: { tik: Tik; me: string | null; onCount: (d: number) => void }) {
  const [k, setK] = useState(0);
  const owner = tik.author?.alias || "them";
  const { tiks, setTiks, more, loadMore } = useTiks({ replyTo: tik.id, limit: 20, refreshKey: k });
  return (
    <div className="tik-replies">
      {tiks === null ? <small className="muted">Loading replies…</small> : tiks.map((r) => (
        <TikCard key={r.id} t={r} me={me} compact parentAlias={tik.author?.handle || tik.author?.alias}
          onRemoved={(id) => { setTiks((x) => x?.filter((y) => y.id !== id) ?? null); onCount(-1); }} />
      ))}
      {more && <button type="button" className="tik-more" onClick={loadMore}>More replies</button>}
      {me ? <TikComposer replyTo={tik.id} compact placeholder={`Reply to ${owner}…`} onPosted={() => { setK((n) => n + 1); onCount(1); }} /> : <small className="muted"><Link href="/login">Sign in</Link> to reply.</small>}
    </div>
  );
}

/** Who has seen your Tik (only you, the author, can see this list). */
function Viewers({ tikId, count, onClose }: { tikId: string; count: number; onClose: () => void }) {
  const [list, setList] = useState<{ id: string; alias: string; color: string | null; avatar_url: string | null; at: string }[] | null>(null);
  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data } = await sb.from("tik_views").select("user_id,seen_at").eq("tik_id", tikId).order("seen_at", { ascending: false }).limit(200);
      const rows = (data || []) as { user_id: string; seen_at: string }[];
      const { data: ps } = rows.length ? await sb.from("profiles").select("id,alias,color,avatar_url").in("id", rows.map((r) => r.user_id)) : { data: [] };
      const by = new Map(((ps || []) as any[]).map((p) => [p.id, p]));
      setList(rows.map((r) => ({ id: r.user_id, alias: by.get(r.user_id)?.alias || "Member", color: by.get(r.user_id)?.color ?? null, avatar_url: by.get(r.user_id)?.avatar_url ?? null, at: r.seen_at })));
    })();
  }, [tikId]);
  return (
    <div className="tik-viewers-bg" role="dialog" aria-modal="true" aria-label="Seen by" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tik-viewers">
        <div className="tik-viewers-h"><b>Seen by {count}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
        {list === null ? <small className="muted">Loading…</small> : list.length === 0 ? <small className="muted">No views yet.</small> : (
          <ul>{list.map((v) => (
            <li key={v.id}><Link href={`/members/${v.id}`} onClick={onClose}><Avatar className="me-av" alias={v.alias} color={v.color} url={v.avatar_url} /><b>{v.alias}</b><small>{ago(v.at)}</small></Link></li>
          ))}</ul>
        )}
        <small className="muted">Only you can see who viewed your Tik.</small>
      </div>
    </div>
  );
}
