"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/** Paste a token address to see its top 40 wallets and dev, and get sell alerts. */
export default function AnalyticsScan({ signedIn, chain: fixedChain, token: fixedToken, label = "Scan" }: { signedIn: boolean; chain?: string; token?: string; label?: string }) {
  const router = useRouter();
  const [chain, setChain] = useState(fixedChain || "bsc");
  const [token, setToken] = useState(fixedToken || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function scan(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/analytics/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token: token.trim(), refresh: !!fixedToken }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d.error || "Couldn't scan that token. Try again."); return; }
    router.push(d.path); router.refresh();
  }

  if (!signedIn) return <Link className="btn primary" href="/login?next=/analytics">Sign in to {fixedToken ? "refresh" : "scan tokens"}</Link>;
  if (fixedToken) return (
    <span className="stack" style={{ gap: 4 }}>
      <button className="btn small" type="button" onClick={() => scan()} disabled={busy}>{busy ? "Refreshing…" : "↻ " + label}</button>
      {err && <span className="muted" style={{ fontSize: ".8em" }}>{err}</span>}
    </span>
  );
  return (
    <form className="scan-form" onSubmit={scan}>
      <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="Chain">
        <option value="bsc">BNB Chain</option>
        <option value="ethereum">Ethereum</option>
        <option value="base">Base</option>
        <option value="robinhood">Robinhood Chain</option>
        <option value="solana">Solana</option>
      </select>
      <input value={token} onChange={(e) => {
        const v = e.target.value;
        setToken(v);
        // Pasted a Solana address? Switch to Solana. Pasted an 0x address while on Solana? Switch back.
        if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim())) setChain("solana");
        else if (/^0x/i.test(v.trim()) && chain === "solana") setChain("bsc");
      }} placeholder={chain === "solana" ? "Paste a Solana token address" : "Paste a token address (0x…)"} aria-label="Token address" spellCheck={false} autoComplete="off" />
      <button className="btn primary" type="submit" disabled={busy || !token.trim()}>{busy ? "Scanning…" : "🔎 " + label}</button>
      {err && <p className="scan-err" role="alert">{err}</p>}
    </form>
  );
}
