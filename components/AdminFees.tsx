import { solFeeWallet } from "@/lib/launchpad";

const RPC = process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "RPC error");
  return j.result;
}
type In = { sig: string; at: number; sol: number };

/**
 * Admin: the SOL the marketing wallet has received (launch fees and the 0.5% swap fee), read from Solana itself.
 */
export default async function AdminFees() {
  const w = solFeeWallet();
  if (!w) return <div className="card"><b>Solana fees</b><p className="muted" style={{ margin: 0 }}>No Solana marketing wallet is set (NEXT_PUBLIC_SOLANA_FEE_WALLET), so no Solana fees are charged.</p></div>;
  let bal: number | null = null; const ins: In[] = []; let err = "";
  try {
    const [b, sigs] = await Promise.all([rpc("getBalance", [w]), rpc("getSignaturesForAddress", [w, { limit: 40 }])]);
    bal = b.value / 1e9;
    const txs = await Promise.all((sigs as any[]).filter((s) => !s.err).slice(0, 40).map((s) =>
      rpc("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]).then((t) => ({ s, t })).catch(() => null)));
    for (const x of txs) {
      if (!x?.t) continue;
      const keys: string[] = [...x.t.transaction.message.accountKeys, ...(x.t.meta?.loadedAddresses?.writable || []), ...(x.t.meta?.loadedAddresses?.readonly || [])].map((k: any) => (typeof k === "string" ? k : k.pubkey));
      const i = keys.indexOf(w);
      if (i < 0) continue;
      const d = (x.t.meta.postBalances[i] - x.t.meta.preBalances[i]) / 1e9;
      if (d > 0) ins.push({ sig: x.s.signature, at: (x.s.blockTime || 0) * 1000, sol: d });
    }
  } catch (e: any) { err = String(e?.message || e).slice(0, 120); }
  const sum = (ms: number) => ins.filter((x) => Date.now() - x.at < ms).reduce((t, x) => t + x.sol, 0);
  const f = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return (
    <section className="card stack" aria-label="Solana fees earned">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <b>Solana fees earned</b>
        <a className="mono muted" href={`https://solscan.io/account/${w}`} target="_blank" rel="noopener noreferrer">{w.slice(0, 4)}…{w.slice(-4)} on Solscan</a>
      </div>
      {err ? <p className="muted" style={{ margin: 0 }}>Couldn&apos;t read Solana right now ({err}). Try again in a minute.</p> : (
        <>
          <div className="ln-facts">
            <span><b>{bal == null ? "–" : f(bal)} SOL</b> in the wallet now</span>
            <span><b>{f(sum(864e5))} SOL</b> received today</span>
            <span><b>{f(sum(7 * 864e5))} SOL</b> last 7 days</span>
            <span><b>{ins.length}</b> recent payments in</span>
          </div>
          {ins.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ins.slice(0, 10).map((x) => (
                <li key={x.sig}><b>+{f(x.sol)} SOL</b> <span className="muted">· {x.at ? new Date(x.at).toLocaleString() : ""} · <a href={`https://solscan.io/tx/${x.sig}`} target="_blank" rel="noopener noreferrer">view</a></span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>No SOL has come in recently. Fees arrive when people swap with SOL on autistik.io or launch a Solana coin here.</p>}
          <small className="muted">Includes every SOL payment into this wallet (fees and any other transfers). Last 40 transactions checked.</small>
        </>
      )}
    </section>
  );
}
