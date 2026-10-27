"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Face, Name, PERSON, type Person } from "./names";

type Chat = { id: string; kind: "dm" | "group"; name: string | null; about: string | null; is_public: boolean; is_default: boolean; last_at: string; last_text: string | null };
type Row = { chat: Chat; role: string; last_read_at: string; other?: Person | null };
type Msg = { id: number; chat_id: string; user_id: string; body: string | null; image_url: string | null; created_at: string; deleted: boolean };

const time = (iso: string) => {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/**
 * Chats, like WhatsApp: one-to-one chats with people you follow (or who follow you), groups anyone can make, and the
 * AUTISTIK group for every member. Messages arrive live. Names show in gold (team), green (verified) or black.
 */
export default function ChatApp({ me, open: openFirst }: { me: string; open?: string }) {
  const sb = useMemo(() => supabaseBrowser(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [active, setActive] = useState<string | null>(openFirst ?? null);
  const [sheet, setSheet] = useState<null | "new" | "group" | "find">(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    // Everyone is in the AUTISTIK group.
    const { data: def } = await sb.from("chats").select("id").eq("is_default", true).maybeSingle();
    if (def) await sb.rpc("join_group", { p_chat: def.id });
    const { data } = await sb.from("chat_members").select("role,last_read_at,chat:chats(id,kind,name,about,is_public,is_default,last_at,last_text)").eq("user_id", me);
    const list = ((data || []) as any[]).filter((r) => r.chat) as Row[];
    const dms = list.filter((r) => r.chat.kind === "dm").map((r) => r.chat.id);
    if (dms.length) {
      const { data: others } = await sb.from("chat_members").select(`chat_id,profile:profiles(${PERSON})`).in("chat_id", dms).neq("user_id", me);
      for (const o of (others || []) as any[]) { const r = list.find((x) => x.chat.id === o.chat_id); if (r) r.other = o.profile; }
    }
    list.sort((a, b) => Number(b.chat.is_default) - Number(a.chat.is_default) || Date.parse(b.chat.last_at) - Date.parse(a.chat.last_at));
    setRows(list);
  }, [sb, me]);
  useEffect(() => { load(); }, [load]);

  // Any new message in any of my chats: refresh the list (order, previews, unread dots).
  useEffect(() => {
    const ch = sb.channel(`chat-list-${me}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => load()).subscribe();
    return () => { sb.removeChannel(ch); };
  }, [sb, me, load]);

  const title = (r: Row) => (r.chat.kind === "dm" ? r.other?.alias ?? "Chat" : r.chat.name ?? "Group");
  const shown = (rows || []).filter((r) => !q || title(r).toLowerCase().includes(q.toLowerCase()));
  const cur = rows?.find((r) => r.chat.id === active) ?? null;

  return (
    <div className={`ch-app${active ? " has-active" : ""}`}>
      <aside className="ch-list" aria-label="Your chats">
        <div className="ch-list-top">
          <b>Chats</b>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="ch-ic" onClick={() => setSheet("find")} title="Find groups" aria-label="Find groups">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
            </button>
            <button type="button" className="ch-new" onClick={() => setSheet("new")}>+ New</button>
          </div>
        </div>
        <input className="ch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        {!rows ? <p className="muted ch-empty">Loading…</p> : !shown.length ? <p className="muted ch-empty">No chats yet. Tap + New to message someone you follow or make a group.</p> : (
          <ul>
            {shown.map((r) => {
              const unread = Date.parse(r.chat.last_at) > Date.parse(r.last_read_at) + 1000 && r.chat.last_text;
              return (
                <li key={r.chat.id}>
                  <button type="button" className={`ch-row${active === r.chat.id ? " on" : ""}`} onClick={() => setActive(r.chat.id)}>
                    {r.chat.kind === "dm" ? <Face p={r.other} size={46} /> : <Face group={r.chat.is_default ? "AU" : r.chat.name} size={46} />}
                    <span className="ch-row-t">
                      <span className="ch-row-h">
                        {r.chat.kind === "dm" ? <Name p={r.other} /> : <span className={`ch-name${r.chat.is_default ? " team" : ""}`}>{r.chat.name}{r.chat.is_default && <i className="ch-tick team">✓</i>}</span>}
                        <small>{time(r.chat.last_at)}</small>
                      </span>
                      <span className="ch-row-p">{r.chat.last_text || (r.chat.kind === "group" ? r.chat.about || "Say hi 👋" : "Say hi 👋")}</span>
                    </span>
                    {unread && <em className="ch-dot" aria-label="New messages" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="ch-main">
        {cur ? <Conversation key={cur.chat.id} sb={sb} me={me} row={cur} onBack={() => setActive(null)} onChanged={load} /> : (
          <div className="ch-blank">
            <b>AUTISTIK Chats</b>
            <p>Message people you follow, make a group, or say hi in the AUTISTIK group.</p>
            <button type="button" className="btn primary" onClick={() => setSheet("new")}>Start a chat</button>
          </div>
        )}
      </section>

      {sheet && <Sheet sb={sb} me={me} mode={sheet} setMode={setSheet} onOpen={(id) => { setSheet(null); load().then(() => setActive(id)); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- one conversation

function Conversation({ sb, me, row, onBack, onChanged }: { sb: any; me: string; row: Row; onBack: () => void; onChanged: () => void }) {
  const chat = row.chat;
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [members, setMembers] = useState<number>(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const need = useCallback(async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !people[id]);
    if (!missing.length) return;
    const { data } = await sb.from("profiles").select(PERSON).in("id", missing);
    setPeople((p) => ({ ...p, ...Object.fromEntries(((data || []) as Person[]).map((x) => [x.id, x])) }));
  }, [sb, people]);

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("chat_messages").select("*").eq("chat_id", chat.id).order("id", { ascending: false }).limit(80);
      const list = ((data || []) as Msg[]).reverse();
      setMsgs(list);
      need(list.map((m) => m.user_id));
      const { count } = await sb.from("chat_members").select("user_id", { count: "exact", head: true }).eq("chat_id", chat.id);
      setMembers(count || 0);
      await sb.from("chat_members").update({ last_read_at: new Date().toISOString() }).eq("chat_id", chat.id).eq("user_id", me);
    })();
    const ch = sb.channel(`chat-${chat.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chat.id}` }, (p: any) => {
      const m = p.new as Msg;
      setMsgs((cur) => (cur && !cur.some((x) => x.id === m.id) ? [...cur, m] : cur));
      need([m.user_id]);
      sb.from("chat_members").update({ last_read_at: new Date().toISOString() }).eq("chat_id", chat.id).eq("user_id", me).then(() => {});
    }).subscribe();
    return () => { sb.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  async function send(body: string | null, image: string | null) {
    setBusy(true); setErr("");
    const { data, error } = await sb.from("chat_messages").insert({ chat_id: chat.id, body, image_url: image }).select("*").single();
    setBusy(false);
    if (error) { setErr(/Slow down/.test(error.message) ? "Slow down a little: too many messages in a minute." : "Couldn't send. Try again."); return false; }
    setMsgs((cur) => (cur && !cur.some((x) => x.id === data.id) ? [...cur, data] : cur));
    onChanged();
    return true;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    if (await send(t.slice(0, 2000), null)) setText("");
  }
  async function photo(f: File | undefined) {
    if (!f) return;
    if (f.size > 3_000_000) { setErr("That picture is too big (3 MB max)."); return; }
    setBusy(true);
    const path = `${me}/${Date.now()}-${f.name.replace(/[^A-Za-z0-9.]/g, "").slice(-30) || "photo.jpg"}`;
    const { error } = await sb.storage.from("chat-images").upload(path, f, { contentType: f.type });
    setBusy(false);
    if (error) { setErr("Couldn't upload that picture."); return; }
    await send(null, sb.storage.from("chat-images").getPublicUrl(path).data.publicUrl);
  }
  async function leave() {
    if (chat.is_default) return;
    await sb.from("chat_members").delete().eq("chat_id", chat.id).eq("user_id", me);
    onBack(); onChanged();
  }
  async function unsend(m: Msg) {
    await sb.from("chat_messages").update({ deleted: true }).eq("id", m.id);
    setMsgs((cur) => cur?.map((x) => (x.id === m.id ? { ...x, deleted: true } : x)) ?? cur);
  }

  const head = chat.kind === "dm" ? row.other : null;
  let lastDay = "";
  return (
    <div className="ch-conv">
      <header className="ch-head">
        <button type="button" className="ch-back" onClick={onBack} aria-label="Back to chats">‹</button>
        {head ? <Face p={head} size={38} /> : <Face group={chat.is_default ? "AU" : chat.name} size={38} />}
        <button type="button" className="ch-head-t" onClick={() => setInfo(!info)}>
          {head ? <Name p={head} /> : <span className={`ch-name${chat.is_default ? " team" : ""}`}>{chat.name}{chat.is_default && <i className="ch-tick team">✓</i>}</span>}
          <small>{head ? (head.handle ? `@${head.handle}` : "Chat") : `${members} member${members === 1 ? "" : "s"}${chat.is_public ? " · public group" : " · private group"}`}</small>
        </button>
        {head && <Link className="ch-ic" href={`/members/${head.id}`} title="Profile" aria-label="Open profile">👤</Link>}
      </header>
      {info && (
        <div className="ch-info">
          {chat.about && <p>{chat.about}</p>}
          {chat.kind === "group" && <GroupPeople sb={sb} chat={chat} me={me} role={row.role} onChanged={() => setMembers((n) => n)} />}
          {chat.kind === "group" && !chat.is_default && <button type="button" className="btn small" onClick={leave}>Leave group</button>}
        </div>
      )}
      <div className="ch-msgs" aria-live="polite">
        {!msgs ? <p className="muted ch-empty">Loading…</p> : !msgs.length ? <p className="muted ch-empty">No messages yet. Say hi 👋</p> : msgs.map((m, i) => {
          const mine = m.user_id === me;
          const day = new Date(m.created_at).toDateString();
          const showDay = day !== lastDay; lastDay = day;
          const prev = msgs[i - 1];
          const showName = chat.kind === "group" && !mine && (!prev || prev.user_id !== m.user_id || showDay);
          return (
            <div key={m.id}>
              {showDay && <div className="ch-day"><span>{new Date(m.created_at).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</span></div>}
              <div className={`ch-msg${mine ? " me" : ""}`}>
                <div className="ch-bubble">
                  {showName && <Link href={`/members/${m.user_id}`} className="ch-from"><Name p={people[m.user_id]} small /></Link>}
                  {m.deleted ? <i className="muted">Message removed</i> : <>
                    {m.image_url && <a href={m.image_url} target="_blank" rel="noopener noreferrer"><img src={m.image_url} alt="Photo" className="ch-img" /></a>}
                    {m.body && <span className="ch-text">{m.body}</span>}
                  </>}
                  <small className="ch-time">{time(m.created_at)}{mine && !m.deleted && <button type="button" className="ch-unsend" onClick={() => unsend(m)} title="Remove for everyone">✕</button>}</small>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      {err && <p className="ch-err" role="alert">{err}</p>}
      <form className="ch-compose" onSubmit={submit}>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className="ch-ic" onClick={() => file.current?.click()} disabled={busy} aria-label="Send a photo">📷</button>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(e as any); } }} placeholder="Message" rows={1} maxLength={2000} aria-label="Message" />
        <button type="submit" className="ch-send" disabled={busy || !text.trim()} aria-label="Send">➤</button>
      </form>
    </div>
  );
}

function GroupPeople({ sb, chat, me, role }: { sb: any; chat: Chat; me: string; role: string; onChanged: () => void }) {
  const [list, setList] = useState<{ role: string; p: Person }[]>([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => {
    const { data } = await sb.from("chat_members").select(`role,p:profiles(${PERSON})`).eq("chat_id", chat.id).limit(chat.is_default ? 60 : 300);
    setList(((data || []) as any[]).filter((r) => r.p));
  }, [sb, chat.id, chat.is_default]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <small className="muted">Members{chat.is_default ? " (latest)" : ""}</small>
      <div className="ch-people">{list.map(({ role: r, p }) => <span key={p.id}><Face p={p} size={24} /> <Name p={p} small />{r !== "member" && <em>{r}</em>}</span>)}</div>
      {(role === "owner" || role === "admin") && !chat.is_default && (adding
        ? <PickPeople sb={sb} me={me} cta="Add to group" onPick={async (ids) => { await sb.rpc("add_to_group", { p_chat: chat.id, p_members: ids }); setAdding(false); load(); }} />
        : <button type="button" className="btn small" onClick={() => setAdding(true)}>+ Add people you follow</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- new chat / new group / find groups

function PickPeople({ sb, me, cta, single, onPick }: { sb: any; me: string; cta: string; single?: boolean; onPick: (ids: string[]) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    (async () => {
      const [{ data: a }, { data: b }] = await Promise.all([
        sb.from("follows").select("followee_id").eq("follower_id", me).limit(500),
        sb.from("follows").select("follower_id").eq("followee_id", me).limit(500),
      ]);
      const ids = [...new Set([...(a || []).map((x: any) => x.followee_id), ...(single ? (b || []).map((x: any) => x.follower_id) : [])])].filter((x) => x !== me);
      if (!ids.length) { setPeople([]); return; }
      const { data } = await sb.from("profiles").select(PERSON).in("id", ids);
      setPeople(((data || []) as Person[]).sort((x, y) => x.alias.localeCompare(y.alias)));
    })();
  }, [sb, me, single]);
  const shown = (people || []).filter((p) => !q || p.alias.toLowerCase().includes(q.toLowerCase()) || (p.handle || "").toLowerCase().includes(q.toLowerCase()));
  if (!people) return <p className="muted">Loading your people…</p>;
  if (!people.length) return <p className="muted">Follow people first (Find people in your panel), then you can chat with them here.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="ch-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
      <ul className="ch-pick">
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" className={sel.includes(p.id) ? "on" : ""} onClick={() => single ? onPick([p.id]) : setSel((s) => s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id])}>
              <Face p={p} size={36} /><span className="grow"><Name p={p} />{p.handle && <small>@{p.handle}</small>}</span>{!single && <i>{sel.includes(p.id) ? "✓" : ""}</i>}
            </button>
          </li>
        ))}
      </ul>
      {!single && <button type="button" className="btn primary" disabled={!sel.length} onClick={() => onPick(sel)}>{cta}{sel.length ? ` (${sel.length})` : ""}</button>}
    </div>
  );
}

function Sheet({ sb, me, mode, setMode, onOpen }: { sb: any; me: string; mode: "new" | "group" | "find"; setMode: (m: null | "new" | "group" | "find") => void; onOpen: (id: string) => void }) {
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [pub, setPub] = useState(true);
  const [err, setErr] = useState("");
  const [groups, setGroups] = useState<Chat[] | null>(null);
  useEffect(() => {
    if (mode !== "find") return;
    sb.from("chats").select("id,kind,name,about,is_public,is_default,last_at,last_text").eq("kind", "group").eq("is_public", true).order("last_at", { ascending: false }).limit(50).then(({ data }: any) => setGroups(data || []));
  }, [sb, mode]);

  async function dm(ids: string[]) {
    const { data, error } = await sb.rpc("start_dm", { p_other: ids[0] });
    if (error) { setErr(error.message); return; }
    onOpen(data);
  }
  async function makeGroup(ids: string[]) {
    if (!name.trim()) { setErr("Give the group a name."); return; }
    const { data, error } = await sb.rpc("create_group", { p_name: name.trim(), p_about: about.trim(), p_public: pub, p_members: ids });
    if (error) { setErr(error.message); return; }
    onOpen(data);
  }
  async function join(id: string) {
    const { error } = await sb.rpc("join_group", { p_chat: id });
    if (error) { setErr(error.message); return; }
    onOpen(id);
  }
  return (
    <div className="ch-sheet" role="dialog" aria-modal="true" aria-label="New chat" onClick={(e) => { if (e.target === e.currentTarget) setMode(null); }}>
      <div className="ch-sheet-box">
        <div className="ch-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "new"} onClick={() => setMode("new")}>Message</button>
          <button type="button" role="tab" aria-selected={mode === "group"} onClick={() => setMode("group")}>New group</button>
          <button type="button" role="tab" aria-selected={mode === "find"} onClick={() => setMode("find")}>Find groups</button>
          <button type="button" className="ch-x" onClick={() => setMode(null)} aria-label="Close">×</button>
        </div>
        {err && <p className="ch-err" role="alert">{err}</p>}
        {mode === "new" && <PickPeople sb={sb} me={me} single cta="Chat" onPick={dm} />}
        {mode === "group" && (
          <div className="stack" style={{ gap: 10 }}>
            <label className="field"><span>Group name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. BNB Chain hunters" /></label>
            <label className="field"><span>About <small className="muted">optional</small></span><input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={300} /></label>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} /> <span>Public: anyone can find and join it</span></label>
            <small className="muted">Add people you follow (you can add more later):</small>
            <PickPeople sb={sb} me={me} cta="Create group" onPick={makeGroup} />
            <button type="button" className="btn small" onClick={() => makeGroup([])}>Create it without adding anyone yet</button>
          </div>
        )}
        {mode === "find" && (
          <ul className="ch-pick">
            {!groups ? <p className="muted">Loading…</p> : groups.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => join(g.id)}>
                  <Face group={g.is_default ? "AU" : g.name} size={36} />
                  <span className="grow"><span className={`ch-name${g.is_default ? " team" : ""}`}>{g.name}{g.is_default && <i className="ch-tick team">✓</i>}</span><small>{g.about || g.last_text || "Public group"}</small></span>
                  <i>Join</i>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
