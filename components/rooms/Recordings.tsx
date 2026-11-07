"use client";
import { useEffect, useState } from "react";
import Emo from "@/components/Emo";
import { supabaseBrowser } from "@/lib/supabase/client";

type Rec = { id: string; title: string; url: string; path: string; duration_s: number; pinned: boolean; created_at: string; room_id: string | null };
const len = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** A member's recorded lives on their profile: the pinned one on top. The owner can pin, unpin and delete. */
export default function Recordings({ userId, mine }: { userId: string; mine: boolean }) {
  const [list, setList] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => supabaseBrowser().from("live_recordings").select("id,title,url,path,duration_s,pinned,created_at,room_id").eq("host_id", userId).order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(mine ? 20 : 6)
    .then(({ data }) => setList((data || []) as Rec[]), () => setList([]));
  useEffect(() => { load(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pin(r: Rec, on: boolean) {
    setBusy(r.id);
    const sb = supabaseBrowser();
    if (on) await sb.from("live_recordings").update({ pinned: false }).eq("host_id", userId).eq("pinned", true);
    await sb.from("live_recordings").update({ pinned: on }).eq("id", r.id);
    await load(); setBusy("");
  }
  async function remove(r: Rec) {
    if (!confirm(`Delete "${r.title}" for good?`)) return;
    setBusy(r.id);
    const sb = supabaseBrowser();
    await sb.storage.from("live-recordings").remove([r.path]).catch(() => {});
    await sb.from("live_recordings").delete().eq("id", r.id);
    await load(); setBusy("");
  }

  if (!list || (!list.length && !mine)) return null;
  const pinned = list.find((r) => r.pinned);
  const rest = list.filter((r) => !r.pinned);
  return (
    <section className="card stack rec-box" aria-labelledby="rec-h">
      <b id="rec-h"><Emo e="🎙️" size={22} /> Live recordings</b>
      {!list.length && <small className="muted">Record your next live (the 🔴 Record button in the room) and pin it here.</small>}
      {pinned && (
        <div className="rec-pin">
          <span className="rec-tag">📌 Pinned</span>
          <b>{pinned.title}</b>
          <small className="muted">{day(pinned.created_at)} · {len(pinned.duration_s)}</small>
          <audio controls preload="none" src={pinned.url} />
          {mine && <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" disabled={busy === pinned.id} onClick={() => pin(pinned, false)}>Unpin</button><button type="button" className="btn small" disabled={busy === pinned.id} onClick={() => remove(pinned)}>Delete</button></div>}
        </div>
      )}
      {rest.map((r) => (
        <div key={r.id} className="rec-row">
          <div className="rec-row-t"><b>{r.title}</b><small className="muted">{day(r.created_at)} · {len(r.duration_s)}</small></div>
          <audio controls preload="none" src={r.url} />
          {mine && <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" disabled={busy === r.id} onClick={() => pin(r, true)}>📌 Pin to profile</button><button type="button" className="btn small" disabled={busy === r.id} onClick={() => remove(r)}>Delete</button></div>}
        </div>
      ))}
    </section>
  );
}
