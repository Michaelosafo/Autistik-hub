"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/** Paste a token address to see its top 40 wallets and dev, and get sell alerts. */
export default function AnalyticsScan({ signedIn, chain: fixedChain, token: fixedToken, label = "Scan", pin, view }: { signedIn: boolean; chain?: string; token?: string; label?: string; pin?: boolean; view?: string }) {
  const router = useRouter();
  // "auto" finds the network from the address; BNB Chain and Solana can also be picked by hand.
  const [chain, setChain] = useState(fixedChain || "auto");
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
    if (pin) {
      // Pin it straight away and stay on My pins.
      const [, , ch, tk] = String(d.path).split("/");
      setBusy(true);
      const pr = await fetch("/api/analytics/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: ch, token: tk, on: true }) });
      const pd = await pr.json().catch(() => ({}));
      setBusy(false);
      if (!pr.ok) { setErr(pd.error || "Couldn't pin it. Try again."); return; }
      setToken(""); router.refresh(); return;
    }
    // `view` opens a section of the token page (the game arena scans straight into its own pitch).
    router.push(view ? `${d.path}?view=${view}` : d.path); router.refresh();
  }

  if (!signedIn) return <Link className="btn primary" href={`/login?next=${view === "chess" ? "/arena" : "/analytics"}`}>Sign in to {fixedToken ? "refresh" : "scan tokens"}</Link>;
  if (fixedToken) return (
    <span className="stack" style={{ gap: 4 }}>
      <button className="btn small" type="button" onClick={() => scan()} disabled={busy}>{busy ? "Refreshing…" : "↻ " + label}</button>
      {err && <span className="muted" style={{ fontSize: ".8em" }}>{err}</span>}
    </span>
  );
  const NETS = [{ key: "auto", name: "⚡ Auto" }, { key: "bsc", name: "BNB Chain" }, { key: "solana", name: "Solana" }];
  return (
    <form className="scan-form pro" onSubmit={scan}>
      <div className="net-pills" role="radiogroup" aria-label="Network">
        {NETS.map((n) => <button key={n.key} type="button" role="radio" aria-checked={chain === n.key} className={"net-pill" + (chain === n.key ? " on" : "")} onClick={() => setChain(n.key)}>{n.name}</button>)}
      </div>
      <div className="scan-row">
        <input value={token} onChange={(e) => {
          const v = e.target.value;
          setToken(v);
          // A pasted Solana address can only be Solana; an 0x address goes back to auto-detect.
          if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v.trim())) setChain("solana");
          else if (/^0x/i.test(v.trim()) && chain === "solana") setChain("auto");
        }} placeholder="Paste any token address: we detect the network" aria-label="Token address" spellCheck={false} autoComplete="off" />
        <button className="btn primary" type="submit" disabled={busy || !token.trim()}>{busy ? (chain === "auto" ? "Detecting…" : pin ? "Pinning…" : "Scanning…") : (pin ? "📌 " : "🔎 ") + label}</button>
      </div>
      {err && <p className="scan-err" role="alert">{err}</p>}
    </form>
  );
}
