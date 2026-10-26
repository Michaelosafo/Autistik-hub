"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import FindPeople from "@/components/FindPeople";
import TikComposer from "./TikComposer";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";
import { ago } from "@/lib/mood";

type Tab = "following" | "everyone" | "alerts" | "people";
type Note = { id: number; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
type Act = { user_id: string; at: string; kind: string; label: string | null; link: string | null };
const ACT: Record<string, string> = { post: "posted in a group", live: "joined a live", launch: "launched a coin", lock: "locked liquidity", pin: "pinned a coin", scan: "scanned a coin", follow: "followed someone", listed: "listed a coin" };

/**
 * Autistik Madness, pinned in your panel and closed until you tap it: Tiks and activity from people you follow,
 * everyone's Tiks, your notifications (likes and replies), finding people, and a box to post how you feel.
 */
export default function MadnessPanel() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("following");
  const [k, setK] = useState(0);
  const [me, setMe] = useState<string | null>(null);
  const [follows, setFollows] = useState<string[] | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    try { if (localStorage.getItem("madness-open") === "1") setOpen(true); } catch {}
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

  return (
    <section className={"mp-sec mad" + (open ? " open" : "")} aria-label="Autistik Madness">
      <button type="button" className="mad-head" onClick={toggle} aria-expanded={open}>
        <span className="mad-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 21s-7-4.6-9.2-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.2 6c-2.2 4.4-9.2 9-9.2 9z" /></svg>
        </span>
        <span className="mad-t"><b>Autistik Madness</b><small>Feelings, posts and what your people are doing</small></span>
        {unread > 0 && <em className="mad-badge">{unread > 9 ? "9+" : unread}</em>}
        <i className="mad-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="mad-body">
          <div className="mad-tabs" role="tablist">
            {([["following", "Following"], ["everyone", "Everyone"], ["alerts", unread ? `Alerts (${unread})` : "Alerts"], ["people", "Find people"]] as [Tab, string][]).map(([t, l]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>
          {(tab === "following" || tab === "everyone") && me && <TikComposer compact onPosted={() => setK((n) => n + 1)} placeholder="How are you feeling? Post a Tik…" />}
          {tab === "following" && <Following me={me} follows={follows} refreshKey={k} onFind={() => setTab("people")} />}
          {tab === "everyone" && <Feed me={me} authors={null} refreshKey={k} />}
          {tab === "alerts" && <Alerts me={me} onRead={() => setUnread(0)} />}
          {tab === "people" && <FindPeople />}
          <Link href="/mood" className="mad-open">Open Autistik Madness</Link>
        </div>
      )}
    </section>
  );
}

function Feed({ me, authors, refreshKey }: { me: string | null; authors: string[] | null; refreshKey: number }) {
  const { tiks, setTiks } = useTiks({ limit: 5, refreshKey, authors });
  if (tiks === null) return <small className="mp-dim">Loading…</small>;
  if (!tiks.length) return <small className="mp-dim">{authors ? "No Tiks from people you follow yet." : "No Tiks yet. Be the first."}</small>;
  return <div className="mad-feed">{tiks.map((t) => <TikCard key={t.id} t={t} me={me} compact onRemoved={(id) => setTiks((x) => x?.filter((y) => y.id !== id) ?? null)} />)}</div>;
}

function Following({ me, follows, refreshKey, onFind }: { me: string | null; follows: string[] | null; refreshKey: number; onFind: () => void }) {
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
      <Feed me={me} authors={me ? [...follows, me] : follows} refreshKey={refreshKey} />
      {!!acts?.length && (
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
