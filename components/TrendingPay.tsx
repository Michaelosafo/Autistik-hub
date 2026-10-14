"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPublicClient, createWalletClient, custom, formatEther, http, isAddress } from "viem";
import { CHAINS, viemChain, type ChainKey } from "@/lib/launchpad";

type Quote = { usd: number; hours: number; treasury: `0x${string}`; bnbPrice: number; wei: string };

/** Chains a token can be listed from: DexScreener has to know the chain to find the token's pool. */
const LISTABLE = Object.values(CHAINS).filter((c) => c.dexscreener);

/**
 * Pay $20 of BNB to the AUTISTIK treasury wallet to put a token in Trending (and list it, if it was launched
 * somewhere else). With `chain` and `token` set it promotes that one token; otherwise the visitor types one in.
 */
export default function TrendingPay({ chain: fixedChain, token: fixedToken, promotedUntil }: { chain?: ChainKey; token?: string; promotedUntil?: string | null }) {
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [chain, setChain] = useState<ChainKey>(fixedChain || "bsc");
  const [token, setToken] = useState(fixedToken || "");
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/trending/quote").then((r) => r.json().then((d) => (r.ok ? setQuote(d) : setQuoteError(d.error || "Trending isn't available right now.")))).catch(() => setQuoteError("Couldn't load the price. Refresh the page."));
  }, []);

  const bsc = CHAINS.bsc;
  const tokenOk = isAddress(token.trim());
  const live = promotedUntil && Date.parse(promotedUntil) > Date.now();

  async function claim(hash: string) {
    setStatus("Checking your payment on BNB Chain…");
    const res = await fetch("/api/trending/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token: token.trim(), txHash: hash }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(data.error || "Couldn't start trending. Contact an admin with your transaction link."); return; }
    setStatus(`🔥 ${data.listed ? "Listed and trending" : "Trending"} until ${new Date(data.endsAt).toLocaleString()}.`);
    setTxHash("");
    router.refresh();
  }

  async function pay() {
    if (!quote || !tokenOk) return;
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("No wallet found. Open this page in the browser inside MetaMask or Trust Wallet, or send the BNB yourself and paste the transaction below."); return; }
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const vchain = viemChain(bsc);
      const wallet = createWalletClient({ chain: vchain, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: vchain, transport: http(bsc.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: bsc.chainId }); } catch { await wallet.addChain({ chain: vchain }); await wallet.switchChain({ id: bsc.chainId }); }
      // The latest price, so the amount is right at the moment you pay.
      const fresh: Quote = await fetch("/api/trending/quote").then((r) => r.json());
      const value = BigInt(fresh.wei || quote.wei);
      setStatus(`Confirm ${formatEther(value)} BNB in your wallet…`);
      // The token address rides along with the payment, so it can only ever count for this token.
      const hash = await wallet.sendTransaction({ account, chain: vchain, to: fresh.treasury || quote.treasury, value, data: token.trim().toLowerCase() as `0x${string}` });
      setStatus("Payment sent. Waiting for BNB Chain to confirm…");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The payment failed. Your BNB wasn't sent, but the network fee was spent."); return; }
      await claim(hash);
    } catch (e: any) {
      setStatus(e?.shortMessage || "You cancelled in your wallet. Nothing was paid.");
    } finally { setBusy(false); }
  }

  async function copyWallet() {
    if (!quote) return;
    try { await navigator.clipboard.writeText(quote.treasury); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  return (
    <div className="card stack">
      <h3>🔥 {fixedToken ? "Make it trend" : "Get your token listed & trending"}</h3>
      <p className="muted" style={{ fontSize: ".9em" }}>
        {fixedToken
          ? live ? <>Trending now until <b>{new Date(promotedUntil!).toLocaleString()}</b>. Paying again adds time.</> : "Put this token at the top of Trending and in the ad slot across the Hub."
          : "Any token with a trading pool can be listed here, even if it launched somewhere else. It goes to the top of Trending and into the ad slot across the Hub."}
      </p>

      {quoteError ? <div className="notice warn" style={{ fontSize: ".88em" }}>{quoteError}</div> : (
        <>
          <table><tbody>
            <tr><th>Price</th><td className="num">{quote ? <>${quote.usd} in BNB <span className="muted">(≈ {formatEther(BigInt(quote.wei))} BNB)</span></> : "…"}</td></tr>
            <tr><th>Trends for</th><td>{quote ? `${quote.hours} hours` : "…"}</td></tr>
            <tr><th>Pay on</th><td>BNB Chain, in BNB</td></tr>
          </tbody></table>
          <div className="field">
            <span>Payments go to this AUTISTIK wallet</span>
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{quote?.treasury || "…"}</span>
            {quote && <div className="row" style={{ gap: 6 }}>
              <button className="btn small" type="button" onClick={copyWallet}>{copied ? "Copied" : "Copy address"}</button>
              <a className="btn small" href={`${bsc.explorer}/address/${quote.treasury}`} target="_blank" rel="noopener noreferrer">View on BscScan</a>
            </div>}
          </div>

          {!fixedToken && (
            <div className="grid2" style={{ gap: 10 }}>
              <label className="field"><span>Token&apos;s chain</span>
                <select id="trendChain" value={chain} onChange={(e) => setChain(e.target.value as ChainKey)}>
                  {LISTABLE.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Token address</span>
                <input id="trendToken" type="text" className="mono" placeholder="0x…" spellCheck={false} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
              </label>
            </div>
          )}

          <button className="btn primary" type="button" disabled={!quote || !tokenOk || busy} onClick={pay}>
            {busy ? "Working…" : quote ? `Pay $${quote.usd} in BNB with my wallet` : "Loading price…"}
          </button>

          <details>
            <summary style={{ cursor: "pointer", fontSize: ".9em" }}>Already sent the BNB yourself? Claim it</summary>
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <p className="muted" style={{ fontSize: ".85em" }}>Send at least ${quote?.usd ?? 20} of BNB on BNB Chain to the wallet above, then paste the transaction hash. Payments older than 2 days can&apos;t be claimed.</p>
              <input id="trendTx" type="text" className="mono" placeholder="Transaction hash (0x…)" spellCheck={false} autoComplete="off" value={txHash} onChange={(e) => setTxHash(e.target.value.trim())} />
              <button className="btn small" type="button" disabled={!tokenOk || !/^0x[0-9a-fA-F]{64}$/.test(txHash) || busy} onClick={async () => { setBusy(true); try { await claim(txHash); } finally { setBusy(false); } }}>Claim my payment</button>
            </div>
          </details>
        </>
      )}
      {status && <span className="muted" style={{ fontSize: ".88em" }}>{status}</span>}
      <p className="muted" style={{ fontSize: ".8em" }}>Paid listings are labelled &quot;Promoted&quot;. Listing a token doesn&apos;t mean the AUTISTIK team checked or recommends it.</p>
    </div>
  );
}
