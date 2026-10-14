"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Art from "@/components/Art";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GROUPS, CHANNELS } from "@/lib/groups";
import { PHOTOS } from "@/lib/site";

type Post = { id: string; channel: string; author_id: string; body: string; content_note: string | null; created_at: string; hidden: boolean };
type Profile = { id: string; alias: string; color: string };

function ago(t: string) {
  const s = Math.max(1, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

export default function Community({ uid, initialGroup, initialChannel }: { uid: string; initialGroup?: string; initialChannel?: string }) {
  const sb = supabaseBrowser();
  const startChannel = (initialChannel && CHANNELS[initialChannel]?.id) || GROUPS.find((g) => g.id === initialGroup)?.channels[0].id || "lounge.intros";
  const [channel, setChannel] = useState(startChannel);
  const [mine, setMine] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [posts, setPosts] = useState<Post[]>([]);
  const [hearts, setHearts] = useState<Record<string, string[]>>({});
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [text, setText] = useState("");
  const [cwOn, setCwOn] = useState(false);
  const [cw, setCw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const ch = CHANNELS[channel];
  const g = ch.group;
  const joined = mine.includes(g.id);

  const loadMembership = useCallback(async () => {
    const { data } = await sb.from("group_members").select("user_id,group_id");
    const c: Record<string, number> = {}; const m: string[] = [];
    for (const r of data || []) { c[r.group_id] = (c[r.group_id] || 0) + 1; if (r.user_id === uid) m.push(r.group_id); }
    setCounts(c); setMine(m);
  }, [uid]);

  const loadPosts = useCallback(async (chan: string) => {
    const { data } = await sb.from("posts").select("*").eq("channel", chan).order("created_at", { ascending: false }).limit(100);
    const list: Post[] = data || [];
    if (channelRef.current !== chan) return;
    setPosts(list);
    const ids = list.map((p) => p.id);
    const authors = Array.from(new Set(list.map((p) => p.author_id)));
    if (ids.length) {
      const { data: h } = await sb.from("hearts").select("post_id,user_id").in("post_id", ids);
      const map: Record<string, string[]> = {};
      for (const r of h || []) (map[r.post_id] ||= []).push(r.user_id);
      setHearts(map);
    } else setHearts({});
    if (authors.length) {
      const { data: pr } = await sb.from("profiles").select("id,alias,color").in("id", authors);
      setProfiles((old) => ({ ...old, ...Object.fromEntries((pr || []).map((p: Profile) => [p.id, p])) }));
    }
  }, []);

  useEffect(() => {
    loadMembership();
    sb.from("profiles").select("is_admin").eq("id", uid).single().then(({ data }) => setIsAdmin(!!data?.is_admin));
    sb.from("practitioners").select("user_id").then(({ data }) => setVerified(Object.fromEntries((data || []).map((r: any) => [r.user_id, true]))));
    sb.from("reports").select("post_id").eq("reporter_id", uid).then(({ data }) => setReported(Object.fromEntries((data || []).map((r: any) => [r.post_id, true]))));
  }, [uid]);

  useEffect(() => {
    loadPosts(channel);
    try { window.history.replaceState(null, "", `/community?c=${channel}`); } catch {}
    const live = sb.channel("feed-" + channel)
      .on("postgres_changes", { event: "*", schema: "public", table: "posts", filter: `channel=eq.${channel}` }, () => loadPosts(channel))
      .on("postgres_changes", { event: "*", schema: "public", table: "hearts" }, () => loadPosts(channel))
      .subscribe();
    return () => { sb.removeChannel(live); };
  }, [channel]);

  async function join() {
    setError("");
    const { error } = await sb.from("group_members").insert({ user_id: uid, group_id: g.id });
    if (error && !String(error.message).includes("duplicate")) setError("Couldn't join the group. Try again.");
    loadMembership();
  }
  async function leave() {
    await sb.from("group_members").delete().eq("user_id", uid).eq("group_id", g.id);
    loadMembership();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (body.length < 2) return;
    setBusy(true); setError("");
    const { error } = await sb.from("posts").insert({ channel, body: body.slice(0, 1500), content_note: cwOn ? (cw.trim() || "Heavy topic").slice(0, 80) : null });
    setBusy(false);
    if (error) { setError("That didn't post. Make sure you've joined this group, then try again."); return; }
    setText(""); setCw(""); setCwOn(false); loadPosts(channel);
  }
  async function toggleHeart(p: Post) {
    const has = (hearts[p.id] || []).includes(uid);
    if (has) await sb.from("hearts").delete().eq("post_id", p.id).eq("user_id", uid);
    else await sb.from("hearts").insert({ post_id: p.id });
    loadPosts(channel);
  }
  async function remove(p: Post) { await sb.from("posts").delete().eq("id", p.id); loadPosts(channel); }
  async function report(p: Post) { await sb.from("reports").insert({ post_id: p.id }); setReported((r) => ({ ...r, [p.id]: true })); }

  const postCounts = useMemo(() => ({ [channel]: posts.length }), [posts, channel]);

  return (
    <div className="community">
      <aside className="glist" aria-label="Groups and channels">
        {GROUPS.map((gr) => (
          <div key={gr.id} className="gblock" data-g={gr.id} aria-current={g.id === gr.id ? "true" : "false"}>
            <button className="ghead" type="button" onClick={() => setChannel(gr.channels[0].id)}>
              <span className="gdot"><svg aria-hidden="true"><use href={`#g-${gr.id}`} /></svg></span>
              <span><b>{gr.name}</b><small>{gr.tag} · {counts[gr.id] || 0} member{counts[gr.id] === 1 ? "" : "s"}</small></span>
              {mine.includes(gr.id) && <span className="joined">Joined</span>}
            </button>
            <div className="chans">
              {gr.channels.map((c) => (
                <button key={c.id} type="button" aria-current={channel === c.id ? "true" : undefined} onClick={() => setChannel(c.id)}>
                  <span><span className="hash">#</span>{c.name}</span><span className="n">{postCounts[c.id] || ""}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <div className="stack" data-g={g.id}>
        <div className="banner">
          <div className="bcopy">
            <div className="eyebrow">{g.tag}</div>
            <h2>{g.name}</h2>
            <p>{g.desc}</p>
            <button className={joined ? "btn on small" : "btn small"} type="button" onClick={joined ? leave : join}>{joined ? "Joined ✓ · Leave" : "Join group"}</button>
          </div>
          <Art kind="group" id={g.id} photo={PHOTOS[g.id]?.src} alt={PHOTOS[g.id]?.alt} />
        </div>
        <div className="chan-title"><h2><span className="hash"># </span>{ch.title}</h2><span className="muted">{ch.prompt}</span></div>
        {error && <div className="notice alert">{error}</div>}

        {joined ? (
          <form className="card stack" onSubmit={submit}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} placeholder={`Message #${ch.name}`} aria-label={`Message ${ch.title}`} />
            <div className="row">
              <label className="row" style={{ gap: 6, cursor: "pointer" }}><input type="checkbox" checked={cwOn} onChange={(e) => setCwOn(e.target.checked)} /> Hide behind a content note</label>
              {cwOn && <input type="text" value={cw} onChange={(e) => setCw(e.target.value)} placeholder="Content note, e.g. meltdown, burnout" style={{ flex: 1, minWidth: 180 }} />}
              <button className="btn g" type="submit" disabled={busy} style={{ marginLeft: "auto" }}>Post</button>
            </div>
          </form>
        ) : (
          <div className="joincta">
            <div><b>Join {g.name} to post here</b><p className="muted" style={{ fontSize: ".9em" }}>You can read every channel. Joining lets you post and shows you as a member.</p></div>
            <button className="btn g" type="button" onClick={join}>Join group</button>
          </div>
        )}

        {!posts.length && <div className="empty">Nothing in #{ch.name} yet. Your post could be the first.</div>}
        {posts.map((p) => {
          const author = profiles[p.author_id];
          const h = hearts[p.id] || [];
          const mineHeart = h.includes(uid);
          const hiddenBody = p.content_note && !revealed[p.id];
          return (
            <article key={p.id} className="card post fade">
              <div className="avatar" aria-hidden="true" style={{ background: author?.color || "#6141D4" }}>{(author?.alias || "M").charAt(0)}</div>
              <div className="post-body">
                <div className="post-head">
                  <b>{author?.alias || "Member"}</b>
                  {verified[p.author_id] && <span className="badge v">Verified practitioner</span>}
                  {p.author_id === uid && <span className="badge gold">You</span>}
                  {p.hidden && <span className="badge gold">Hidden by admin</span>}
                  <span className="muted" style={{ fontSize: ".85em" }}>{ago(p.created_at)}</span>
                </div>
                {hiddenBody ? (
                  <button type="button" className="cw" onClick={() => setRevealed((r) => ({ ...r, [p.id]: true }))}>
                    <b>Content note: </b>{p.content_note}<span className="muted"> · tap to show</span>
                  </button>
                ) : (
                  <p className="post-text">{p.body}</p>
                )}
                <div className="post-actions">
                  <button className="linkbtn" type="button" aria-pressed={mineHeart} onClick={() => toggleHeart(p)}>{mineHeart ? "♥ Supported" : "♡ Support"}{h.length ? ` · ${h.length}` : ""}</button>
                  {(p.author_id === uid || isAdmin) && <button className="linkbtn" type="button" onClick={() => remove(p)}>Delete</button>}
                  {p.author_id !== uid && <button className="linkbtn" type="button" disabled={reported[p.id]} onClick={() => report(p)}>{reported[p.id] ? "Reported" : "Report"}</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
