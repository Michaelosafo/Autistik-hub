"use client";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, http } from "viem";
import { CHAINS, viemChain } from "@/lib/launchpad";

type Status = {
  usd: number; days: number; freeTries: number; freeLeft: number; passUntil: string | null; admin: boolean;
  dailyLimit: number; onSale: boolean; treasury: `0x${string}` | null; wei: string | null; tag: `0x${string}`;
};

/**
 * AI Pass card: shows free messages left today or when the pass ends, and lets a member pay in BNB from their wallet.
 * `refreshKey` reloads the status (the chat bumps it after each message). `highlight` makes it stand out when
 * today's free messages have just run out.
 */
export default function AIPass({ refreshKey = 0, highlight = false, onPaid }: { refreshKey?: number; highlight?: boolean; onPaid?: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [txHash, setTxHash] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    fetch("/api/ai-pass", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setS(d)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!s) return null;
  const bsc = CHAINS.bsc;
  const active = s.passUntil && Date.parse(s.passUntil) > Date.now();

  async function claim(hash: string) {
    setMsg("Checking your payment on BNB Chain…");
    const res = await fetch("/api/ai-pass", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(d.error || "Couldn't start your pass. Contact an admin with your transaction link."); return; }
    setMsg(`✅ Your AI Pass is active until ${new Date(d.passUntil).toLocaleDateString()}. Enjoy!`);
    setTxHash("");
    load();
    onPaid?.();
  }

  async function pay() {
    const eth = (window as any).ethereum;
    if (!eth) { setMsg("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet, then press Pay again."); return; }
    setBusy(true); setMsg("Check your wallet app…");
    try {
      const vchain = viemChain(bsc);
      const wallet = createWalletClient({ chain: vchain, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: vchain, transport: http(bsc.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: bsc.chainId }); } catch { await wallet.addChain({ chain: vchain }); await wallet.switchChain({ id: bsc.chainId }); }
      // Latest price, so the amount is right at the moment you pay.
      const fresh: Status = await fetch("/api/ai-pass", { cache: "no-store" }).then((r) => r.json());
      if (!fresh.onSale || !fresh.wei || !fresh.treasury) { setMsg("AI Passes aren't on sale right now. Try again later."); return; }
      const value = BigInt(fresh.wei);
      setMsg(`Confirm ${formatEther(value)} BNB in your wallet…`);
      // Your account id rides along with the payment, so only your account can use it.
      const hash = await wallet.sendTransaction({ account, chain: vchain, to: fresh.treasury, value, data: fresh.tag });
      setTxHash(hash);
      setMsg("Payment sent. Waiting for BNB Chain to confirm…");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setMsg("The payment failed. Your BNB wasn't sent, but the network fee was spent."); return; }
      await claim(hash);
    } catch (e: any) {
      setMsg(e?.shortMessage || "You cancelled in your wallet. Nothing was paid.");
    } finally { setBusy(false); }
  }

  async function copyWallet() {
    if (!s?.treasury) return;
    try { await navigator.clipboard.writeText(s.treasury); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  if (s.admin) return <div className="card stack" style={{ fontSize: ".9em" }}><h3>AI Pass</h3><p className="muted">You&apos;re an admin, so the AI is free for you.</p></div>;

  return (
    <div className="card stack" id="ai-pass" style={{ fontSize: ".9em", ...(highlight && !active ? { outline: "2px solid var(--accent, #7c5cff)" } : {}) }}>
      <h3>🎟️ AI Pass</h3>
      {active ? (
        <p>Your pass is active until <b>{new Date(s.passUntil!).toLocaleDateString()}</b>. Paying again adds {s.days} more days.</p>
      ) : (
        <p>{s.freeLeft > 0
          ? <>You have <b>{s.freeLeft} of {s.freeTries} free messages</b> left today. They reset every day. Want more? Get a pass.</>
          : <>You&apos;ve used today&apos;s {s.freeTries} free messages. They come back tomorrow, or get a pass to keep talking with Believer and Purity now.</>}</p>
      )}
      <table><tbody>
        <tr><th>Price</th><td className="num">${s.usd} in BNB{s.wei && <span className="muted"> (≈ {formatEther(BigInt(s.wei))} BNB)</span>}</td></tr>
        <tr><th>Lasts</th><td>{s.days} days</td></tr>
        <tr><th>Pay on</th><td>BNB Chain, from your wallet</td></tr>
      </tbody></table>
      {!s.onSale ? (
        <div className="notice warn" style={{ fontSize: ".9em" }}>AI Passes aren&apos;t on sale yet. Check back soon.</div>
      ) : (
        <>
          <button className="btn primary" type="button" disabled={busy} onClick={pay}>{busy ? "Working…" : `${active ? "Add" : "Get"} ${s.days} days for $${s.usd} in BNB`}</button>
          <div className="field">
            <span className="muted">Payments go to the AUTISTIK wallet</span>
            <span className="mono" style={{ overflowWrap: "anywhere", fontSize: ".85em" }}>{s.treasury}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" type="button" onClick={copyWallet}>{copied ? "Copied" : "Copy address"}</button>
              <a className="btn small" href={`${bsc.explorer}/address/${s.treasury}`} target="_blank" rel="noopener noreferrer">View on BscScan</a>
            </div>
          </div>
          <details>
            <summary style={{ cursor: "pointer" }}>Paid but the pass didn&apos;t start?</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <p className="muted" style={{ fontSize: ".9em" }}>Paste the transaction hash of a payment you made with the button above while signed in to this account. Payments sent by hand (for example, straight from an exchange) can&apos;t be matched to your account.</p>
              <input type="text" className="mono" placeholder="Transaction hash (0x…)" spellCheck={false} autoComplete="off" value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} />
              <button className="btn small" type="button" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(txHash)} onClick={async () => { setBusy(true); try { await claim(txHash); } finally { setBusy(false); } }}>Check my payment</button>
            </div>
          </details>
        </>
      )}
      {msg && <span className="muted" role="status">{msg}</span>}
      <p className="muted" style={{ fontSize: ".85em" }}>Up to {s.dailyLimit} messages a day. A picture counts as 5 messages. The Launch Pad guide (Autistik) stays free. Passes aren&apos;t refundable.</p>
    </div>
  );
}
