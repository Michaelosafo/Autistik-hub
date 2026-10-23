"use client";
import { useState } from "react";

export default function AdminWalletBackfill() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true); setMsg("Working…");
    try {
      const r = await fetch("/api/wallet/backfill", { method: "POST" });
      const j = await r.json();
      setMsg(r.ok ? `Linked ${j.linked}, skipped ${j.skipped} (no confirmed email or wallet not ready). ${j.left > 0 ? `${j.left} still to go, press again.` : "All done."}` : j.error || "Something went wrong.");
    } catch { setMsg("Something went wrong."); }
    setBusy(false);
  }
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <b>👛 Give every member a wallet</b>
      <p className="muted" style={{ margin: 0 }}>Members who haven&apos;t signed in since wallets became automatic don&apos;t have one yet. This creates their free AUTISTIK wallet so anyone can send them tokens by name.</p>
      <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} onClick={run}>{busy ? "Working…" : "Link wallets now"}</button><span className="muted">{msg}</span></div>
    </div>
  );
}
