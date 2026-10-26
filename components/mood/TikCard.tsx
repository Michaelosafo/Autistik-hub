"use client";
import Link from "next/link";
import { useState } from "react";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago, moodOf, type Tik } from "@/lib/mood";
import TikComposer from "./TikComposer";
import { useTiks } from "./useMood";

/** One Tik: who, how they feel, what they wrote, a picture, likes and replies. */
export default function TikCard({ t, me, onRemoved, compact }: { t: Tik; me: string | null; onRemoved?: (id: string) => void; compact?: boolean }) {
  const [liked, setLiked] = useState(t.liked);
  const [likes, setLikes] = useState(t.likes);
  const [replies, setReplies] = useState(t.replies);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const mood = moodOf(t.mood);
  const a = t.author;

  async function like() {
    if (!me) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    const sb = supabaseBrowser();
    const next = !liked;
    setLiked(next); setLikes((n) => n + (next ? 1 : -1));
    const { error } = next ? await sb.from("tik_likes").insert({ tik_id: t.id }) : await sb.from("tik_likes").delete().eq("tik_id", t.id).eq("user_id", me);
    if (error && error.code !== "23505") { setLiked(!next); setLikes((n) => n + (next ? -1 : 1)); }
  }
  async function remove() {
    if (!confirm("Delete this Tik?")) return;
    const { error } = await supabaseBrowser().from("tiks").delete().eq("id", t.id);
    if (!error) onRemoved?.(t.id);
  }

  return (
    <article className={"tik" + (compact ? " compact" : "")}>
      <Link href={a ? `/members/${a.id}` : "#"} className="tik-av" aria-label={a?.alias || "Member"}>
        <Avatar className="me-av" alias={a?.alias || "?"} color={a?.color} url={a?.avatar_url} />
      </Link>
      <div className="tik-main">
        <div className="tik-head">
          <b>{a?.alias || "Member"}</b>
          {a?.is_verified && <span className="mp-tick" title="Verified">✓</span>}
          {a?.is_team && <span className="tik-team">Team</span>}
          {mood && <span className="tik-mood" style={{ ["--mc" as any]: mood.color }}>feeling {mood.label.toLowerCase()}</span>}
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
          {me && me === t.author_id && <button type="button" className="tik-act del" onClick={remove}>Delete</button>}
        </div>
        {open && <Replies tik={t} me={me} onCount={(d) => setReplies((n) => n + d)} />}
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
