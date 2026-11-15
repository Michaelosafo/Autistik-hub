"use client";
/**
 * TIK: your own small profile beside the feed (on top on phones). Your picture, name and followers, then your
 * activity at a tap: Posts, Retikles, Comments, Videos, Streams and Reactions you got. Each opens a short list right
 * here; tap a row to open it. Quick buttons to post, go live or upload a video.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/mood";

type Me = { id: string; alias: string; handle: string | null; color: string | null; avatar_url: string | null };
type K = "posts" | "retikles" | "comments" | "videos" | "streams" | "reactions";
type View = K | "followers" | "following" | "activity";
type Row = { id: string; text: string; at: string; href: string; tag?: string; person?: { alias: string; color: string | null; avatar_url: string | null } };

const TABS: [K, string, string][] = [
  ["posts", "📝", "Posts"], ["retikles", "🔁", "Retikles"], ["comments", "💬", "Comments"],
  ["videos", "🎬", "Videos"], ["streams", "🔴", "Streams"], ["reactions", "❤️", "Reactions"],
];
const REMOJI: Record<string, string> = { love: "❤️", haha: "😂", fire: "🔥", "100": "💯", wow: "😮", sad: "😢", pray: "🙏", clap: "👏" };
const cut = (s: string | null | undefined, n = 70) => { const t = (s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t || "(picture)"; };

export default function MyTikPanel() {
  const [me, setMe] = useState<Me | null>(null);
  const [n, setN] = useState<Record<K, number> & { followers: number; following: number }>({ posts: 0, retikles: 0, comments: 0, videos: 0, streams: 0, reactions: 0, followers: 0, following: 0 });
  const [tab, setTab] = useState<View>("activity");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const { data: p } = await sb.from("profiles").select("id,alias,handle,color,avatar_url").eq("id", user.id).maybeSingle();
      setMe((p as Me) || { id: user.id, alias: "Me", handle: null, color: null, avatar_url: null });
      const c = (q: any) => q.then((r: any) => r.count || 0, () => 0);
      const head = { count: "exact" as const, head: true };
      const mineIds = ((await sb.from("tiks").select("id").eq("author_id", user.id).eq("hidden", false).limit(500)).data || []).map((r: any) => r.id);
      const [posts, retikles, comments, videos, streams, followers, following, reactions] = await Promise.all([
        c(sb.from("tiks").select("id", head).eq("author_id", user.id).eq("hidden", false).is("reply_to", null).is("tickle_of", null)),
        c(sb.from("tiks").select("id", head).eq("author_id", user.id).eq("hidden", false).not("tickle_of", "is", null)),
        c(sb.from("tiks").select("id", head).eq("author_id", user.id).eq("hidden", false).not("reply_to", "is", null)),
        c(sb.from("videos").select("id", head).eq("author_id", user.id).eq("hidden", false).neq("kind", "stream")),
        c(sb.from("videos").select("id", head).eq("author_id", user.id).eq("hidden", false).eq("kind", "stream")),
        c(sb.from("follows").select("follower_id", head).eq("followee_id", user.id)),
        c(sb.from("follows").select("followee_id", head).eq("follower_id", user.id)),
        mineIds.length ? c(sb.from("tik_likes").select("tik_id", head).in("tik_id", mineIds)) : Promise.resolve(0),
      ]);
      setN({ posts, retikles, comments, videos, streams, reactions, followers, following });
    })();
  }, []);

  useEffect(() => {
    if (!me) return;
    setRows(null);
    const sb = supabaseBrowser();
    (async () => {
      let out: Row[] = [];
      if (tab === "followers" || tab === "following") {
        const mineCol = tab === "followers" ? "followee_id" : "follower_id", otherCol = tab === "followers" ? "follower_id" : "followee_id";
        const { data } = await sb.from("follows").select(`${otherCol},created_at`).eq(mineCol, me.id).order("created_at", { ascending: false }).limit(50);
        const list = (data || []) as any[];
        const { data: ps } = list.length ? await sb.from("profiles").select("id,alias,handle,color,avatar_url").in("id", list.map((r) => r[otherCol])) : { data: [] };
        const by = new Map(((ps || []) as any[]).map((p) => [p.id, p]));
        out = list.map((r) => { const p = by.get(r[otherCol]) || {}; return { id: r[otherCol], text: p.alias || "Member", tag: p.handle ? `@${p.handle}` : undefined, at: r.created_at, href: `/members/${r[otherCol]}`, person: { alias: p.alias || "Member", color: p.color ?? null, avatar_url: p.avatar_url ?? null } }; });
      } else if (tab === "activity") {
        // Everything you did lately, newest first: posts, comments, retikles, videos, and reactions you got.
        const [{ data: t }, { data: v }] = await Promise.all([
          sb.from("tiks").select("id,body,reply_to,tickle_of,created_at").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(10),
          sb.from("videos").select("id,title,kind,status,created_at").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(4),
        ]);
        const { data: mine } = await sb.from("tiks").select("id,body").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(100);
        const body = new Map(((mine || []) as any[]).map((x) => [x.id, x.body]));
        const { data: rx } = body.size ? await sb.from("tik_likes").select("tik_id,user_id,kind,created_at").in("tik_id", [...body.keys()]).neq("user_id", me.id).order("created_at", { ascending: false }).limit(6) : { data: [] };
        const { data: ps } = (rx || []).length ? await sb.from("profiles").select("id,alias").in("id", (rx as any[]).map((r) => r.user_id)) : { data: [] };
        const who = new Map(((ps || []) as any[]).map((p) => [p.id, p.alias]));
        out = [
          ...((t || []) as any[]).map((x) => ({ id: "t" + x.id, at: x.created_at, href: `/mood?tik=${x.tickle_of || x.reply_to || x.id}`, tag: x.tickle_of ? "🔁" : x.reply_to ? "💬" : "📝", text: x.tickle_of ? "You retikled a post" : x.reply_to ? `You commented: ${cut(x.body, 50)}` : cut(x.body) })),
          ...((v || []) as any[]).map((x) => ({ id: "v" + x.id, at: x.created_at, href: `/watch/${x.id}`, tag: x.kind === "stream" ? (x.status === "live" ? "LIVE" : "🔴") : "🎬", text: x.kind === "stream" ? `You streamed: ${cut(x.title, 50)}` : `You posted a video: ${cut(x.title, 50)}` })),
          ...((rx || []) as any[]).map((r) => ({ id: "r" + r.tik_id + r.user_id, at: r.created_at, href: `/mood?tik=${r.tik_id}`, tag: REMOJI[r.kind] || "❤️", text: `${who.get(r.user_id) || "Member"} reacted to “${cut(body.get(r.tik_id), 40)}”` })),
        ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 10);
      } else if (tab === "videos" || tab === "streams") {
        let q = sb.from("videos").select("id,title,kind,status,created_at").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(8);
        q = tab === "streams" ? q.eq("kind", "stream") : q.neq("kind", "stream");
        const { data } = await q;
        out = ((data || []) as any[]).map((v) => ({ id: v.id, text: cut(v.title, 60), at: v.created_at, href: `/watch/${v.id}`, tag: v.status === "live" ? "LIVE" : undefined }));
      } else if (tab === "reactions") {
        const { data: mine } = await sb.from("tiks").select("id,body").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(200);
        const body = new Map(((mine || []) as any[]).map((t) => [t.id, t.body]));
        const { data } = body.size ? await sb.from("tik_likes").select("tik_id,user_id,kind,created_at").in("tik_id", [...body.keys()]).order("created_at", { ascending: false }).limit(8) : { data: [] };
        const list = (data || []) as any[];
        const { data: ps } = list.length ? await sb.from("profiles").select("id,alias").in("id", list.map((r) => r.user_id)) : { data: [] };
        const who = new Map(((ps || []) as any[]).map((p) => [p.id, p.alias]));
        out = list.map((r) => ({ id: r.tik_id + r.user_id, text: `${who.get(r.user_id) || "Member"} reacted to “${cut(body.get(r.tik_id), 40)}”`, at: r.created_at, href: `/mood?tik=${r.tik_id}`, tag: REMOJI[r.kind] || "❤️" }));
      } else {
        let q = sb.from("tiks").select("id,body,reply_to,tickle_of,created_at").eq("author_id", me.id).eq("hidden", false).order("created_at", { ascending: false }).limit(8);
        q = tab === "posts" ? q.is("reply_to", null).is("tickle_of", null) : tab === "retikles" ? q.not("tickle_of", "is", null) : q.not("reply_to", "is", null);
        const { data } = await q;
        out = ((data || []) as any[]).map((t) => ({ id: t.id, text: tab === "retikles" ? "Retikled a post" : cut(t.body), at: t.created_at, href: `/mood?tik=${t.tickle_of || t.reply_to || t.id}` }));
      }
      setRows(out);
    })();
  }, [tab, me]);

  if (!me) return null;
  return (
    <aside className="mytik" aria-label="Your TIK">
      <div className="mytik-me">
        <Link href={`/members/${me.id}`} className="mytik-av" aria-label="Your profile"><Avatar className="me-av" alias={me.alias} color={me.color} url={me.avatar_url} /></Link>
        <div className="mytik-id">
          <Link href={`/members/${me.id}`}><b>{me.alias}</b></Link>
          {me.handle && <small>@{me.handle}</small>}
          <small className="mytik-f">
            <button type="button" className={tab === "followers" ? "on" : ""} onClick={() => setTab(tab === "followers" ? "activity" : "followers")}><b>{n.followers}</b> followers</button> ·{" "}
            <button type="button" className={tab === "following" ? "on" : ""} onClick={() => setTab(tab === "following" ? "activity" : "following")}><b>{n.following}</b> following</button>
          </small>
        </div>
        <div className="mytik-go">
          <a href="#tik-post" className="mytik-btn main">✏️ Post</a>
          <Link href="/spaces?host=1" className="mytik-btn">🎙️ Go live</Link>
          <Link href="/mood?tab=videos" className="mytik-btn">🎬 Video</Link>
        </div>
      </div>
      <div className="mytik-tabs" role="tablist" aria-label="Your activity">
        {TABS.map(([k, e, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(tab === k ? "activity" : k)}>
            <i aria-hidden="true">{e}</i><b>{n[k]}</b><small>{l}</small>
          </button>
        ))}
      </div>
      {(
        <div className="mytik-list" role="tabpanel">
          <div className="mytik-lh"><b>{tab === "activity" ? "⚡ Your recent activity" : tab === "followers" ? "👥 Your followers" : tab === "following" ? "➕ You follow" : TABS.find(([k]) => k === tab)?.slice(1).join(" ")}</b>{tab !== "activity" && <button type="button" onClick={() => setTab("activity")}>✕</button>}</div>
          {rows === null ? <small className="muted">Loading…</small> : !rows.length ? <small className="muted">{tab === "activity" ? "No activity yet: post your first Tik!" : "Nothing here yet."}</small> : (
            <ul>{rows.map((r) => (
              <li key={r.id}><Link href={r.href}>{r.person ? <Avatar className="me-av" alias={r.person.alias} color={r.person.color} url={r.person.avatar_url} /> : r.tag && <em className={r.tag === "LIVE" ? "live" : ""}>{r.tag}</em>}<span>{r.text}{r.person && r.tag && <small> {r.tag}</small>}</span><small>{r.person ? "" : ago(r.at)}</small></Link></li>
            ))}</ul>
          )}
          <Link href={`/members/${me.id}`} className="mytik-all">See everything on your profile →</Link>
        </div>
      )}
    </aside>
  );
}
