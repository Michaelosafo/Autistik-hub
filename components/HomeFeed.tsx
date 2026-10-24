"use client";
/**
 * Home in the three-column layout: a timeline like X's, with For you / Following tabs, a box to post to the
 * Spectrum Lounge, and new token launches mixed in. The old front page lives on at /about.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GROUPS } from "@/lib/groups";
import { supabaseBrowser } from "@/lib/supabase/client";

type Item =
  | { kind: "post"; id: string; at: string; body: string; channel: string; note: string | null; author: { id: string; alias: string; color: string } | null }
  | { kind: "launch"; id: string; at: string; chain: string; chainName: string; token: string; name: string; symbol: string };

const LOUNGE = GROUPS.find((g) => g.id === "lounge")!;
const channelTitle = (id: string) => LOUNGE.channels.find((c) => c.id === id)?.title ?? "Lounge";
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export default function HomeFeed({ me }: { me: { alias: string; color: string } | null }) {
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [items, setItems] = useState<Item[] | null>(null);
  const [followsNobody, setFollowsNobody] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/feed?tab=${tab}`).then((r) => r.json()).then((d) => { setItems(d.items || []); setFollowsNobody(!!d.followsNobody); }).catch(() => setItems([]));
  }, [tab]);
  useEffect(() => { setItems(null); load(); }, [load]);

  return (
    <div className="hf">
      <div className="hf-tabs" role="tablist" aria-label="Timeline">
        <button type="button" role="tab" aria-selected={tab === "foryou"} onClick={() => setTab("foryou")}>For you</button>
        {me && <button type="button" role="tab" aria-selected={tab === "following"} onClick={() => setTab("following")}>Following</button>}
      </div>

      {me ? <Composer me={me} onPosted={load} /> : (
        <div className="hf-guest">
          <b>Welcome to AUTISTIK Hub</b>
          <p className="muted">A calm place for autistic adults and the people around them, with simple, safe crypto tools. <Link href="/about">What is AUTISTIK?</Link></p>
          <div className="hf-guest-r"><Link className="btn primary" href="/login?mode=join&next=/">Join free</Link><Link className="btn" href="/login?next=/">Sign in</Link></div>
        </div>
      )}

      {items === null ? <p className="muted hf-empty">Loading…</p>
        : items.length === 0 ? (
          <p className="muted hf-empty">
            {tab === "following" ? (followsNobody ? <>You don&apos;t follow anyone yet. <Link href="/members?tab=find">Find people to follow</Link>.</> : "No posts yet from the people you follow.")
              : me ? "Nothing here yet. Write the first post in the Lounge." : <><Link href="/login?next=/">Sign in</Link> to see what members are sharing.</>}
          </p>
        ) : (
          <ol className="hf-list">
            {items.map((it) => <li key={it.kind + it.id}>{it.kind === "post" ? <Post p={it} /> : <Launch l={it} />}</li>)}
          </ol>
        )}
      {!me && items && items.length > 0 && <p className="muted hf-empty"><Link href="/login?next=/">Sign in</Link> to see members&apos; posts too.</p>}
    </div>
  );
}

function Avatar({ alias, color }: { alias: string; color: string }) {
  return <span className="me-av hf-av" style={{ background: color }} aria-hidden="true">{(alias.trim()[0] || "M").toUpperCase()}</span>;
}

function Post({ p }: { p: Extract<Item, { kind: "post" }> }) {
  const [show, setShow] = useState(!p.note);
  const a = p.author;
  return (
    <article className="hf-item">
      {a ? <Link href={`/members/${a.id}`} aria-label={a.alias}><Avatar alias={a.alias} color={a.color} /></Link> : <Avatar alias="?" color="#7B55E0" />}
      <div className="hf-body">
        <div className="hf-meta">
          {a ? <Link href={`/members/${a.id}`}><b>{a.alias}</b></Link> : <b>Member</b>}
          <span className="muted">· <Link href={`/community?c=${encodeURIComponent(p.channel)}`}>{channelTitle(p.channel)}</Link> · {ago(p.at)}</span>
        </div>
        {show ? <p className="hf-text">{p.body}</p> : (
          <button type="button" className="hf-note" onClick={() => setShow(true)}>⚠️ {p.note}: tap to read</button>
        )}
      </div>
    </article>
  );
}

function Launch({ l }: { l: Extract<Item, { kind: "launch" }> }) {
  return (
    <article className="hf-item">
      <span className="hf-av hf-rocket" aria-hidden="true">🚀</span>
      <div className="hf-body">
        <div className="hf-meta"><b>New launch</b><span className="muted">· {l.chainName} · {ago(l.at)}</span></div>
        <Link className="hf-launch" href={`/launchpad/${l.chain}/${l.token}`}>
          <b>{l.name} <span className="muted">${l.symbol}</span></b>
          <small className="mono">{l.token.slice(0, 6)}…{l.token.slice(-6)}</small>
          <span>View token →</span>
        </Link>
      </div>
    </article>
  );
}

/** "What's happening?": posts straight to a Spectrum Lounge channel (joining the Lounge first if needed). */
function Composer({ me, onPosted }: { me: { alias: string; color: string }; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [channel, setChannel] = useState(LOUNGE.channels[1]?.id ?? LOUNGE.channels[0].id);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function post(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (body.length < 2) return;
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (user) await sb.from("group_members").upsert({ user_id: user.id, group_id: "lounge" }, { onConflict: "user_id,group_id", ignoreDuplicates: true });
    const { error } = await sb.from("posts").insert({ channel, body: body.slice(0, 1500) });
    setBusy(false);
    if (error) { setMsg("That didn't post. Confirm you're 18+ on your profile, then try again."); return; }
    setText(""); setMsg("Posted to the Lounge."); onPosted();
    setTimeout(() => setMsg(""), 3000);
  }
  return (
    <form className="hf-compose" onSubmit={post}>
      <Avatar alias={me.alias} color={me.color} />
      <div className="hf-compose-r">
        <textarea id="hf-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="What's happening?" maxLength={1500} rows={2} aria-label="Write a post" />
        <div className="hf-compose-bar">
          <select id="hf-channel" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Post to">
            {LOUNGE.channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          {msg && <small className="muted">{msg}</small>}
          <button type="submit" className="btn primary" disabled={busy || text.trim().length < 2}>{busy ? "Posting…" : "Post"}</button>
        </div>
      </div>
    </form>
  );
}
