"use client";
import { useState } from "react";

/** Type DELETE, then the account and its data are deleted for good. */
export default function DeleteAccount({ email }: { email: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(false);

  async function go() {
    setBusy(true); setMsg("");
    const r = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: text }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error || "Something went wrong. Try again."); return; }
    setDone(true);
    setTimeout(() => window.location.assign("/"), 3000);
  }

  if (done) return <div className="notice ok">Your account has been deleted. Thank you for being part of AUTISTIK.</div>;
  return (
    <div className="card stack">
      <b>Delete {email}</b>
      <p className="muted">This can&apos;t be undone. Type <b>DELETE</b> to confirm.</p>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" autoComplete="off" />
      <button type="button" className="btn danger" disabled={busy || text.trim().toUpperCase() !== "DELETE"} onClick={go}>{busy ? "Deleting…" : "Delete my account for good"}</button>
      {msg && <div className="notice warn">{msg}</div>}
    </div>
  );
}
