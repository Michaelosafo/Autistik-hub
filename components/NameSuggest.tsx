"use client";
import { useState } from "react";

type Pick = { alias: string; handle: string };

/** "Suggest names" button: shows free AUTISTIK names as chips. Tap one to use it. */
export default function NameSuggest({ onPick, label = "✨ Suggest names" }: { onPick: (p: Pick) => void; label?: string }) {
  const [list, setList] = useState<Pick[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function load() {
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/names/suggest", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error();
      setList(j.names || []);
    } catch { setErr("Couldn't get suggestions right now. Try again."); }
    setBusy(false);
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={busy} onClick={load}>{busy ? "Thinking…" : list ? "🔄 More names" : label}</button>
        {err && <span className="muted" style={{ fontSize: ".82em" }}>{err}</span>}
      </div>
      {list && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {list.map((p) => (
            <button key={p.alias} type="button" className="badge-pill" style={{ cursor: "pointer", color: "var(--ink)" }} onClick={() => onPick(p)} title={`@${p.handle}`}>
              {p.alias} <span className="muted">@{p.handle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
