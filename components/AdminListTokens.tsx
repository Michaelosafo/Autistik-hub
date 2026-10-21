"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHAINS, type ChainKey } from "@/lib/launchpad";

type Result = { token: string; ok: boolean; text: string };

/** Admin only: list any number of tokens launched elsewhere on the Launch Pad, free, or take a listed one off. */
export default function AdminListTokens() {
  const router = useRouter();
  const [chain, setChain] = useState<ChainKey>("bsc");
  const [tokens, setTokens] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(method: "POST" | "DELETE") {
    const list = [...new Set(tokens.split(/[\s,]+/).filter(Boolean))];
    if (!list.length) { setMsg("Paste at least one token address."); return; }
    if (method === "DELETE" && list.length !== 1) { setMsg("Remove one token at a time."); return; }
    setBusy(true); setMsg(""); setResults([]);
    try {
      const all: Result[] = [];
      let listed = 0;
      // The server takes up to 50 at a time; send bigger lists in parts.
      for (let i = 0; i < list.length; i += 50) {
        setMsg(list.length > 50 ? `Working… ${Math.min(i + 50, list.length)} of ${list.length}` : "Working…");
        const res = await fetch("/api/launchpad/list", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(method === "POST" ? { chain, tokens: list.slice(i, i + 50) } : { chain, token: list[0] }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg(d.error || "Something went wrong. Try again."); setResults(all); return; }
        if (method === "DELETE") { setMsg("Removed from the Launch Pad."); setTokens(""); router.refresh(); return; }
        all.push(...(d.results || []));
        listed += d.listed || 0;
      }
      setResults(all);
      setMsg(`Listed ${listed} new token${listed === 1 ? "" : "s"}. They show in Trending and New listings now.`);
      if (listed) router.refresh();
    } catch {
      setMsg("Couldn't reach the Hub. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack">
      <h3>⭐ Admin: list tokens for free</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Only you see this. Add any token that has a trading pool on DexScreener, as many as you like, with no payment. Paste one address per line (or separated by commas). They show on the board with a &ldquo;Listed&rdquo; badge.</p>
      <label className="stack" style={{ gap: 4 }}>
        <span>Network</span>
        <select value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
          {Object.values(CHAINS).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span>Token addresses</span>
        <textarea rows={5} value={tokens} onChange={(e) => setTokens(e.target.value)} placeholder={chain === "solana" ? "Mint address, one per line" : "0x…, one per line"} spellCheck={false} className="mono" />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" type="button" disabled={busy} onClick={() => send("POST")}>{busy ? "Working…" : "List for free"}</button>
        <button className="btn small" type="button" disabled={busy} onClick={() => send("DELETE")}>Remove a listed token</button>
      </div>
      {msg && <div className="notice" role="status">{msg}</div>}
      {!!results.length && (
        <ul className="stack" style={{ gap: 4, margin: 0, paddingLeft: 18, fontSize: ".86em" }}>
          {results.map((r) => <li key={r.token} className={r.ok ? "" : "down"}><span className="mono">{r.token.slice(0, 10)}…</span> {r.text}</li>)}
        </ul>
      )}
    </div>
  );
}
