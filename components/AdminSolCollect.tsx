"use client";
import { useState } from "react";
import { useSolWallet } from "@/components/SolanaLaunch";
import { signAndSend, solErr } from "@/lib/sol-wallet";

type Found = { mint: string; amount: string; accounts: number };

/**
 * Owner: collect the 0.5% trade fee on Solana coins launched here. Each coin keeps its fee in its traders' accounts
 * until the marketing wallet collects it; this signs those collections from the marketing wallet.
 */
export default function AdminSolCollect() {
  const { sw, picker } = useSolWallet();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);

  async function collect() {
    if (!sw) return;
    setBusy(true); setMsg("Looking for fees to collect…"); setFound(null);
    try {
      const r = await fetch("/api/admin/sol-fees", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: sw.account.address }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't check the fees.");
      setFound(d.found || []);
      if (!d.txs?.length) { setMsg("Nothing to collect yet. Fees build up as people trade coins launched here."); return; }
      for (let i = 0; i < d.txs.length; i++) {
        setMsg(`Approve ${i + 1} of ${d.txs.length} in your wallet…`);
        await signAndSend(sw, d.txs[i]);
      }
      setMsg("Collected. The coins are now in the marketing wallet; sell them on the Swap page whenever you like.");
    } catch (e: any) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  return (
    <section className="card stack" aria-label="Collect Solana trade fees">
      <b>Collect Solana trade fees</b>
      <p className="muted" style={{ margin: 0 }}>New Solana coins launched here charge 0.5% on every trade, on any app or DEX. The fee is kept in the coin until the marketing wallet collects it. Connect the marketing wallet and press Collect.</p>
      {picker(busy, setMsg)}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={!sw || busy} onClick={collect}>{busy ? "Working…" : "Collect fees"}</button>
      </div>
      {found && found.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {found.map((f) => <li key={f.mint}><span className="mono">{f.mint.slice(0, 4)}…{f.mint.slice(-4)}</span>: {(Number(f.amount) / 1e6).toLocaleString()} tokens from {f.accounts} accounts</li>)}
        </ul>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </section>
  );
}
