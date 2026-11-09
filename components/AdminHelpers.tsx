"use client";
/** Owner only: make members helper admins (build and moderate, use the AI trader) and remove them. */
import { useEffect, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { supabaseBrowser } from "@/lib/supabase/client";

type H = { user_id: string; alias: string; handle: string | null; avatar_url: string | null; color: string | null; added_at: string };

export default function AdminHelpers() {
  const [list, setList] = useState<H[] | null>(null);
  const [who, setWho] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const sb = supabaseBrowser();
  const load = async () => { const { data, error } = await sb.rpc("admin_list_helpers"); if (error) setMsg(error.message); setList((data as H[]) || []); };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!who.trim()) return;
    setBusy(true); setMsg("");
    const { error } = await sb.rpc("admin_add_helper", { p_who: who.trim() });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setWho(""); setMsg("Added. They need a 2-step code on their account before the admin tools open for them."); load();
  }
  async function remove(h: H) {
    if (!confirm(`Remove ${h.alias} as a helper admin? They lose admin access straight away.`)) return;
    const { error } = await sb.rpc("admin_remove_helper", { p_user: h.user_id });
    setMsg(error ? error.message : `${h.alias} removed.`); load();
  }

  return (
    <section className="card stack">
      <b>👥 Helper admins</b>
      <small className="muted">Only you can add or remove them. Helpers can build and moderate (TIK news, hide posts, sessions, Launch Pad tools) and use the AI trader. They can&apos;t touch fees, airdrops, staking admin, the live trading wallet, or other admins.</small>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="@username" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Username to make a helper admin" />
        <button type="button" className="btn primary" disabled={busy || !who.trim()} onClick={add}>{busy ? "Adding…" : "Make admin"}</button>
      </div>
      {msg && <small role="status">{msg}</small>}
      {list === null ? <small className="muted">Loading…</small> : !list.length ? <small className="muted">No helper admins yet.</small> : (
        <div className="ait-bl">
          {list.map((h) => (
            <div key={h.user_id} className="ait-b">
              <Avatar className="avatar" alias={h.alias} color={h.color || undefined} url={h.avatar_url} />
              <div className="ait-b-name"><Link href={`/members/${h.user_id}`}><b>{h.alias}</b></Link><small className="muted">{h.handle ? `@${h.handle} · ` : ""}since {new Date(h.added_at).toLocaleDateString()}</small></div>
              <button type="button" className="btn small" onClick={() => remove(h)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
