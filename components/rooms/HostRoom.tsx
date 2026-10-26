"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Start a live room: give it a title, then you're the host. */
export default function HostRoom({ open: o0 }: { open?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!o0);
  const [title, setTitle] = useState("");
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
    const { data, error } = await sb.from("live_rooms").insert({ title: t.slice(0, 80) }).select("id").single();
    setBusy(false);
    if (error || !data) { setMsg("Couldn't start the live. Try again."); return; }
    router.push(`/spaces/${data.id}`);
  }
  if (!open) return <button type="button" className="btn primary" onClick={() => setOpen(true)}>Host a live</button>;
  return (
    <div className="card stack host-room">
      <b>Host a live</b>
      <label className="field"><span>Title</span><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning check-in, AMA, Launch talk" autoFocus /></label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={start}>{busy ? "Starting…" : "Start"}</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <small className="muted">You talk, people listen, and you can invite up to 5 people to speak. Nothing is recorded.</small>
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
