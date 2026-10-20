"use client";
import { useState } from "react";
import Link from "next/link";

/** One tap: a plain-English analyst report for this token (AUTISTIK Pro). */
export default function ProReport({ chain, token }: { chain: string; token: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(""); setText("");
    const r = await fetch("/api/pro/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error || "Couldn't write the report. Try again."); return; }
    setText(d.report);
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <button className="btn primary" type="button" onClick={go} disabled={busy}>{busy ? "🤖 Writing your report…" : text ? "🤖 Write a fresh report" : "🤖 Get the analyst report"}</button>
      {err && <div className="notice warn">{err} {err.includes("Pro") && <Link href="/pro">Get Pro →</Link>}</div>}
      {text && <div className="msg ai paper pro-report">{text}</div>}
    </div>
  );
}
