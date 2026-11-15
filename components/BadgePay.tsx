"use client";
/**
 * Get the AUTISTIK sticker badge: pay $1 of BNB (BNB Chain) to the AUTISTIK wallet for a year. The payment carries
 * your account id, so it can only count for you; the site checks it on-chain, then you pick your sticker.
 */
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, http } from "viem";
import { pickWallet } from "@/lib/connect";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { supabaseBrowser } from "@/lib/supabase/client";
import { badgeMemo } from "@/lib/badge-pay";
import { MoodSticker, STICKERS } from "@/components/mood/MoodStickers";

type Quote = { usd: number; days: number; treasury: `0x${string}`; wei: string };

export default function BadgePay({ until, onPaid }: { until?: string | null; onPaid?: (until: string) => void }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => { fetch("/api/badge/quote").then((r) => r.json().then((d) => (r.ok ? setQ(d) : setErr(d.error || "Badge payments aren't open yet.")))).catch(() => setErr("Couldn't load the price.")); }, []);
  const active = until && Date.parse(until) > Date.now();

  async function pay() {
    if (!q) return;
    const { data: { user } } = await supabaseBrowser().auth.getUser();
    if (!user) { window.location.href = "/login?next=/"; return; }
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const bsc = CHAINS.bsc, vchain = viemChain(bsc);
      const wallet = createWalletClient({ chain: vchain, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: vchain, transport: http(bsc.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: bsc.chainId }); } catch { await wallet.addChain({ chain: vchain }); await wallet.switchChain({ id: bsc.chainId }); }
      const fresh: Quote = await fetch("/api/badge/quote").then((r) => r.json());
      const value = BigInt(fresh.wei || q.wei);
      setStatus(`Confirm ${formatEther(value)} BNB (about $${fresh.usd || q.usd}) in your wallet…`);
      const hash = await wallet.sendTransaction({ account, chain: vchain, to: fresh.treasury || q.treasury, value, data: badgeMemo(user.id) });
      setStatus("Payment sent. Waiting for BNB Chain to confirm…");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The payment failed. Your BNB wasn't sent, but the network fee was spent."); return; }
      setStatus("Checking your payment…");
      const res = await fetch("/api/badge/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setStatus(`${d.error || "Couldn't confirm it."} Your payment: ${hash}`); return; }
      setStatus(`🎉 Your badge is on until ${new Date(d.until).toLocaleDateString()}. Pick your sticker!`);
      onPaid?.(d.until);
    } catch (e: any) {
      setStatus(e?.shortMessage || "You cancelled in your wallet. Nothing was paid.");
    } finally { setBusy(false); }
  }

  return (
    <div className="bpay">
      <div className="bpay-stk" aria-hidden="true">{STICKERS.slice(0, 6).map((s) => <MoodSticker key={s.key} k={s.key} size={30} />)}</div>
      <b className="bpay-h">{active ? "Your AUTISTIK badge" : "Get your AUTISTIK sticker badge"}</b>
      <small className="bpay-sub">{active ? `Active until ${new Date(until!).toLocaleDateString()}. Renew any time to add another year.` : "Pick one of the 10 stickers to show next to your name everywhere, with the verified check."}</small>
      {err ? <small className="bpay-err">{err}</small> : (
        <button type="button" className="bpay-btn" disabled={!q || busy} onClick={pay}>{busy ? "Working…" : `${active ? "Renew" : "Get it"}: $${q?.usd ?? 1} for ${Math.round((q?.days ?? 365) / 365) === 1 ? "1 year" : `${q?.days} days`}`}</button>
      )}
      <small className="bpay-fine">Paid in BNB on BNB Chain to the AUTISTIK wallet{q ? ` (${q.treasury.slice(0, 6)}…${q.treasury.slice(-4)})` : ""}. Needs a little extra BNB for the network fee.</small>
      {status && <small className="bpay-status" role="status">{status}</small>}
    </div>
  );
}
