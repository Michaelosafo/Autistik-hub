"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { countView, markSeen } from "./seen";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, type Tik } from "@/lib/mood";
import TikComposer from "./TikComposer";
import RichText from "./RichText";
import MoodFlash from "./MoodFlash";
import { MoodSticker, STICKERS, stickerOf, type StickerKey } from "./MoodStickers";
import { canStyle } from "./tik-styles";
import { useTiks } from "./useMood";
import { refreshTrending, type Hot } from "./useTrending";

/** "8:43 AM · 15 Nov 26", like X. */
const whenX = (iso: string) => { const d = new Date(iso); return `${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}`; };

/** Reactions: tap the heart to pick one; the count shows the total, tap it to see who reacted with what. */
type RKind = "love" | "haha" | "fire" | "100" | "wow" | "sad" | "pray" | "clap" | "rocket" | "warning" | "thumbs" | StickerKey;
/** The reactions you can pick now: the 10 AUTISTIK stickers (older emoji reactions still show). */
const RKINDS: RKind[] = [...STICKERS.map((x) => x.key), "rocket", "warning", "fire", "thumbs", "clap"];
const ALLKINDS: RKind[] = [...new Set<RKind>([...RKINDS, "love", "haha", "fire", "100", "wow", "sad", "pray", "clap"])];
/** A reaction's picture: the sticker, or the emoji for older reactions. */
function RIcon({ k, size = 20 }: { k: RKind; size?: number }) {
  return stickerOf(k) ? <MoodSticker k={k} size={size} /> : <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{(REMOJI as any)[k] || "❤️"}</span>;
}
const REMOJI: Record<string, string> = { rocket: "🚀", warning: "⚠️", thumbs: "👍", love: "❤️", haha: "😂", fire: "🔥", "100": "💯", wow: "😮", sad: "😢", pray: "🙏", clap: "👏" };
type Rx = { user_id: string; kind: RKind; p: { alias: string; color: string | null; avatar_url: string | null } | null };
const RNAME: Record<string, string> = { rocket: "Rocket", warning: "Careful", thumbs: "Thumbs up", love: "Love", haha: "Haha", fire: "Fire", "100": "100", wow: "Wow", sad: "Sad", pray: "Pray", clap: "Clap", ...Object.fromEntries(STICKERS.map((x) => [x.key, x.label])) };

/** One Tik: who, what they wrote, a picture, likes and replies. */
type CardProps = {
  t: Tik; me: string | null; onRemoved?: (id: string) => void; compact?: boolean; hot?: Hot | null;
  /** In a thread: who the Tik being replied to is by, and "Reply" to this person. */
  parentAlias?: string;
  /** The Tik opened on its own (X-style post page): bigger, full date, comments open, counts the open as a view. */
  detail?: boolean;
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

/** 950 → "950", 1234 → "1.2K", 2500000 → "2.5M". */
/**
 * The view counter's icon: an eye whose iris is a small gradient "signal", pulsing once when the number grows.
 */
function ViewIcon({ grew }: { grew: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={"xi tik-eye" + (grew ? " grew" : "")}><rect x="4" y="13" width="3.4" height="7" rx="1.7" /><rect x="10.3" y="8.5" width="3.4" height="11.5" rx="1.7" /><rect x="16.6" y="4" width="3.4" height="16" rx="1.7" /></svg>
  );
}

const views = (v: number | null | undefined) => { const n = v ?? 0; return n < 1000 ? String(n) : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "")}K` : `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`; };

function TikBody({ t, me, onRemoved, compact, hot, parentAlias, detail }: CardProps) {
  const box = useRef<HTMLElement>(null);
  const router = useRouter();
  const [viewers, setViewers] = useState(false);
  // Views like X: every look (impressions), and never below the members who saw it.
  const [seenN, setSeenN] = useState(Math.max(t.views ?? 0, t.impressions ?? 0));
  const [grew, setGrew] = useState(false);
  const [peek, setPeek] = useState(false);
  useEffect(() => { const v = Math.max(t.views ?? 0, t.impressions ?? 0); setSeenN((o) => { if (v > o) { setGrew(true); setTimeout(() => setGrew(false), 900); } return Math.max(o, v); }); }, [t.views, t.impressions]);
  // Opened on its own: that open is a view (every time), shown straight away.
  useEffect(() => {
    if (!detail || me === t.author_id) return;
    countView(t.id, true);
    setSeenN((n) => n + 1); setGrew(true); const g = setTimeout(() => setGrew(false), 900);
    return () => clearTimeout(g);
  }, [detail, t.id, me, t.author_id]);
  // Counts as seen once it's at least half on screen for a second (the author's own looks don't count).
  useEffect(() => {
    if (me === t.author_id || !box.current) return;
    let tm: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) tm = setTimeout(() => { if (me) markSeen(t.id, me); if (!detail) countView(t.id); io.disconnect(); }, 1000);
      else if (tm) { clearTimeout(tm); tm = null; }
    }, { threshold: 0.5 });
    io.observe(box.current);
    return () => { io.disconnect(); if (tm) clearTimeout(tm); };
  }, [t.id, me, t.author_id]);
  const [liked, setLiked] = useState(t.liked);
  const [myKind, setMyKind] = useState<RKind>("love");
  const [picker, setPicker] = useState(false);
  const [who, setWho] = useState(false);
  // Who reacted with what (for the reaction pills under the post: emoji + up to 4 faces).
  const [rx, setRx] = useState<Rx[]>([]);
  const [rxKey, setRxKey] = useState(0);
  const [whoTab, setWhoTab] = useState<RKind | "all">("all");
  useEffect(() => {
    if (!(t.likes > 0) && rxKey === 0) return;
    let gone = false;
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.from("tik_likes").select("user_id,kind,created_at").eq("tik_id", t.id).order("created_at", { ascending: false }).limit(500);
      if (gone || !data) return;
      const rows = data as { user_id: string; kind: string }[];
      const mineRow = me ? rows.find((r) => r.user_id === me) : null;
      if (mineRow) setMyKind((mineRow.kind as RKind) || "love");
      // Faces: the first 4 of each reaction.
      const want = new Set<string>(); const per = new Map<string, number>();
      for (const r of rows) { const k = per.get(r.kind) || 0; if (k < 4) { want.add(r.user_id); per.set(r.kind, k + 1); } }
      const { data: ps } = want.size ? await sb.from("profiles").select("id,alias,color,avatar_url").in("id", [...want]) : { data: [] };
      const by = new Map(((ps || []) as any[]).map((p) => [p.id, p]));
      if (!gone) setRx(rows.map((r) => ({ user_id: r.user_id, kind: (r.kind as RKind) || "love", p: by.get(r.user_id) || null })));
    })();
    return () => { gone = true; };
  }, [t.id, t.likes, me, rxKey]);
  const [tickled, setTickled] = useState(!!t.tickled);
  const [tickles, setTickles] = useState(t.tickles ?? 0);
  const [copied, setCopied] = useState(false);
  const [likes, setLikes] = useState(t.likes);
  const [replies, setReplies] = useState(t.replies);
  const [open, setOpen] = useState(!!detail);
  // Comments open by themselves when a post with comments scrolls into view (no tapping needed), like X.
  useEffect(() => {
    if (detail || compact || open || !(t.replies > 0) || !box.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOpen(true); io.disconnect(); } }, { rootMargin: "200px 0px" });
    io.observe(box.current);
    return () => io.disconnect();
  }, [detail, compact, open, t.replies]);
  const [zoom, setZoom] = useState(false);
  const [menu, setMenu] = useState(false);
  // A heart that bursts on the picture when you double-tap it (and the like button pops).
  const [burst, setBurst] = useState(0);
  const tap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const a = t.author;
  const mine = !!me && me === t.author_id;
  /** One tap opens the picture; a quick second tap likes it (with a heart burst), like on Instagram. */
  function onPic() {
    if (tap.current) {
      clearTimeout(tap.current); tap.current = null;
      setBurst((n) => n + 1);
      if (!liked) like();
      return;
    }
    tap.current = setTimeout(() => { tap.current = null; setZoom(true); }, 260);
  }

  /** Double-tap on a picture: love it (or keep the reaction you already gave). */
  async function like() { if (!liked) await react("love"); else if (!me) await react("love"); }
  /** React with one of the reactions; the same one again (or null) takes it back. */
  async function react(kind: RKind | null) {
    setPicker(false);
    if (!me) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    const sb = supabaseBrowser();
    const prevLiked = liked, prevKind = myKind;
    const off = kind == null || (liked && kind === myKind);
    if (off) {
      setLiked(false); setLikes((n) => Math.max(0, n - 1));
      const { error } = await sb.from("tik_likes").delete().eq("tik_id", t.id).eq("user_id", me);
      if (error) { setLiked(prevLiked); setLikes((n) => n + 1); }
    } else if (liked) {
      setMyKind(kind!);
      const { error } = await sb.from("tik_likes").update({ kind }).eq("tik_id", t.id).eq("user_id", me);
      if (error) setMyKind(prevKind);
    } else {
      setLiked(true); setMyKind(kind!); setLikes((n) => n + 1);
      const { error } = await sb.from("tik_likes").insert({ tik_id: t.id, kind });
      if (error && error.code !== "23505") { setLiked(false); setLikes((n) => Math.max(0, n - 1)); }
    }
    setRxKey((n) => n + 1);
    refreshTrending();
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
  /** Tapping the post (not a button, link or picture) opens it on its own, like X. */
  function openPost(e: React.MouseEvent) {
    if (detail || compact) return;
    if ((e.target as HTMLElement).closest("a,button,textarea,input,label,.tik-replies,.tik-img,.tik-menu,.tik-rbg,.tik-rpick,[role=dialog]")) return;
    if (window.getSelection()?.toString()) return; // selecting text, not opening
    router.push(`/mood?tik=${t.id}`, { scroll: true });
  }
  async function remove() {
    if (!confirm("Delete this Tik?")) return;
    const { error } = await supabaseBrowser().from("tiks").delete().eq("id", t.id);
    if (!error) onRemoved?.(t.id);
  }

  return (
    <article ref={box} style={{ ["--ac" as any]: a?.color || "#B57CFF" }} onClick={openPost} className={"tik" + (detail ? " detail" : "") + (compact ? " compact" : "") + (!detail && !compact ? " tappable" : "") + (mine ? " mine" : "") + (t.image_url ? " has-img" : "") + (hot ? " hot" : "") + (hot && hot.rank <= 3 ? " top" : "")}>
      {false && hot && <span className="tik-hot" title={`${hot.replies} replies and ${hot.likes} likes in the last 24 hours`}>🔥 Trending{hot.rank <= 3 ? ` #${hot.rank}` : ""}<small>{hot.recent > 0 ? `${hot.recent} in the last hour` : `${hot.replies} replies · ${hot.likes} likes today`}</small></span>}
      <Link href={a ? `/members/${a.id}` : "#"} className="tik-av" aria-label={a?.alias || "Member"}>
        <Avatar className="me-av" alias={a?.alias || "?"} color={a?.color} url={a?.avatar_url} />
        <MoodFlash mood={a?.mood_status} until={a?.mood_until} size={compact ? 16 : 22} />
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
        {t.reply_to && !compact && (t.to?.alias || parentAlias) && <small className="tik-replying">Replying to <b>@{t.to?.handle || t.to?.alias || parentAlias}</b></small>}
        {stickerOf(t.mood) && <span className="tik-msticker" title={stickerOf(t.mood)!.label}><MoodSticker k={t.mood!} size={compact ? 30 : 44} /><small>{stickerOf(t.mood)!.label}</small></span>}
        {t.style && !t.reply_to && canStyle(t.body, !!t.image_url)
          ? <div className={`tik-style s-${t.style}`}><p><RichText text={t.body} /></p></div>
          : <p className="tik-body"><RichText text={t.body} /></p>}
        {t.image_url && (
          <button type="button" className="tik-img" onClick={onPic} aria-label="View the picture (double-tap to like)">
            <span className="tik-img-fill" aria-hidden="true" style={{ backgroundImage: `url("${t.image_url}")` }} />
            <img src={t.image_url} alt="" loading="lazy" />
            {burst > 0 && <span key={burst} className="tik-burst" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.3 11.4 19 15.6 12 20 12 20z" /></svg></span>}
          </button>
        )}
        {!compact && (
          <div className={"tik-detail-meta tik-when" + (detail ? " big" : "")}>
            <time dateTime={t.created_at} title={new Date(t.created_at).toLocaleString()}>{whenX(t.created_at)}</time>
            <span><b>{views(seenN)}</b> {seenN === 1 ? "View" : "Views"}</span>
          </div>
        )}
        {detail && (
          <div className="tik-detail-meta">
            {likes > 0 && <span><b>{likes}</b> {likes === 1 ? "reaction" : "reactions"}</span>}
            {tickles > 0 && <span><b>{tickles}</b> {tickles === 1 ? "tickle" : "tickles"}</span>}
            {replies > 0 && <span><b>{replies}</b> {replies === 1 ? "comment" : "comments"}</span>}
          </div>
        )}
        <div className="tik-actions">
          <button type="button" className={"tik-act reply" + (open ? " on" : "")} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${replies} replies`} title="Reply">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="xi"><path d="M7 4.5h10a3.5 3.5 0 0 1 3.5 3.5v6.5A3.5 3.5 0 0 1 17 18h-5.2L7 21v-3a3.5 3.5 0 0 1-3.5-3.5V8A3.5 3.5 0 0 1 7 4.5z" /><path d="M8.6 11.3h.01M12 11.3h.01M15.4 11.3h.01" strokeWidth="2.6" /></svg>
            <span>{replies > 0 ? replies : ""}</span>
          </button>
          {!t.reply_to && (
            <button type="button" className={"tik-act tickle" + (tickled ? " on" : "")} onClick={tickle} aria-pressed={tickled} aria-label={tickled ? "Undo Tickle" : "Tickle: repost to everyone"} title={tickled ? "Undo Tickle" : "Tickle (repost)"}>
              <svg viewBox="0 0 24 24" aria-hidden="true" className="xi"><path d="M19.5 9.5A8 8 0 0 0 5.2 7.4M4.5 14.5a8 8 0 0 0 14.3 2.1" /><path d="M5 3.8v3.9h3.9M19 20.2v-3.9h-3.9" /></svg>
              <span>{tickles > 0 ? tickles : ""}</span>
            </button>
          )}
          <span className="tik-react-wrap">
            <button type="button" key={liked ? "l1" : "l0"} className={"tik-act like" + (liked ? " on pop" : "")} onClick={() => setPicker(!picker)} aria-pressed={liked} aria-expanded={picker} aria-label={liked ? `Your reaction: ${RNAME[myKind]}. Change it` : "React"} title="React">
              <svg viewBox="0 0 24 24" aria-hidden="true" className={"xi heart" + (liked ? " full" : "")}><path d="M12 20.3s-7.8-4.7-9.4-9.6C1.6 7.5 3.5 4.4 6.8 4.2c2.1-.1 3.6 1 5.2 2.9 1.6-1.9 3.1-3 5.2-2.9 3.3.2 5.2 3.3 4.2 6.5-1.6 4.9-9.4 9.6-9.4 9.6z" /></svg>
            </button>
            {likes > 0 && <button type="button" className="tik-rcount" onClick={() => { setWhoTab("all"); setWho(true); }} aria-label={`${likes} reactions: see who`} title="See who reacted">{likes}</button>}
            {picker && <>
              <span className="tik-rbg" onClick={() => setPicker(false)} aria-hidden="true" />
              <span className="tik-rpick" role="menu" aria-label="Pick a reaction">
                {RKINDS.map((k) => <button key={k} type="button" role="menuitem" className={liked && myKind === k ? "on" : ""} onClick={() => react(k)} aria-label={RNAME[k]} title={RNAME[k]}><RIcon k={k} size={30} /></button>)}
              </span>
            </>}
          </span>
          {!t.reply_to && (me === t.author_id
            ? <button type="button" className="tik-act views" onClick={() => setViewers(true)} aria-label={`${seenN} views: see who`} title="Views: see who saw it">
                <ViewIcon grew={grew} />
                <span className="tik-vn"><b>{views(seenN)}</b></span>
              </button>
            : <button type="button" className={"tik-act views" + (peek ? " on" : "")} onClick={() => { setPeek(true); setTimeout(() => setPeek(false), 2200); }} aria-label={`${seenN} views`} title="Views">
                <ViewIcon grew={grew} />
                <span className="tik-vn"><b>{views(seenN)}</b></span>
                {peek && <span className="tik-peek" role="status">👁 {seenN.toLocaleString()} {seenN === 1 ? "view" : "views"}</span>}
              </button>)}
          <button type="button" className={"tik-act share" + (copied ? " on" : "")} onClick={copyLink} aria-label="Copy link to this Tik" title="Copy link">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="xi"><path d="M12 14.5V3.5M7.8 7.6 12 3.5l4.2 4.1" /><path d="M5 12.5v4.8A2.7 2.7 0 0 0 7.7 20h8.6a2.7 2.7 0 0 0 2.7-2.7v-4.8" /></svg>
            <span>{copied ? "Copied" : ""}</span>
          </button>
        </div>
        {!open && replies > 0 && <button type="button" className="tik-show" onClick={() => setOpen(true)}>View {replies} {replies === 1 ? "comment" : "comments"}</button>}
        {open && <Replies tik={t} me={me} limit={detail ? 20 : 3} onCount={(d) => { setReplies((n) => n + d); refreshTrending(); }} />}
        {open && !detail && !compact && replies > 3 && <Link href={`/mood?tik=${t.id}`} className="tik-show">See all {replies} comments →</Link>}
        {who && typeof document !== "undefined" && createPortal(<Reactors tikId={t.id} total={likes} first={whoTab} onClose={() => setWho(false)} />, document.body)}
        {viewers && typeof document !== "undefined" && createPortal(<Viewers tikId={t.id} count={t.views ?? 0} total={seenN} onClose={() => setViewers(false)} />, document.body)}
      </div>
      {zoom && t.image_url && (
        <div className="tik-zoom" role="dialog" aria-modal="true" aria-label="Picture" onClick={() => setZoom(false)}>
          <span className="tik-zoom-bg" aria-hidden="true" style={{ backgroundImage: `url("${t.image_url}")` }} />
          <button type="button" className="tik-zoom-x" aria-label="Close" onClick={() => setZoom(false)}>✕</button>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={t.image_url} alt="" />
            <figcaption>
              <Avatar className="me-av" alias={a?.alias || "?"} color={a?.color} url={a?.avatar_url} />
              <span><b>{a?.alias || "Member"}</b>{t.body && <small>{t.body.slice(0, 140)}{t.body.length > 140 ? "…" : ""}</small>}</span>
              <button type="button" className={"tik-zoom-like" + (liked ? " on" : "")} onClick={like} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.3-8.6C1.2 8.4 3 5 6.4 5c2 0 3.4 1.1 4.1 2.3h3C14.2 6.1 15.6 5 17.6 5 21 5 22.8 8.4 21.3 11.4 19 15.6 12 20 12 20z" /></svg>{likes > 0 ? likes : ""}
              </button>
            </figcaption>
          </figure>
        </div>
      )}
    </article>
  );
}

/** The replies under one Tik or one comment; each reply can have its own replies underneath (a thread). */
function Replies({ tik, me, onCount, limit = 20 }: { tik: Tik; me: string | null; onCount: (d: number) => void; limit?: number }) {
  const [k, setK] = useState(0);
  const { tiks, setTiks, more, loadMore } = useTiks({ replyTo: tik.id, limit, refreshKey: k });
  return (
    <div className="tik-replies">
      {tiks === null ? <small className="muted">Loading replies…</small> : tiks.map((r) => (
        <TikCard key={r.id} t={r} me={me} compact parentAlias={tik.author?.handle || tik.author?.alias}
          onRemoved={(id) => { setTiks((x) => x?.filter((y) => y.id !== id) ?? null); onCount(-1); }} />
      ))}
      {more && limit > 3 && <button type="button" className="tik-more" onClick={loadMore}>More replies</button>}
      {me && <QuickReplies tikId={tik.id} onSent={() => { setK((n) => n + 1); onCount(1); }} />}
      {me ? <TikComposer replyTo={tik.id} compact placeholder="Write a comment…" onPosted={() => { setK((n) => n + 1); onCount(1); }} /> : <small className="muted"><Link href="/login">Sign in</Link> to reply.</small>}
    </div>
  );
}

/** One-tap replies, so joining a conversation is as quick as a reaction. */
const QUICK = ["🔥 LFG", "😂😂", "💯 Facts", "🚀 To the moon", "👀 Watching", "❤️ Love this"];
function QuickReplies({ tikId, onSent }: { tikId: string; onSent: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function send(text: string) {
    if (busy) return;
    setBusy(text);
    const { error } = await supabaseBrowser().from("tiks").insert({ body: text, reply_to: tikId });
    setBusy(null);
    if (!error) onSent();
  }
  return (
    <div className="tik-quick" role="group" aria-label="Quick replies">
      {STICKERS.map((x) => <button key={x.key} type="button" className={"st" + (busy === `:${x.key}:` ? " on" : "")} disabled={!!busy} onClick={() => send(`:${x.key}:`)} aria-label={`Send ${x.label}`} title={x.label}><MoodSticker k={x.key} size={26} /></button>)}
      {QUICK.map((q) => <button key={q} type="button" disabled={!!busy} className={busy === q ? "on" : ""} onClick={() => send(q)}>{q}</button>)}
    </div>
  );
}

/** Who reacted and with what: a small sheet with tabs per reaction; tap outside to go back. */
function Reactors({ tikId, total, first = "all", onClose }: { tikId: string; total: number; first?: RKind | "all"; onClose: () => void }) {
  const [list, setList] = useState<{ id: string; alias: string; color: string | null; avatar_url: string | null; kind: RKind; at: string }[] | null>(null);
  const [tab, setTab] = useState<RKind | "all">(first);
  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data } = await sb.from("tik_likes").select("user_id,kind,created_at").eq("tik_id", tikId).order("created_at", { ascending: false }).limit(300);
      const rows = (data || []) as { user_id: string; kind: string; created_at: string }[];
      const { data: ps } = rows.length ? await sb.from("profiles").select("id,alias,color,avatar_url").in("id", rows.map((r) => r.user_id)) : { data: [] };
      const by = new Map(((ps || []) as any[]).map((p) => [p.id, p]));
      setList(rows.map((r) => ({ id: r.user_id, alias: by.get(r.user_id)?.alias || "Member", color: by.get(r.user_id)?.color ?? null, avatar_url: by.get(r.user_id)?.avatar_url ?? null, kind: (r.kind as RKind) || "love", at: r.created_at })));
    })();
  }, [tikId]);
  const counts = new Map<RKind, number>();
  for (const r of list || []) counts.set(r.kind, (counts.get(r.kind) || 0) + 1);
  const shown = (list || []).filter((r) => tab === "all" || r.kind === tab);
  return (
    <div className="tik-viewers-bg" role="dialog" aria-modal="true" aria-label="Reactions" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tik-viewers tik-reactors">
        <div className="tik-viewers-h"><b>{total} {total === 1 ? "reaction" : "reactions"}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="tik-rtabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All {list?.length ?? ""}</button>
          {[...counts.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)} title={RNAME[k]}><RIcon k={k} size={18} /> {n}</button>)}
        </div>
        {list === null ? <small className="muted">Loading…</small> : shown.length === 0 ? <small className="muted">No reactions yet.</small> : (
          <ul>{shown.map((v) => (
            <li key={v.id}><Link href={`/members/${v.id}`} onClick={onClose}><span className="tik-rav"><Avatar className="me-av" alias={v.alias} color={v.color} url={v.avatar_url} /><i aria-label={RNAME[v.kind]}><RIcon k={v.kind} size={16} /></i></span><b>{v.alias}</b><small>{ago(v.at)}</small></Link></li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

/** Who has seen your Tik (only you, the author, can see this list). */
function Viewers({ tikId, count, total, onClose }: { tikId: string; count: number; total: number; onClose: () => void }) {
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
        <div className="tik-viewers-h"><b>{views(total)} views · seen by {count} {count === 1 ? "member" : "members"}</b><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
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
