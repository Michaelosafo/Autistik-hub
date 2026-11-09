"use client";
/**
 * Swap by message in Believer's chat: "convert 1 SOL to USDT", "swap half my BNB to USDC on Base".
 * The server reads the request, finds the coins in the member's wallet, and compares routes on every network that
 * could do it (cheapest overall first). One tap on "Swap now" and the member's own wallet signs; for a swap across
 * networks the card follows the coins until they arrive. Nobody else ever holds the keys.
 */
import { useEffect, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from "viem";
import SignerScope from "@/components/wallet/SignerScope";
import type { Member, Signer } from "@/components/wallet/types";
import { addTrade, amt, api, friendlyError, raw2num, sendSol, store, usd } from "@/components/wallet/util";
import { XCHAINS, lifiDiamond, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";
import { IMPACT_BLOCK, IMPACT_CONFIRM } from "@/lib/wallet-chains";
import { toast } from "@/lib/toast";

type Option = { quote: XQuote; fromToken: XToken; toToken: XToken; amount: string; costUsd: number | null; netUsd: number | null };
type Plan = { ask: { from: string; to: string }; options: Option[]; skipped: string[]; note: string | null };

const pc = (c: XChain): any => createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 10_000 }) });
const mins = (s: number | null) => (s == null ? "–" : s < 60 ? `~${Math.max(5, Math.round(s / 5) * 5)}s` : `~${Math.round(s / 60)} min`);
async function waitTx(c: XChain, hash: `0x${string}`) {
  const r = await pc(c).waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The transaction failed on the network. Nothing was sent (only the network fee was used).");
}

export default function SwapBot({ text, auto = true, appId, member, signedIn }: { text: string; auto?: boolean; appId: string | null; member: Member | null; signedIn: boolean }) {
  // An older request in the history waits for a tap, so reopening a chat doesn't fetch routes for every old swap.
  const [on, setOn] = useState(auto);
  if (!on) return <div className="tb sb"><div className="row" style={{ gap: 8, alignItems: "center" }}><span className="grow">Swap: “{text}”</span><button type="button" className="btn" onClick={() => setOn(true)}>Get fresh routes</button></div></div>;
  if (!signedIn) return <div className="tb"><p className="tb-q">Sign in to swap with your wallet.</p></div>;
  return (
    <div className="tb sb">
      <SignerScope appId={appId} member={member}>{(signer) => <Flow text={text} signer={signer} />}</SignerScope>
    </div>
  );
}

function Flow({ text, signer }: { text: string; signer: Signer }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(0);
  const [ack, setAck] = useState(false);
  const [step, setStep] = useState("");
  const [done, setDone] = useState<{ text: string; link?: string; pending?: boolean; failed?: string } | null>(null);
  const asked = useRef(false);
  const evm = signer.evm?.address ?? null, sol = signer.sol?.address ?? null;

  useEffect(() => {
    if (asked.current || !signer.ready || (!evm && !sol)) return;
    asked.current = true;
    api<{ plan: Plan }>("x-plan", { text, evm, sol }).then((d) => setPlan(d.plan)).catch((e) => setErr(e.message || "Couldn't plan that swap."));
  }, [signer.ready, evm, sol, text]);

  if (!signer.ready) return <div className="tb-load"><span className="aw-spin" />Opening your wallet…</div>;
  if (!evm && !sol) return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="tb-q">Connect your wallet and I'll do this swap for you.</p>
      <button type="button" className="tx-cta convert" onClick={signer.loginEmbedded ?? signer.login}>Connect wallet</button>
    </div>
  );
  if (err) return <div className="tb-err"><b>Can't swap that yet</b><p>{err}</p></div>;
  if (!plan) return <div className="tb-load"><span className="aw-spin" />Finding the cheapest way to swap on every network…</div>;

  const o = plan.options[pick];
  const from = XCHAINS[o.quote.fromChain], to = XCHAINS[o.quote.toChain];
  const cross = from.id !== to.id;
  const out = raw2num(o.quote.toAmount, o.toToken.decimals), minOut = raw2num(o.quote.toAmountMin, o.toToken.decimals);
  const impact = o.quote.fromUsd && o.quote.toUsd ? Math.max(0, ((o.quote.fromUsd - o.quote.toUsd) / o.quote.fromUsd) * 100) : null;
  const limit = store.get<number | null>("aw-limit", null);
  const blocked = impact != null && impact >= IMPACT_BLOCK ? `You'd lose ${impact.toFixed(0)}% of the value on this route. Try a smaller amount.`
    : limit && o.quote.fromUsd && o.quote.fromUsd > limit ? `This swap (${usd(o.quote.fromUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Wallet → Security.` : "";
  const needAck = impact != null && impact >= IMPACT_CONFIRM;
  const what = `${amt(Number(o.amount))} ${o.fromToken.symbol} → ${amt(out)} ${o.toToken.symbol}`;

  async function go() {
    setStep(""); setDone(null);
    try {
      let x = o.quote;
      if (Date.now() - x.at > 45_000) {
        setStep("Checking the price again…");
        const stable = /USD/.test(o.fromToken.symbol) && /USD/.test(o.toToken.symbol);
        x = (await api<{ quote: XQuote }>("x-quote", { fromChain: x.fromChain, toChain: x.toChain, fromToken: x.fromToken, toToken: x.toToken, amount: x.fromAmount, fromAddress: x.fromAddress, toAddress: x.toAddress, slippageBps: stable ? 50 : 100 })).quote;
        if (BigInt(x.toAmountMin) * 100n < BigInt(o.quote.toAmountMin) * 99n) {
          setPlan((p) => p && { ...p, options: p.options.map((y, i) => (i === pick ? { ...y, quote: x } : y)) });
          setStep(""); setErr(""); toast({ kind: "info", title: "The price moved", text: "Check the new amount and tap Swap again." });
          return;
        }
      }
      let hash: string;
      if (from.kind === "solana") {
        if (!x.sol || !signer.sol) throw new Error("Connect a Solana wallet.");
        setStep("Approve in your wallet…");
        hash = await sendSol(signer, x.sol);
      } else {
        const ev = signer.evm, tx = x.evm;
        if (!ev || !tx) throw new Error(`Connect a ${from.name} wallet.`);
        if (getAddress(tx.to) !== getAddress(lifiDiamond(from.id)) || (tx.spender && getAddress(tx.spender) !== getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
        if (tx.spender) {
          const have: bigint = await pc(from).readContract({ address: o.fromToken.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
          if (have < BigInt(x.fromAmount)) {
            setStep(`Step 1 of 2: allow the swap to use your ${o.fromToken.symbol}…`);
            const h = await ev.send(from.id, { to: o.fromToken.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(x.fromAmount)] }) });
            await waitTx(from, h);
          }
          setStep("Step 2 of 2: confirm in your wallet…");
        } else setStep("Confirm in your wallet…");
        const h = await ev.send(from.id, { to: tx.to, data: tx.data, value: tx.value });
        setStep(`Waiting for ${from.name}…`);
        await waitTx(from, h);
        hash = h;
      }
      addTrade({ at: Date.now(), chain: from.key, side: "convert", pay: `${o.amount} ${o.fromToken.symbol} (${from.name})`, get: `${amt(out)} ${o.toToken.symbol} (${to.name})`, hash });
      setStep("");
      const link = `${from.explorer}/tx/${hash}`;
      if (!cross) { setDone({ text: `Done: ${what} on ${from.name}.`, link }); toast({ kind: "ok", title: "Swap done", text: what }); return; }
      setDone({ text: `Sent on ${from.name}. Your ${o.toToken.symbol} arrives on ${to.name} in ${mins(x.seconds)}.`, link, pending: true });
      for (let i = 0; i < 360; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const { status: s } = await api<{ status: { status: string; receiveHash: string | null; link: string | null; message: string | null } }>("x-status", { hash, fromChain: from.id, toChain: to.id, tool: x.tool })
          .catch(() => ({ status: { status: "pending", receiveHash: null, link: null, message: null } }));
        if (s.status === "done") {
          setDone({ text: `Arrived: ${what} on ${to.name}.`, link: s.receiveHash ? `${to.explorer}/tx/${s.receiveHash}` : link });
          toast({ kind: "ok", title: `Swap done: arrived on ${to.name}`, text: what });
          return;
        }
        if (s.status === "failed" || s.status === "refunded") {
          const failed = s.status === "refunded" ? "The transfer didn't go through and your coins were refunded." : s.message || "The transfer failed. If your coins don't come back soon, open the tracker.";
          setDone({ text: failed, link: s.link || link, failed });
          return;
        }
      }
    } catch (e: any) {
      const m = friendlyError(e, from.native.symbol);
      setStep(""); setDone({ text: m, failed: m });
    }
  }

  return (
    <div className="stack sb-flow" style={{ gap: 10 }}>
      <div className="sb-head"><b>Swap {amt(Number(o.amount))} {o.fromToken.symbol}</b> to <b>{o.toToken.symbol}</b>{plan.note && <small>{plan.note}</small>}</div>
      {plan.options.length > 1 && (
        <div className="sb-opts" role="radiogroup" aria-label="Routes">
          {plan.options.map((y, i) => {
            const f = XCHAINS[y.quote.fromChain], t = XCHAINS[y.quote.toChain];
            return (
              <button key={i} type="button" role="radio" aria-checked={i === pick} className={"sb-opt" + (i === pick ? " on" : "")} disabled={!!step || !!done} onClick={() => { setPick(i); setAck(false); }}>
                <span className="sb-route">{f.name}{f.id !== t.id ? ` → ${t.name}` : ""}{i === 0 && <em>Cheapest</em>}</span>
                <span>≈ {amt(raw2num(y.quote.toAmount, y.toToken.decimals))} {y.toToken.symbol}</span>
                <small>fees ≈ {y.costUsd != null ? usd(y.costUsd) : "–"}</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="aw-details">
        <div><span>You pay</span><b>{amt(Number(o.amount))} {o.fromToken.symbol} on {from.name}{o.quote.fromUsd ? ` (${usd(o.quote.fromUsd)})` : ""}</b></div>
        <div><span>You get (about)</span><b>{amt(out)} {o.toToken.symbol} on {to.name}{o.quote.toUsd ? ` (${usd(o.quote.toUsd)})` : ""}</b></div>
        <div><span>At least</span><b>{amt(minOut)} {o.toToken.symbol}</b></div>
        <div><span>Network fee</span><b>≈ {o.quote.gasUsd != null ? usd(o.quote.gasUsd) : "–"}</b></div>
        {o.quote.feeUsd != null && <div><span>Bridge fee</span><b>≈ {usd(o.quote.feeUsd)}</b></div>}
        <div><span>Route</span><b>{o.quote.toolName}{cross ? ` · ${mins(o.quote.seconds)}` : ""}</b></div>
        <div><span>To</span><b>Your wallet</b></div>
      </div>
      {plan.skipped.map((s) => <small key={s} className="muted">{s}</small>)}
      {blocked && <div className="aw-risk danger">{blocked}</div>}
      {needAck && !blocked && !done && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand I lose {impact!.toFixed(1)}% of the value and want to continue.</label>}
      {done ? (
        <div className={"sx-track" + (done.failed ? " bad" : done.pending ? "" : " ok")} role="status">
          <div>{done.pending && <span className="aw-spin" />}{done.text} {done.link && <a href={done.link} target="_blank" rel="noopener noreferrer">View ↗</a>}</div>
          {done.failed && !done.link && <button type="button" className="btn" onClick={() => setDone(null)}>Try again</button>}
        </div>
      ) : step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : (
        <button type="button" className="tx-cta convert" disabled={!!blocked || (needAck && !ack)} onClick={go}>Swap now</button>
      )}
    </div>
  );
}
