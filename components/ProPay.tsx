"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, encodeFunctionData, erc20Abi, formatUnits, http } from "viem";
import { CHAINS, viemChain } from "@/lib/launchpad";

type Status = { usd: number; days: number; proUntil: string | null; signedIn: boolean; onSale: boolean; treasury: string | null; token: string; decimals: number; units: string | null; tag: string | null };
const fmt = (units: string, dec: number) => Number(formatUnits(BigInt(units), dec)).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Pay for AUTISTIK Pro in $AUTISTIK from your wallet (BNB Chain), or paste a payment you already made. */
export default function ProPay() {
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const load = useCallback(() => fetch("/api/pro", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function claim(hash: string) {
    setMsg("Checking your payment on BNB Chain…");
    const r = await fetch("/api/pro", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash.trim() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(d.error || "Couldn't start Pro. Contact an admin with your transaction link."); return; }
    setMsg(`✅ AUTISTIK Pro is active until ${new Date(d.proUntil).toLocaleDateString()}. Enjoy!`);
    setTxHash(""); load();
  }

  async function pay() {
    const eth = (window as any).ethereum;
    if (!eth) { setMsg("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet, then press Pay again."); return; }
    setBusy(true); setMsg("Check your wallet app…");
    try {
      const bsc = CHAINS.bsc, chain = viemChain(bsc);
      const wallet = createWalletClient({ chain, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain, transport: http(bsc.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: bsc.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: bsc.chainId }); }
      // Latest price, so the amount is right at the moment you pay.
      const fresh: Status = await fetch("/api/pro", { cache: "no-store" }).then((r) => r.json());
      if (!fresh.onSale || !fresh.units || !fresh.treasury || !fresh.tag) { setMsg("Pro isn't on sale right now. Try again later."); return; }
      // A normal $AUTISTIK transfer to the treasury, with your account id added at the end so only you can use it.
      const data = (encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [fresh.treasury as `0x${string}`, BigInt(fresh.units)] }) + fresh.tag.slice(2)) as `0x${string}`;
      setMsg(`Confirm ${fmt(fresh.units, fresh.decimals)} $AUTISTIK in your wallet…`);
      const hash = await wallet.sendTransaction({ account, chain, to: fresh.token, data });
      setTxHash(hash);
      setMsg("Payment sent. Waiting for BNB Chain to confirm…");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setMsg("The payment failed. Your $AUTISTIK wasn't sent, but the network fee was spent."); return; }
      await claim(hash);
    } catch (e: any) {
      setMsg(e?.shortMessage || "You cancelled in your wallet. Nothing was paid.");
    } finally { setBusy(false); }
  }

  if (!s) return <div className="muted">Loading…</div>;
  const active = s.proUntil && Date.parse(s.proUntil) > Date.now();
  return (
    <div className="stack" style={{ gap: 10 }}>
      {active && <div className="notice">💎 You have Pro until {Date.parse(s.proUntil!) > Date.parse("2090-01-01") ? "forever (admin)" : new Date(s.proUntil!).toLocaleDateString()}. Paying again adds {s.days} more days.</div>}
      {!s.signedIn ? <Link className="btn primary" href="/login?next=/pro">Sign in to get Pro</Link>
        : !s.onSale ? <div className="notice warn">Pro goes on sale very soon. Check back shortly.</div>
        : (
          <>
            <div className="pro-price"><b>${s.usd}</b> for {s.days} days · about <b>{s.units ? fmt(s.units, s.decimals) : "…"} $AUTISTIK</b> at today&apos;s price</div>
            <button className="btn primary" type="button" onClick={pay} disabled={busy}>{busy ? "Working…" : `💎 Pay with $AUTISTIK`}</button>
            <details>
              <summary className="muted">Already paid? Paste the transaction</summary>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <input value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="0x… transaction hash" style={{ flex: 1, minWidth: 0 }} />
                <button className="btn small" type="button" disabled={!txHash.trim()} onClick={() => claim(txHash)}>Check</button>
              </div>
            </details>
          </>
        )}
      {msg && <div className="muted" style={{ fontSize: ".9em" }}>{msg}</div>}
    </div>
  );
}
