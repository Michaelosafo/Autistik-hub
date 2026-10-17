"use client";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { LOCKER_CHAINS, type LockerChain, type LockerSite } from "@/lib/locker";

/** Admin only: put the AUTISTIK Locker on a chain from your own wallet, then verify its source on the explorer. */
export default function LockerDeploy({ sites }: { sites: LockerSite[] }) {
  const left = (Object.keys(LOCKER_CHAINS) as LockerChain[]).filter((c) => !sites.some((s) => s.chain === c));
  const [chain, setChain] = useState<LockerChain>(left[0] ?? "bsc");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState("");

  async function save(c: LockerChain, txHash: string) {
    setMsg("Checking the new locker on-chain…");
    const r = await fetch("/api/lockers/contracts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c, txHash }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "Couldn't save the locker."); return; }
    setMsg(`✅ The AUTISTIK Locker is live on ${LOCKER_CHAINS[c].name} at ${d.address}. Refresh the page. Next: press "Verify source".`);
  }

  async function deploy() {
    const eth = (window as any).ethereum;
    if (!eth) { setMsg("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet."); return; }
    setBusy(true); setMsg("Check your wallet app…");
    try {
      const cfg = LOCKER_CHAINS[chain];
      const w = createWalletClient({ chain: cfg.viem as any, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: cfg.viem as any, transport: http(cfg.rpc) });
      const [account] = await w.requestAddresses();
      try { await w.switchChain({ id: cfg.viem.id }); } catch { await w.addChain({ chain: cfg.viem }); await w.switchChain({ id: cfg.viem.id }); }
      const { LOCKER_BYTECODE } = await import("@/lib/locker-build");
      setMsg(`Confirm in your wallet. This puts the locker on ${cfg.name} (one network fee, usually a few dollars).`);
      const h = await w.sendTransaction({ account, chain: cfg.viem, data: LOCKER_BYTECODE });
      setHash(h);
      setMsg("Sent. Waiting for the network to confirm…");
      const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
      if (r.status !== "success" || !r.contractAddress) { setMsg("The deployment failed. Only the network fee was spent."); return; }
      await save(chain, h);
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet. Nothing happened." : e?.shortMessage || String(e?.message || e).split("\n")[0]);
    } finally { setBusy(false); }
  }

  async function verify(c: LockerChain) {
    setBusy(true); setMsg(`Sending the source code to the ${LOCKER_CHAINS[c].name} explorer… (can take up to a minute)`);
    try {
      const r = await fetch("/api/lockers/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c }) });
      const d = await r.json().catch(() => ({}));
      setMsg(d.message || d.error || "No answer from the explorer. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>🛠️ Admin: put the locker on a chain</h3>
      <p className="muted" style={{ margin: 0 }}>Only you see this. The locker has no owner or admin powers, so deploying it doesn&apos;t give anyone (including you) access to locked tokens. Use a wallet with a little {chain === "bsc" ? "BNB" : "ETH"} for the fee.</p>
      {left.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select value={chain} onChange={(e) => setChain(e.target.value as LockerChain)} aria-label="Chain">
            {left.map((c) => <option key={c} value={c}>{LOCKER_CHAINS[c].name}</option>)}
          </select>
          <button type="button" className="btn primary" disabled={busy} onClick={deploy}>🚀 Deploy the locker</button>
        </div>
      )}
      <details>
        <summary className="muted">Deployed from Remix or another tool? Add it here</summary>
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <select value={chain} onChange={(e) => setChain(e.target.value as LockerChain)} aria-label="Chain of the deployment">
            {left.map((c) => <option key={c} value={c}>{LOCKER_CHAINS[c].name}</option>)}
          </select>
          <input value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="Deploy transaction hash 0x…" style={{ flex: 1, minWidth: 180 }} spellCheck={false} />
          <button type="button" className="btn small" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(hash)} onClick={() => save(chain, hash)}>Add</button>
        </div>
      </details>
      {hash && !busy && msg && !msg.startsWith("✅") && (
        <button type="button" className="btn small" onClick={() => save(chain, hash)}>Try saving again</button>
      )}
      {sites.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {sites.map((s) => (
            <div key={s.chain} className="row" style={{ gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
              <span>{LOCKER_CHAINS[s.chain].name}: <a href={`${LOCKER_CHAINS[s.chain].explorer}/address/${s.address}#code`} target="_blank" rel="noreferrer">{s.address.slice(0, 10)}…</a> {s.verified ? "✓ verified" : "· not verified yet"}</span>
              {!s.verified && <button type="button" className="btn small" disabled={busy} onClick={() => verify(s.chain)}>Verify source</button>}
            </div>
          ))}
          <small className="muted">
            Verify by hand instead: on the explorer open the contract → Verify &amp; Publish → &quot;Solidity (Standard-Json-Input)&quot;, compiler v0.8.24, MIT,
            and upload <a href="/api/lockers/source">this file</a>.
          </small>
        </div>
      )}
      {msg && <div className="muted" style={{ fontSize: ".9em" }}>{msg}</div>}
    </div>
  );
}
