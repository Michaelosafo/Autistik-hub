"use client";
import { useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, encodeAbiParameters, encodeFunctionData, getAddress, getContractAddress, keccak256, toHex } from "viem";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { NATIVE, WCHAINS } from "@/lib/wallet-chains";

const CREATE2 = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
const SALT = keccak256(toHex("AUTISTIK Staking v2"));
const c = WCHAINS.bsc;
const WEEK = 7n * 86400n;

/**
 * Admin only: switch staking on. 1) Deploy the Staking contract from the team wallet (it becomes the owner).
 * 2) Open the Official pool: stake $AUTISTIK, earn BNB. Then share fees with "Add rewards" on its card.
 */
export default function StakeAdmin() {
  const [info, setInfo] = useState<{ treasury: string; contracts: Record<string, string> } | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/stake/admin", { cache: "no-store" }).then((r) => r.json()).then((d) => !d.error && setInfo(d)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function wallet() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("Open this page in your wallet's browser (the team wallet).");
    const w = createWalletClient({ chain: c.viem, transport: custom(eth) }) as any;
    const pub = createPublicClient({ chain: c.viem, transport: custom(eth) }) as any;
    const [account] = await w.requestAddresses();
    if (getAddress(account) !== getAddress(info!.treasury)) throw new Error(`Switch to the team wallet ${info!.treasury.slice(0, 8)}… first.`);
    try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: c.viem }); await w.switchChain({ id: c.chainId }); }
    return { w, pub, account };
  }
  const fail = (e: any) => setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : e?.shortMessage || String(e?.message || e).split("\n")[0]);

  async function deploy() {
    setBusy(true); setMsg("");
    try {
      const { w, pub, account } = await wallet();
      const { STAKING_BYTECODE } = await import("@/lib/staking-build");
      const t = getAddress(info!.treasury);
      const initcode = concat([STAKING_BYTECODE, encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint256" }], [t, t, 0n])]);
      const address = getContractAddress({ opcode: "CREATE2", from: CREATE2, salt: SALT, bytecode: initcode });
      const code = await pub.getCode({ address });
      if (!code || code === "0x") {
        setMsg("Confirm in your wallet: this puts the AUTISTIK Staking contract on BNB Chain.");
        const hash = await w.sendTransaction({ account, chain: c.viem, to: CREATE2, data: concat([SALT, initcode]) });
        setMsg("Sent. Waiting for the network…");
        await pub.waitForTransactionReceipt({ hash, timeout: 180_000 }).catch(() => null);
      }
      const r = await fetch("/api/stake/contracts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "bsc", address }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg(`Staking is live: ${address}. Next: open the Official pool.`); load();
    } catch (e) { fail(e); }
    setBusy(false);
  }

  async function officialPool() {
    setBusy(true); setMsg("");
    try {
      const { w, pub, account } = await wallet();
      const { STAKING_ABI } = await import("@/lib/staking-build");
      setMsg("Confirm in your wallet: Official pool, stake AUTISTIK, earn BNB, rewards paid over 7 days (members pick their own lock for a boost).");
      const hash = await w.sendTransaction({ account, chain: c.viem, to: getAddress(info!.contracts.bsc), data: encodeFunctionData({ abi: STAKING_ABI, functionName: "createPool", args: [getAddress(TOKEN_ADDRESS), NATIVE, WEEK] }) });
      setMsg("Sent. Waiting for the network…");
      await pub.waitForTransactionReceipt({ hash, timeout: 180_000 }).catch(() => null);
      setMsg("The Official pool is open. Reload the page, then use Add rewards on its card to share fees (in BNB).");
    } catch (e) { fail(e); }
    setBusy(false);
  }

  if (!info) return null;
  const live = info.contracts.bsc;
  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>Admin: staking</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Only you see this. Use the team wallet {info.treasury.slice(0, 8)}… (it owns the contract). The owner can only set a pool-opening fee (max 1 BNB); nobody can move staked tokens.</p>
      <div className="stack" style={{ gap: 6, fontSize: ".92em" }}>
        <b>1. Deploy on BNB Chain {live && <span className="up">(live: {live})</span>}</b>
        {!live && <button type="button" className="btn small primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={deploy}>Deploy staking</button>}
        <b>2. Open the Official pool (AUTISTIK → BNB)</b>
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy || !live} onClick={officialPool}>Open Official pool</button>
        <b>3. Share fees</b>
        <span className="muted">Each week, tap Add rewards on the Official pool card and send the share of trading fees you choose (e.g. 30–50%). It&apos;s paid out to stakers over 7 days. To let another wallet do this, use Manage on the card.</span>
        <span className="muted">Spam pools: tap Hide pool on any card. Members who staked in it still see it and can withdraw.</span>
      </div>
      {msg && <small className="muted" style={{ wordBreak: "break-all" }}>{msg}</small>}
    </div>
  );
}
