"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, createWalletClient, custom, formatUnits, http } from "viem";
import { CHAINS, LAUNCHPAD_ABI, PLANS, STABLE_ABI, viemChain, type ChainKey } from "@/lib/launchpad";

type Price = { id: number; label: string; price: bigint; duration: bigint };

/** Pay in the chain's stablecoin (e.g. USDT) to show this token as trending. Money goes straight to the treasury. */
export default function PromoteCard({ chain, token, promotedUntil }: { chain: ChainKey; token: `0x${string}`; promotedUntil: string | null }) {
  const c = CHAINS[chain];
  const router = useRouter();
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [stable, setStable] = useState<{ address: `0x${string}`; symbol: string; decimals: number } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
  const read = (address: `0x${string}`, abi: any, functionName: string, args: any[] = []) => pub.readContract({ address, abi, functionName, args });

  useEffect(() => {
    (async () => {
      const address = (await read(c.launchpad!, LAUNCHPAD_ABI, "stablecoin")) as `0x${string}`;
      const [symbol, decimals] = await Promise.all([read(address, STABLE_ABI, "symbol"), read(address, STABLE_ABI, "decimals")]);
      setStable({ address, symbol, decimals: Number(decimals) });
      const list = await Promise.all(PLANS.map(async (p) => {
        const [price, duration] = (await read(c.launchpad!, LAUNCHPAD_ABI, "plans", [BigInt(p.id)])) as [bigint, bigint];
        return { ...p, price, duration };
      }));
      setPrices(list.filter((p) => p.duration > 0n));
    })().catch(() => setStatus("Couldn't load trending prices. Refresh to try again."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);

  async function buy(p: Price) {
    const eth = (window as any).ethereum;
    if (!eth || !stable) { setStatus("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet."); return; }
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const vchain = viemChain(c);
      const wallet = createWalletClient({ chain: vchain, transport: custom(eth) }) as any;
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain: vchain }); await wallet.switchChain({ id: c.chainId }); }
      const bal = (await read(stable.address, STABLE_ABI, "balanceOf", [account])) as bigint;
      if (bal < p.price) { setStatus(`You need ${formatUnits(p.price, stable.decimals)} ${stable.symbol} on ${c.name}. You have ${formatUnits(bal, stable.decimals)}.`); return; }

      const allowance = (await read(stable.address, STABLE_ABI, "allowance", [account, c.launchpad])) as bigint;
      if (allowance < p.price) {
        // USDT on Ethereum refuses to change a non-zero allowance, so reset it first.
        if (allowance > 0n) {
          setStatus(`Step 1 of 3: reset your ${stable.symbol} approval…`);
          await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ account, chain: vchain, address: stable.address, abi: STABLE_ABI, functionName: "approve", args: [c.launchpad, 0n] }) });
        }
        setStatus(`Approve ${formatUnits(p.price, stable.decimals)} ${stable.symbol} in your wallet…`);
        await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ account, chain: vchain, address: stable.address, abi: STABLE_ABI, functionName: "approve", args: [c.launchpad, p.price] }) });
      }
      setStatus("Confirm the trending payment in your wallet…");
      const call = { account, address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName: "promote", args: [token, BigInt(p.id)] };
      const gas = ((await pub.estimateContractGas(call)) * 125n) / 100n;
      const hash = await wallet.writeContract({ ...call, chain: vchain, gas });
      setStatus("Payment sent. Starting your trending slot…");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The payment failed. Your stablecoin wasn't taken, but the network fee was spent."); return; }
      const res = await fetch("/api/launchpad/promote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, txHash: hash }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus(data.error || "Paid, but trending didn't start. Contact an admin with your transaction link."); return; }
      setStatus(`🔥 Trending until ${new Date(data.endsAt).toLocaleString()}.`);
      router.refresh();
    } catch (e: any) {
      setStatus(e?.shortMessage || "You cancelled in your wallet. Nothing was paid.");
    } finally { setBusy(false); }
  }

  const live = promotedUntil && Date.parse(promotedUntil) > Date.now();
  return (
    <div className="card stack">
      <h3>🔥 Make it trend</h3>
      <p className="muted" style={{ fontSize: ".9em" }}>
        Put this token at the top of Trending and in the ad slot across the Launch Pad. {live ? <>Trending now until <b>{new Date(promotedUntil!).toLocaleString()}</b>. Buying more adds time.</> : "It drops off automatically when the time is up."}
      </p>
      {!prices ? <span className="muted">{status || "Loading prices…"}</span> : (
        <div className="row">
          {prices.map((p) => (
            <button key={p.id} className="btn primary" type="button" disabled={busy} onClick={() => buy(p)}>
              {p.label} · ${Number(formatUnits(p.price, stable!.decimals)).toLocaleString("en-US")}
            </button>
          ))}
        </div>
      )}
      {stable && <span className="muted" style={{ fontSize: ".82em" }}>Paid in {stable.symbol} on {c.name}. Anyone can promote a Launch Pad token. Paid slots are labelled &quot;Promoted&quot; and &quot;Ad&quot;.</span>}
      {prices && status && <span className="muted" style={{ fontSize: ".88em" }}>{status}</span>}
    </div>
  );
}
