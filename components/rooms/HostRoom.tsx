"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Start a live room: a title, Public or Private, then you're the host.
 * Public: every signed-in member sees it in "Live now" and can choose to join. Private: not listed; only people with
 * your invite link can get in (supabase/live-private-summary.sql).
 */
export default function HostRoom({ open: o0 }: { open?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!o0);
  const [title, setTitle] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function start() {
    const t = title.trim();
    if (t.length < 3) { setMsg("Give your live a short title (3 letters or more)."); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    // One open live per host: close an old one left open.
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.push("/login?next=/spaces"); return; }
    await sb.from("live_rooms").update({ ended_at: new Date().toISOString() }).eq("host_id", user.id).is("ended_at", null);
    const { data, error } = await sb.from("live_rooms").insert({ title: t.slice(0, 80), visibility: priv ? "private" : "public" }).select("id").single();
    if (error || !data) { setBusy(false); setMsg("Couldn't start the live. Try again."); return; }
    if (priv) {
      // The invite code people need to get in. Only you can read it; share the link from the room.
      const b = crypto.getRandomValues(new Uint8Array(18));
      const code = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const { error: ke } = await sb.from("live_room_keys").insert({ room_id: data.id, code });
      if (ke) { await sb.from("live_rooms").update({ ended_at: new Date().toISOString() }).eq("id", data.id); setBusy(false); setMsg("Couldn't make the private invite link. Try again."); return; }
    }
    setBusy(false);
    router.push(`/spaces/${data.id}`);
  }
  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Host a live</button>;
  return (
    <div className="card stack host-room">
      <b>Host a live</b>
      <label className="field"><span>Title</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning check-in, AMA, Launch talk" autoFocus /></label>
      <div className="lv-vis" role="radiogroup" aria-label="Who can join">
        <button type="button" role="radio" aria-checked={!priv} className={!priv ? "on" : ""} onClick={() => setPriv(false)}>
          <b>🌍 Public</b><small>Everyone signed in sees it in Live now and can join.</small>
        </button>
        <button type="button" role="radio" aria-checked={priv} className={priv ? "on" : ""} onClick={() => setPriv(true)}>
          <b>🔒 Private</b><small>Not listed. Only people with your invite link can join.</small>
        </button>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <small className="muted">You talk, people listen and comment, and only people you invite can speak (or turn on Open mic). You can mute anyone, record the live and save it, and drop tokens to everyone at once.</small>
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
