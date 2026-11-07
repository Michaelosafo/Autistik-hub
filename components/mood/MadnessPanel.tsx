"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import FindPeople from "@/components/FindPeople";
import LogoMark from "@/components/LogoMark";
import TikComposer from "./TikComposer";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";
import { ago } from "@/lib/mood";

type Tab = "following" | "everyone" | "alerts" | "people";
type Note = { id: number; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
type Act = { user_id: string; at: string; kind: string; label: string | null; link: string | null };
const ACT: Record<string, string> = { post: "posted in a group", live: "joined a live", launch: "launched a coin", lock: "locked liquidity", pin: "pinned a coin", scan: "scanned a coin", follow: "followed someone", listed: "listed a coin" };

/**
 * TIK, pinned in your panel and closed until you tap it: Tiks and activity from people you follow,
 * everyone's Tiks, your notifications (likes and replies), finding people, and a box to post how you feel.
 */
/**
 * TIK in your panel, right under your photo: the AUTISTIK logo sits beside the TIK name and opens TIK, with your
 * unread alerts, a box to post how you feel, and the newest Tiks (like and reply right here) for everyone, the
 * people you follow, or your alerts.
 */
export function MadnessLink({ onGo }: { onGo?: () => void }) {
  const [tab, setTab] = useState<"everyone" | "following" | "alerts">("everyone");
  const [k, setK] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [follows, setFollows] = useState<string[] | null>(null);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setMe(user.id);
      const [{ data: f }, { count }] = await Promise.all([
        sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(500),
        sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
      ]);
      setFollows((f || []).map((x: any) => x.followee_id));
      setUnread(count || 0);
    })().catch(() => {});
  }, []);
  const TABS: ["everyone" | "following" | "alerts", string][] = [["everyone", "For you"], ["following", "Following"], ["alerts", unread ? `Alerts ${unread > 9 ? "9+" : unread}` : "Alerts"]];
  return (
    <section className="mp-sec ptik" aria-label="TIK">
      <div className="ptik-head">
        <Link href="/mood" className="ptik-logo" onClick={onGo} aria-label="Open TIK"><LogoMark size={44} title="Open TIK" /></Link>
        <Link href="/mood" className="ptik-t" onClick={onGo}>
          <b>TIK</b>
          <small><i className="ptik-dot" aria-hidden="true" />Live feed{unread > 0 ? ` · ${unread > 9 ? "9+" : unread} new` : ""}</small>
        </Link>
        <Link href="/mood" className="ptik-open" onClick={onGo}>Open</Link>
      </div>
      <div className="ptik-tabs" role="tablist" aria-label="TIK in your panel">
        {TABS.map(([t, l]) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={t === "alerts" && unread ? "hot" : ""} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      {tab !== "alerts" && me && <TikComposer compact onPosted={() => setK((n) => n + 1)} placeholder="How are you feeling? Post a Tik…" />}
      {tab === "everyone" && <Feed me={me} authors={null} refreshKey={k} limit={3} />}
      {tab === "following" && <Following me={me} follows={follows} refreshKey={k} onFind={() => { window.location.href = "/mood"; }} limit={3} />}
      {tab === "alerts" && <Alerts me={me} onRead={() => setUnread(0)} />}
      <div className="ptik-foot">
        <Link href="/mood" onClick={onGo}>All Tiks</Link>
        <Link href="/spaces?host=1" onClick={onGo}>Host a live</Link>
        <Link href="/chats" onClick={onGo}>Chats</Link>
      </div>
    </section>
  );
}

export default function MadnessPanel({ full, side, focus }: { full?: boolean; side?: ReactNode; focus?: ReactNode }) {
  const [open, setOpen] = useState(!!full);
  const [tab, setTab] = useState<Tab>("following");
  const [k, setK] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [follows, setFollows] = useState<string[] | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!full) { try { if (localStorage.getItem("madness-open") === "1") setOpen(true); } catch {} }
    (async () => {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      setMe(user.id);
      const [{ data: f }, { count }] = await Promise.all([
        sb.from("follows").select("followee_id").eq("follower_id", user.id).limit(500),
        sb.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("read_at", null),
      ]);
      setFollows((f || []).map((x: any) => x.followee_id));
      setUnread(count || 0);
    })();
  }, []);
  const toggle = () => { const o = !open; setOpen(o); try { localStorage.setItem("madness-open", o ? "1" : "0"); } catch {} };

  if (full) {
    const NAV: [Tab, string, string, string][] = [
      ["following", "Following", "Posts from people you follow", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 11l2 2 4-4"/>'],
      ["everyone", "Everyone", "The whole TIK feed", '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>'],
      ["alerts", "Alerts", "Replies, follows and likes", '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'],
      ["people", "Find people", "Search and follow members", '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'],
    ];
    const cur = NAV.find((n) => n[0] === tab)!;
    return (
      <section className="tik-pro" aria-label="TIK">
        <aside className="tik-side" aria-label="TIK menu">
          <div className="tik-brand">
            <span className="tik-logo" aria-hidden="true">T</span>
            <span><b>TIK</b><small>LIVE · SOCIAL · AUTISTIK</small></span>
          </div>
          <nav className="tik-nav" role="tablist" aria-orientation="vertical">
            {NAV.map(([t, l, , d]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                <span className="tik-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} /></span>
                <span className="tik-nl">{l}</span>
                {t === "alerts" && unread > 0 && <em className="tik-badge">{unread > 9 ? "9+" : unread}</em>}
              </button>
            ))}
          </nav>
          <Link href="/spaces?host=1" className="tik-host"><i aria-hidden="true" />Host a live</Link>
          <div className="tik-links">
            <Link href="/spaces">Live rooms</Link>
            <Link href="/chats">Chats</Link>
            <Link href="/board">Board</Link>
          </div>
          {side && <div className="tik-live"><div className="tik-cap"><span className="tik-dot" aria-hidden="true" />Live now</div>{side}</div>}
        </aside>
        <div className="tik-main">
          <header className="tik-top">
            <div><h2>{cur[1]}</h2><small>{cur[2]}</small></div>
            <span className="tik-status"><span className="tik-dot" aria-hidden="true" />Live feed</span>
          </header>
          {focus}
          {(tab === "following" || tab === "everyone") && me && <TikComposer onPosted={() => setK((n) => n + 1)} placeholder="How are you feeling? Post a Tik…" />}
          {tab === "following" && <Following me={me} follows={follows} refreshKey={k} onFind={() => setTab("people")} limit={20} />}
          {tab === "everyone" && <Feed me={me} authors={null} refreshKey={k} limit={20} />}
          {tab === "alerts" && <Alerts me={me} onRead={() => setUnread(0)} />}
          {tab === "people" && <FindPeople />}
        </div>
      </section>
    );
  }

  return (
    <section className={"mp-sec mad" + (open ? " open" : "") + (full ? " full" : "")} aria-label="TIK">
      {!full && <button type="button" className="mad-head" onClick={toggle} aria-expanded={open}>
        <span className="mad-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 21s-7-4.6-9.2-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.2 6c-2.2 4.4-9.2 9-9.2 9z" /></svg>
        </span>
        <span className="mad-t"><b>TIK</b><small>Feelings, posts and what your people are doing</small></span>
        {unread > 0 && <em className="mad-badge">{unread > 9 ? "9+" : unread}</em>}
        <i className="mad-chev" aria-hidden="true" />
      </button>}
      {open && (
        <div className="mad-body">
          <div className="mad-tabs" role="tablist">
            {([["following", "Following"], ["everyone", "Everyone"], ["alerts", unread ? `Alerts (${unread})` : "Alerts"], ["people", "Find people"]] as [Tab, string][]).map(([t, l]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
          {(tab === "following" || tab === "everyone") && me && <TikComposer compact={!full} onPosted={() => setK((n) => n + 1)} placeholder="How are you feeling? Post a Tik…" />}
          {tab === "following" && <Following me={me} follows={follows} refreshKey={k} onFind={() => setTab("people")} limit={full ? 20 : 5} />}
          {tab === "everyone" && <Feed me={me} authors={null} refreshKey={k} limit={full ? 20 : 5} />}
          {tab === "alerts" && <Alerts me={me} onRead={() => setUnread(0)} />}
          {tab === "people" && <FindPeople />}
          {!full && <Link href="/mood" className="mad-open">Open TIK</Link>}
        </div>
      )}
    </section>
  );
}

function Feed({ me, authors, refreshKey, limit = 5 }: { me: string | null; authors: string[] | null; refreshKey: number; limit?: number }) {
  const { tiks, setTiks, more, loadMore } = useTiks({ limit, refreshKey, authors });
  if (tiks === null) return <small className="mp-dim">Loading…</small>;
  if (!tiks.length) return <small className="mp-dim">{authors ? "No Tiks from people you follow yet." : "No Tiks yet. Be the first."}</small>;
  return (
    <div className="mad-feed">
      {tiks.map((t) => <TikCard key={t.id} t={t} me={me} compact={limit <= 5} onRemoved={(id) => setTiks((x) => x?.filter((y) => y.id !== id) ?? null)} />)}
      {limit > 5 && more && <button type="button" className="tik-more" onClick={loadMore}>Load more</button>}
    </div>
  );
}

function Following({ me, follows, refreshKey, onFind, limit }: { me: string | null; follows: string[] | null; refreshKey: number; onFind: () => void; limit: number }) {
  const [acts, setActs] = useState<(Act & { alias: string })[] | null>(null);
  useEffect(() => {
    if (!follows?.length) { setActs([]); return; }
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.rpc("member_activity_many", { p_ids: follows.slice(0, 200), p_per: 2, p_total: 8 });
      const rows = ((data || []) as Act[]).filter((a) => a.kind !== "post");
      const ids = [...new Set(rows.map((r) => r.user_id))];
      const { data: p } = ids.length ? await sb.from("profiles").select("id,alias").in("id", ids) : { data: [] as any[] };
      const name = new Map((p || []).map((x: any) => [x.id, x.alias]));
      setActs(rows.map((r) => ({ ...r, alias: name.get(r.user_id) || "Someone" })));
    })().catch(() => setActs([]));
  }, [follows]);
  if (follows === null) return <small className="mp-dim">Loading…</small>;
  if (!follows.length) return (
    <div className="mad-empty">
      <small className="mp-dim">You aren&apos;t following anyone yet. Follow people to see their Tiks and what they&apos;re up to here.</small>
      <button type="button" className="mad-cta" onClick={onFind}>Find people to follow</button>
    </div>
  );
  return (
    <>
      <Feed me={me} authors={me ? [...follows, me] : follows} refreshKey={refreshKey} limit={limit} />
      {!!acts?.length && limit > 3 && (
        <div className="mad-acts">
          <small className="mp-cap">What they&apos;re doing</small>
          {acts.map((a, i) => (
            <Link key={i} href={a.link || `/members/${a.user_id}`} className="mad-act">
              <b>{a.alias}</b> <span>{ACT[a.kind] || a.kind}{a.label ? `: ${a.label}` : ""}</span> <small>{ago(a.at)}</small>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Alerts({ me, onRead }: { me: string | null; onRead: () => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    if (!me) return;
    (async () => {
      const sb = supabaseBrowser();
      const { data } = await sb.from("notifications").select("id,title,body,link,created_at,read_at").eq("user_id", me).order("created_at", { ascending: false }).limit(20);
      setNotes((data || []) as Note[]);
      await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me).is("read_at", null);
      onRead();
    })().catch(() => setNotes([]));
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps
  if (notes === null) return <small className="mp-dim">Loading…</small>;
  if (!notes.length) return <small className="mp-dim">No notifications yet. Likes and replies on your Tiks show here.</small>;
  return (
    <div className="mad-notes">
      {notes.map((n) => (
        <Link key={n.id} href={n.link || "/mood"} className={"mad-note" + (n.read_at ? "" : " new")}>
          <b>{n.title}</b>{n.body && n.body !== n.title.split(" ")[0] && <span>{n.body}</span>}<small>{ago(n.created_at)}</small>
        </Link>
      ))}
    </div>
  );
}
