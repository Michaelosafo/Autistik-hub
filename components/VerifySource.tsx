"use client";
import { useEffect, useState } from "react";
import { CHAINS, type ChainKey } from "@/lib/launchpad";

/** Shows whether a Launch Pad token's code is open source on its explorer, with a button to publish it if not. */
export default function VerifySource({ chain, token }: { chain: ChainKey; token: string }) {
  const c = CHAINS[chain];
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/launchpad/verify?chain=${chain}&token=${token}`).then((r) => r.json()).then((d) => setOk(d.ok ?? null)).catch(() => null);
  }, [chain, token]);

  async function verify() {
    setBusy(true); setMsg("Sending the code to the explorer. This can take up to a minute…");
    try {
      const r = await fetch("/api/launchpad/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token }) });
      const d = await r.json().catch(() => ({}));
      setMsg(d.message || d.error || "Something went wrong. Try again.");
      if (d.ok) setOk(true);
    } catch { setMsg("Couldn't reach the server. Try again."); } finally { setBusy(false); }
  }

  const code = `${c.explorer}/address/${token}#code`;
  if (ok) return <small className="muted">✓ Open source: <a href={code} target="_blank" rel="noopener noreferrer">read the verified code</a> on the explorer.</small>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn small" type="button" disabled={busy} onClick={verify}>{busy ? "Verifying…" : "Verify the code on the explorer"}</button>
      <small className="muted">{msg || "Publishes the token's source so wallets and scanners show it as open source."}</small>
    </div>
  );
}
