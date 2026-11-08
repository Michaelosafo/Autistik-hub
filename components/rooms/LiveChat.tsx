"use client";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";

type Who = { alias: string; color: string | null; avatar_url: string | null };
type Msg = { id: number; user_id: string; body: string | null; image_url: string | null; deleted: boolean; created_at: string; who: Who | null };

/** Only pictures from the Hub's own chat-images store are shown. */
const IMG_OK = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/chat-images\//;
const EMOJI = ["😂", "❤️", "🔥", "👏", "🙌", "😍", "😮", "😢", "🤝", "💯", "🚀", "💎", "🎉", "👀", "🙏", "😎", "🤣", "💜", "✨", "🧠", "♾️", "🌈", "🐐", "✅"];
const SEL = "id,user_id,body,image_url,deleted,created_at,who:profiles!live_room_messages_user_id_fkey(alias,color,avatar_url)";
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const norm = (r: any): Msg => ({ ...r, who: Array.isArray(r.who) ? r.who[0] ?? null : r.who });

/**
 * The live's comments: text, pictures and emoji, for everyone in the room. They're kept, so anyone who comes back
 * (or opens the live after it ends) can read them. Delete your own; the host and co-hosts can delete any.
 */
export default function LiveChat({ roomId, me, canModerate = false, readOnly = false }: {
  roomId: string; me: { id: string; alias: string; color: string | null; avatar_url: string | null } | null; canModerate?: boolean; readOnly?: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [emo, setEmo] = useState(false);
  const [unread, setUnread] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const people = useRef(new Map<string, Who>());

  const add = (m: Msg) => setMsgs((list) => {
    const l = list || [];
    if (l.some((x) => x.id === m.id)) return l.map((x) => (x.id === m.id ? { ...x, ...m, who: m.who || x.who } : x));
    return [...l, m].slice(-300);
  });

  useEffect(() => {
    const sb = supabaseBrowser();
    let stop = false;
    sb.from("live_room_messages").select(SEL).eq("room_id", roomId).order("id", { ascending: false }).limit(150).then(({ data }) => {
      if (stop) return;
      const rows = ((data || []) as any[]).map(norm).reverse();
      rows.forEach((r) => r.who && people.current.set(r.user_id, r.who));
      setMsgs(rows);
    }, () => setMsgs([]));
    const ch = sb.channel(`live-chat-${roomId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_room_messages", filter: `room_id=eq.${roomId}` }, async (p: any) => {
        const r = p.new as Msg;
        let who = people.current.get(r.user_id) || null;
        if (!who) {
          const { data } = await sb.from("profiles").select("alias,color,avatar_url").eq("id", r.user_id).maybeSingle();
          who = (data as Who) || { alias: "Member", color: null, avatar_url: null };
          people.current.set(r.user_id, who);
        }
        add({ ...r, who });
        if (!atBottom.current) setUnread((n) => n + 1);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "live_room_messages", filter: `room_id=eq.${roomId}` }, (p: any) => {
        const r = p.new as Msg;
        setMsgs((l) => (l || []).map((x) => (x.id === r.id ? { ...x, deleted: r.deleted, body: r.body, image_url: r.image_url } : x)));
      })
      .subscribe();
    return () => { stop = true; sb.removeChannel(ch); };
  }, [roomId]);

  // Keep the newest comment in view, unless you've scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  function onScroll() {
    const el = box.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom.current) setUnread(0);
  }
  function jump() { const el = box.current; if (el) el.scrollTop = el.scrollHeight; atBottom.current = true; setUnread(0); }

  async function post(body: string | null, image_url: string | null) {
    if (!me) return false;
    setErr("");
    const { data, error } = await supabaseBrowser().from("live_room_messages").insert({ room_id: roomId, body, image_url }).select(SEL).single();
    if (error || !data) { setErr(/slow down/i.test(error?.message || "") ? "Slow down a little, then try again." : "Couldn't post that. Check your connection."); return false; }
    people.current.set(me.id, { alias: me.alias, color: me.color, avatar_url: me.avatar_url });
    atBottom.current = true;
    add(norm(data));
    return true;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    if (await post(t.slice(0, 500), null)) { setText(""); setEmo(false); }
    setBusy(false);
  }
  async function photo(f: File | undefined) {
    if (!f || !me) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { setErr("Pictures only (JPG, PNG, WebP or GIF)."); return; }
    if (f.size > 3_000_000) { setErr("That picture is too big (3 MB max)."); return; }
    setBusy(true); setErr("");
    const sb = supabaseBrowser();
    const ext = f.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${me.id}/live-${roomId.slice(0, 8)}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("chat-images").upload(path, f, { contentType: f.type });
    if (error) { setErr("Couldn't upload that picture."); setBusy(false); return; }
    const t = text.trim();
    if (await post(t ? t.slice(0, 500) : null, sb.storage.from("chat-images").getPublicUrl(path).data.publicUrl)) setText("");
    setBusy(false);
    if (file.current) file.current.value = "";
  }
  async function remove(m: Msg) {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabaseBrowser().rpc("delete_live_message", { mid: m.id });
    if (!error) setMsgs((l) => (l || []).map((x) => (x.id === m.id ? { ...x, deleted: true, body: null, image_url: null } : x)));
  }
  function addEmoji(e: string) {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const next = (text.slice(0, at) + e + text.slice(at)).slice(0, 500);
    setText(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  }

  const shown = (msgs || []).filter((m) => !m.deleted);
  return (
    <section className="lv-chat" aria-label="Comments">
      <div className="lv-chat-h"><b>💬 Comments</b><small className="muted">{shown.length ? `${shown.length}` : ""}</small></div>
      <div className="lv-chat-list" ref={box} onScroll={onScroll} aria-live="polite">
        {msgs === null ? <small className="muted">Loading comments…</small> : !shown.length ? <small className="muted">{readOnly ? "No comments in this live." : "No comments yet. Say hi 👋"}</small> : shown.map((m) => (
          <div key={m.id} className={"lv-msg" + (m.user_id === me?.id ? " mine" : "")}>
            <Avatar className="avatar lv-msg-av" alias={m.who?.alias || "Member"} color={m.who?.color ?? null} url={m.who?.avatar_url ?? null} />
            <div className="lv-msg-b">
              <div className="lv-msg-top"><b>{m.who?.alias || "Member"}</b><small>{time(m.created_at)}</small>
                {!readOnly && (m.user_id === me?.id || canModerate) && <button type="button" className="lv-msg-x" onClick={() => remove(m)} aria-label="Delete comment">✕</button>}
              </div>
              {m.body && <p>{m.body}</p>}
              {m.image_url && IMG_OK.test(m.image_url) && <a href={m.image_url} target="_blank" rel="noopener noreferrer"><img src={m.image_url} alt="Picture shared in the live" loading="lazy" /></a>}
            </div>
          </div>
        ))}
      </div>
      {unread > 0 && <button type="button" className="lv-chat-new" onClick={jump}>↓ {unread} new</button>}
      {!readOnly && me && (
        <>
          {emo && <div className="lv-emo" role="group" aria-label="Emoji">{EMOJI.map((e) => <button key={e} type="button" onClick={() => addEmoji(e)} aria-label={e}>{e}</button>)}</div>}
          <form className="lv-chat-f" onSubmit={submit}>
            <button type="button" className={"lv-chat-ic" + (emo ? " on" : "")} onClick={() => setEmo((x) => !x)} aria-label="Emoji" aria-pressed={emo}>😊</button>
            <button type="button" className="lv-chat-ic" onClick={() => file.current?.click()} disabled={busy} aria-label="Add a picture">🖼️</button>
            <input type="file" ref={file} accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => photo(e.target.files?.[0])} />
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Add a comment…" aria-label="Comment" enterKeyHint="send" />
            <button type="submit" className="btn small primary" disabled={busy || !text.trim()}>{busy ? "…" : "Send"}</button>
          </form>
        </>
      )}
      {err && <small className="muted" role="status">{err}</small>}
    </section>
  );
}
