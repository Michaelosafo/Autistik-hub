"use client";
/** One video or stream: the player, its numbers, likes, and comments (live chat while a stream is on). */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmtCount, playerUrl, playUid, type Video } from "@/lib/stream-shared";
import { ago, videoApi, withAuthors, type Author, type VideoRow } from "./data";

type Comment = { id: number; user_id: string; body: string; created_at: string; author?: Author | null };

export default function WatchView({ video, me, admin }: { video: Video; me: string | null; admin: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<VideoRow>(video);
  const [liked, setLiked] = useState(false);
  const [list, setList] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const sb = useRef(supabaseBrowser()).current;
  const live = v.kind === "stream" && v.status === "live";
  const uid = playUid(v);

  useEffect(() => {
    withAuthors([video]).then(([x]) => setV(x));
    videoApi("view", { id: video.id }).catch(() => {});
    if (me) sb.from("video_likes").select("video_id").eq("video_id", video.id).eq("user_id", me).maybeSingle().then(({ data }) => setLiked(!!data));
    const load = async () => {
      const { data } = await sb.from("video_comments").select("id,user_id,body,created_at").eq("video_id", video.id).order("id", { ascending: false }).limit(80);
      const rows = (data || []) as Comment[];
      const { data: ps } = rows.length ? await sb.from("profiles").select("id,alias,color,avatar_url").in("id", [...new Set(rows.map((r) => r.user_id))]) : { data: [] };
      const by = new Map(((ps || []) as Author[]).map((a) => [a.id, a]));
      setList(rows.map((r) => ({ ...r, author: by.get(r.user_id) ?? null })));
    };
    load();
    // New comments arrive instantly (live chat during a stream).
    const ch = sb.channel(`vc:${video.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "video_comments", filter: `video_id=eq.${video.id}` }, () => load()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [video.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stream: keep its state fresh (live → ended → recording ready).
  useEffect(() => {
    if (v.kind !== "stream" || (v.status === "ended" && v.rec_uid)) return;
    const t = setInterval(() => videoApi<{ status: string; rec_uid: string | null }>("sync", { id: v.id }).then((s) => setV((x) => ({ ...x, status: s.status, rec_uid: s.rec_uid ?? x.rec_uid }))).catch(() => {}), 20_000);
    return () => clearInterval(t);
  }, [v.kind, v.status, v.rec_uid, v.id]);

  async function like() {
    if (!me) return router.push(`/login?next=/watch/${v.id}`);
    const next = !liked; setLiked(next); setV((x) => ({ ...x, likes: x.likes + (next ? 1 : -1) }));
    const r = next ? await sb.from("video_likes").insert({ video_id: v.id, user_id: me }) : await sb.from("video_likes").delete().eq("video_id", v.id).eq("user_id", me);
    if (r.error) { setLiked(!next); setV((x) => ({ ...x, likes: x.likes + (next ? -1 : 1) })); }
  }
  async function comment(e: React.FormEvent) {
    e.preventDefault();
    if (!me || !text.trim()) return;
    const body = text.trim().slice(0, 500); setText("");
    const { error } = await sb.from("video_comments").insert({ video_id: v.id, user_id: me, body });
    if (error) { setText(body); setMsg("Couldn't post that. Slow down a little and try again."); }
  }
  async function remove() {
    if (!confirm("Delete this for good?")) return;
    await videoApi("delete", { id: v.id }).then(() => router.push("/mood?tab=" + (v.kind === "fun" ? "fun" : v.kind === "stream" ? "streams" : "videos"))).catch((e) => setMsg(e.message));
  }
  async function hide() { await videoApi("hide", { id: v.id, hidden: true }).then(() => setMsg("Hidden from everyone.")).catch((e) => setMsg(e.message)); }

  return (
    <div className={"wv-watch" + (v.kind === "fun" ? " fun" : "")}>
      <div className="wv-player">
        {uid ? <iframe src={playerUrl(uid, { autoplay: live || v.kind === "fun", muted: v.kind === "fun", loop: v.kind === "fun" })} title={v.title} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen />
          : <div className="wv-wait">{v.kind === "stream" ? (v.status === "waiting" ? "Starting soon…" : "The stream has ended. The recording will be here in a few minutes.") : "Getting this video ready…"}</div>}
      </div>
      <div className="wv-info">
        <h1>{live && <em className="wv-live">LIVE</em>}{v.title}</h1>
        <div className="wv-row">
          <Link href={`/members/${v.author_id}`} className="wv-by">
            {v.author && <Avatar className="me-av wv-av" alias={v.author.alias} color={v.author.color} url={v.author.avatar_url} />}
            <span><b>{v.author?.alias || "Member"}</b><small>{fmtCount(v.views)} views · {ago(v.started_at || v.created_at)}</small></span>
          </Link>
          <button type="button" className={"wv-like" + (liked ? " on" : "")} onClick={like} aria-pressed={liked}>♥ {fmtCount(v.likes)}</button>
          <button type="button" className="wv-like" onClick={() => navigator.share?.({ title: v.title, url: location.href }).catch(() => {}) ?? navigator.clipboard.writeText(location.href)}>Share</button>
        </div>
        {v.about && <p className="wv-about">{v.about}</p>}
        {(me === v.author_id || admin) && (
          <div className="row" style={{ gap: 8 }}>
            {me === v.author_id && v.kind === "stream" && (v.status === "live" || v.status === "waiting") && <Link className="btn small" href="/watch/live">Open my studio</Link>}
            <button type="button" className="btn small" onClick={remove}>Delete</button>
            {admin && me !== v.author_id && <button type="button" className="btn small" onClick={hide}>Hide (admin)</button>}
          </div>
        )}
        {msg && <small className="muted">{msg}</small>}
      </div>
      <section className="wv-chat" aria-label={live ? "Live chat" : "Comments"}>
        <b>{live ? "Live chat" : `Comments · ${fmtCount(v.comments)}`}</b>
        {me ? (
          <form onSubmit={comment} className="wv-say"><input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={live ? "Say something…" : "Add a comment…"} aria-label="Comment" /><button className="btn primary small" type="submit" disabled={!text.trim()}>Send</button></form>
        ) : <Link className="btn small" href={`/login?next=/watch/${v.id}`}>Sign in to comment</Link>}
        <ul>
          {list.map((c) => (
            <li key={c.id}>
              {c.author && <Avatar className="me-av wv-av sm" alias={c.author.alias} color={c.author.color} url={c.author.avatar_url} />}
              <span><b>{c.author?.alias || "Member"}</b> <small>{ago(c.created_at)}</small><br />{c.body}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
