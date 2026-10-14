"use client";
import { useState } from "react";
import { createPublicClient, createWalletClient, custom, getAddress, http } from "viem";
import { CHAINS, LAUNCHPAD_ABI, viemChain, type ChainKey } from "@/lib/launchpad";

/** Lets the creator take their LP tokens back once the 6-month or 1-year lock has ended. */
export default function UnlockButton({ chain, token, creator, unlockAt }: { chain: ChainKey; token: string; creator: string; unlockAt: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const c = CHAINS[chain];
  const open = Date.parse(unlockAt) <= Date.now();

  async function unlock() {
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet."); return; }
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const vchain = viemChain(c);
      const wallet = createWalletClient({ chain: vchain, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: vchain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      if (getAddress(account) !== getAddress(creator)) { setStatus("Only the wallet that launched this token can take the liquidity back. Switch to that wallet."); return; }
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain: vchain }); await wallet.switchChain({ id: c.chainId }); }
      const [, , amount] = (await pub.readContract({ address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName: "locks", args: [token] } as any)) as [string, string, bigint, bigint];
      if (amount === 0n) { setStatus("This liquidity has already been taken back."); return; }
      setStatus("Confirm in your wallet…");
      const hash = await wallet.writeContract({ account, chain: vchain, address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName: "unlockLiquidity", args: [token] });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      setStatus(receipt.status === "success" ? "Done. The LP tokens are back in your wallet." : "That didn't go through. Nothing was moved, but the network fee was spent.");
    } catch (e: any) {
      setStatus(e?.shortMessage || "You cancelled in your wallet. Nothing was moved.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack" style={{ fontSize: ".9em" }}>
      <h3>🔒 Liquidity lock</h3>
      <p className="muted">
        {open
          ? <>The lock ended on <b>{new Date(unlockAt).toLocaleDateString()}</b>. The creator can now take the LP tokens back.</>
          : <>The LP tokens are locked in the Launch Pad contract until <b>{new Date(unlockAt).toLocaleDateString()}</b>. Nobody can remove them before then.</>}
      </p>
      {open && <button className="btn small" type="button" disabled={busy} onClick={unlock}>{busy ? "Working…" : "I'm the creator: take my LP back"}</button>}
      {status && <span className="muted">{status}</span>}
    </div>
  );
}
