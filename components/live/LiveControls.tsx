"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Admin only: put a session live, end it, or remove it. The database checks it's really the admin. */
export default function LiveControls({ id, live, ended }: { id: string; live: boolean; ended: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState("");
  async function set(p: Record<string, boolean>) {
    setBusy(true); setMsg("");
    const { error } = await supabaseBrowser().from("sessions").update(p).eq("id", id);
    setBusy(false);
    if (error) setMsg(/column/i.test(error.message) ? "Run supabase/members-live.sql first." : "Couldn't save.");
    router.refresh();
  }
  async function remove() {
    setBusy(true);
    await supabaseBrowser().from("sessions").delete().eq("id", id);
    setBusy(false); router.refresh();
  }
  return (
    <div className="row live-admin" style={{ gap: 6 }}>
      <span className="badge gold">Admin</span>
      {!live && !ended && <button className="btn small primary" type="button" disabled={busy} onClick={() => set({ is_live: true, ended: false })}>● Go live</button>}
      {live && <button className="btn small" type="button" disabled={busy} onClick={() => set({ is_live: false, ended: true })}>End session</button>}
      {ended && <button className="btn small" type="button" disabled={busy} onClick={() => set({ is_live: true, ended: false })}>Reopen</button>}
      {sure ? <><button className="btn small" type="button" disabled={busy} onClick={remove}>Yes, remove</button><button className="btn small" type="button" onClick={() => setSure(false)}>Keep</button></>
        : <button className="btn small" type="button" onClick={() => setSure(true)}>Remove</button>}
      {msg && <span className="muted" style={{ fontSize: ".85em" }}>{msg}</span>}
    </div>
  );
}
