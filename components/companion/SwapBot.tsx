"use client";
/**
 * Swap by message in Believer's chat: "convert 1 SOL to USDT", "sell $1 of AUTISTIK", "swap half my BNB to USDC on Base".
 * The server reads the request, finds the coins in the member's wallet and compares routes (the Wallet's own engine on
 * one network, LI.FI on one or across networks), best after fees first.
 * Normally one tap on "Swap now". If the message says "approved" (or "confirm", "go ahead"), it runs by itself: the
 * built-in AUTISTIK wallet signs without its confirm window; other wallets (MetaMask, Phantom…) still ask in their own.
 * Safety stops still apply: the member's per-trade limit, big value loss, and honeypots.
 */
import { useEffect, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from "viem";
import SignerScope from "@/components/wallet/SignerScope";
import type { Member, Signer } from "@/components/wallet/types";
import { addTrade, amt, api, friendlyError, raw2num, runTrade, sendSol, store, usd, type Quote } from "@/components/wallet/util";
import { XCHAINS, lifiDiamond, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";
import { IMPACT_BLOCK, IMPACT_CONFIRM, WCHAINS, type WChainKey } from "@/lib/wallet-chains";
import { claimAuto } from "@/lib/auto-trade";
import { isApproved } from "@/lib/swap-read";
import { toast } from "@/lib/toast";

type Option = {
  via: "lifi" | "engine"; fromChain: number; toChain: number; fromToken: XToken; toToken: XToken; amount: string; amountIn: string;
  toAmount: string; toAmountMin: string | null; fromUsd: number | null; toUsd: number | null; gasUsd: number | null; feeUsd: number | null;
  tool: string; seconds: number | null; slipBps: number; costUsd: number | null; netUsd: number | null;
  quote: XQuote | null; engine: { chain: WChainKey; q: Quote } | null; at: number;
};
type Plan = { ask: { from: string; to: string }; options: Option[]; skipped: string[]; note: string | null };

const pc = (c: XChain): any => createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 10_000 }) });
const mins = (s: number | null) => (s == null ? "–" : s < 60 ? `~${Math.max(5, Math.round(s / 5) * 5)}s` : `~${Math.round(s / 60)} min`);
async function waitTx(c: XChain, hash: `0x${string}`) {
  const r = await pc(c).waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The transaction failed on the network. Nothing was sent (only the network fee was used).");
}

export default function SwapBot({ text, at, latest = true, appId, member, signedIn }: { text: string; at?: number; latest?: boolean; appId: string | null; member: Member | null; signedIn: boolean }) {
  // An older request in the history waits for a tap, so reopening a chat doesn't fetch routes for every old swap.
  const [on, setOn] = useState(latest);
  if (!on) return <div className="tb sb"><div className="row" style={{ gap: 8, alignItems: "center" }}><span className="grow">Swap: “{text}”</span><button type="button" className="btn" onClick={() => setOn(true)}>Get fresh routes</button></div></div>;
  if (!signedIn) return <div className="tb"><p className="tb-q">Sign in to swap with your wallet.</p></div>;
  return (
    <div className="tb sb">
      <SignerScope appId={appId} member={member}>{(signer) => <Flow text={text} at={latest ? at : undefined} signer={signer} />}</SignerScope>
    </div>
  );
}

function Flow({ text, at, signer }: { text: string; at?: number; signer: Signer }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(0);
  const [ack, setAck] = useState(false);
  const [step, setStep] = useState("");
  const [done, setDone] = useState<{ text: string; link?: string; pending?: boolean; failed?: string } | null>(null);
  const [autoNote, setAutoNote] = useState("");
  const asked = useRef(false), fired = useRef(false);
  const evm = signer.evm?.address ?? null, sol = signer.sol?.address ?? null;
  const approved = isApproved(text);

  useEffect(() => {
    if (asked.current || !signer.ready || (!evm && !sol)) return;
    asked.current = true;
    api<{ plan: Plan }>("x-plan", { text, evm, sol }).then((d) => setPlan(d.plan)).catch((e) => setErr(e.message || "Couldn't plan that swap."));
  }, [signer.ready, evm, sol, text]);

  const o = plan?.options[pick];
  const from = o ? XCHAINS[o.fromChain] : null, to = o ? XCHAINS[o.toChain] : null;
  const out = o ? raw2num(o.toAmount, o.toToken.decimals) : 0;
  const impact = o?.fromUsd && o.toUsd ? Math.max(0, ((o.fromUsd - o.toUsd) / o.fromUsd) * 100) : null;
  const limit = store.get<number | null>("aw-limit", null);
  const blocked = !o ? "" : impact != null && impact >= IMPACT_BLOCK ? `You'd lose ${impact.toFixed(0)}% of the value on this route. Try a smaller amount.`
    : limit && o.fromUsd && o.fromUsd > limit ? `This swap (${usd(o.fromUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Wallet → Security.` : "";
  const needAck = impact != null && impact >= IMPACT_CONFIRM;

  // "approved …": run the best route by itself, once, when nothing needs a second look.
  useEffect(() => {
    if (!approved || !plan || !o || fired.current || step || done) return;
    fired.current = true;
    if (blocked || needAck) { setAutoNote("I didn't run this by itself: check the warning below first."); return; }
    if (!claimAuto(at)) return; // an old message (reopened chat): wait for a tap
    const quiet = from?.kind === "solana" ? !!signer.quiet?.sol : !!signer.quiet?.evm;
    setAutoNote(quiet ? "You approved this in your message, so I'm doing it now." : "You approved this in your message. Your wallet will still ask you to confirm in its own window.");
    go(true);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!signer.ready) return <div className="tb-load"><span className="aw-spin" />Opening your wallet…</div>;
  if (!evm && !sol) return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="tb-q">Connect your wallet and I&apos;ll do this swap for you.</p>
      <button type="button" className="tx-cta convert" onClick={signer.loginEmbedded ?? signer.login}>Connect wallet</button>
    </div>
  );
  if (err) return <div className="tb-err"><b>Can&apos;t swap that yet</b><p>{err}</p></div>;
  if (!plan || !o || !from || !to) return <div className="tb-load"><span className="aw-spin" />{approved ? "Approved. Finding the best price…" : "Finding the cheapest way to swap…"}</div>;
  const cross = from.id !== to.id;
  const what = `${amt(Number(o.amount))} ${o.fromToken.symbol} → ${amt(out)} ${o.toToken.symbol}`;

  async function go(auto = false) {
    if (!o || !from || !to) return;
    setDone(null);
    // Approved in the message: the built-in wallet signs without its window. Otherwise the normal signer.
    const s: Signer = auto && signer.quiet ? { ...signer, evm: signer.quiet.evm ?? signer.evm, sol: signer.quiet.sol ?? signer.sol } : signer;
    try {
      let hash: string;
      if (o.via === "engine" && o.engine) {
        const c = WCHAINS[o.engine.chain];
        let q = o.engine.q;
        const tin = q.tokenIn;
        if (Date.now() - o.at > 45_000) {
          setStep("Checking the price again…");
          const fresh = (await api<{ quote: Quote }>("quote", { chain: c.key, tokenIn: q.tokenIn, tokenOut: q.tokenOut, amount: q.amountIn })).quote;
          if (BigInt(fresh.amountOut) * 100n < BigInt(q.amountOut) * 97n) { setStep(""); setDone({ text: "The price moved more than 3%. Check the new amount and tap Swap again.", failed: "moved" }); return; }
          q = fresh;
        }
        const owner = (c.kind === "solana" ? s.sol?.address : s.evm?.address) || "";
        hash = await runTrade(c, s, owner, q, { address: tin, symbol: o.fromToken.symbol, name: o.fromToken.name, decimals: o.fromToken.decimals }, o.slipBps, setStep);
      } else {
        let x = o.quote!;
        if (Date.now() - x.at > 45_000) {
          setStep("Checking the price again…");
          x = (await api<{ quote: XQuote }>("x-quote", { fromChain: x.fromChain, toChain: x.toChain, fromToken: x.fromToken, toToken: x.toToken, amount: x.fromAmount, fromAddress: x.fromAddress, toAddress: x.toAddress, slippageBps: o.slipBps })).quote;
          if (BigInt(x.toAmountMin) * 100n < BigInt(o.quote!.toAmountMin) * 99n) { setStep(""); setDone({ text: "The price moved. Check the new amount and tap Swap again.", failed: "moved" }); return; }
        }
        if (from.kind === "solana") {
          if (!x.sol || !s.sol) throw new Error("Connect a Solana wallet.");
          setStep(auto && signer.quiet?.sol ? "Swapping…" : "Approve in your wallet…");
          hash = await sendSol(s, x.sol);
        } else {
          const ev = s.evm, tx = x.evm;
          if (!ev || !tx) throw new Error(`Connect a ${from.name} wallet.`);
          if (getAddress(tx.to) !== getAddress(lifiDiamond(from.id)) || (tx.spender && getAddress(tx.spender) !== getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
          if (tx.spender) {
            const have: bigint = await pc(from).readContract({ address: o.fromToken.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
            if (have < BigInt(x.fromAmount)) {
              setStep(`Step 1 of 2: allowing the swap to use your ${o.fromToken.symbol}…`);
              const h = await ev.send(from.id, { to: o.fromToken.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(x.fromAmount)] }) });
              await waitTx(from, h);
            }
            setStep("Step 2 of 2: swapping…");
          } else setStep(auto ? "Swapping…" : "Confirm in your wallet…");
          const h = await ev.send(from.id, { to: tx.to, data: tx.data, value: tx.value });
          setStep(`Waiting for ${from.name}…`);
          await waitTx(from, h);
          hash = h;
        }
        if (cross) {
          addTrade({ at: Date.now(), chain: from.key, side: "convert", pay: `${o.amount} ${o.fromToken.symbol} (${from.name})`, get: `${amt(out)} ${o.toToken.symbol} (${to.name})`, hash });
          setStep("");
          const link = `${from.explorer}/tx/${hash}`;
          setDone({ text: `Sent on ${from.name}. Your ${o.toToken.symbol} arrives on ${to.name} in ${mins(x.seconds)}.`, link, pending: true });
          for (let i = 0; i < 360; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            const { status: st } = await api<{ status: { status: string; receiveHash: string | null; link: string | null; message: string | null } }>("x-status", { hash, fromChain: from.id, toChain: to.id, tool: x.tool })
              .catch(() => ({ status: { status: "pending", receiveHash: null, link: null, message: null } }));
            if (st.status === "done") { setDone({ text: `Arrived: ${what} on ${to.name}.`, link: st.receiveHash ? `${to.explorer}/tx/${st.receiveHash}` : link }); toast({ kind: "ok", title: `Swap done: arrived on ${to.name}`, text: what }); return; }
            if (st.status === "failed" || st.status === "refunded") {
              const failed = st.status === "refunded" ? "The transfer didn't go through and your coins were refunded." : st.message || "The transfer failed. If your coins don't come back soon, open the tracker.";
              setDone({ text: failed, link: st.link || link, failed }); return;
            }
          }
          return;
        }
      }
      addTrade({ at: Date.now(), chain: from.key, side: "convert", pay: `${o.amount} ${o.fromToken.symbol}`, get: `${amt(out)} ${o.toToken.symbol}`, hash });
      setStep("");
      setDone({ text: `Done: ${what} on ${from.name}.`, link: `${from.explorer}/tx/${hash}` });
      toast({ kind: "ok", title: "Swap done", text: what });
    } catch (e: any) {
      const m = friendlyError(e, from.native.symbol);
      setStep(""); setDone({ text: m, failed: m });
    }
  }

  return (
    <div className="stack sb-flow" style={{ gap: 10 }}>
      <div className="sb-head"><b>Swap {amt(Number(o.amount))} {o.fromToken.symbol}</b> to <b>{o.toToken.symbol}</b>{plan.note && <small>{plan.note}</small>}</div>
      {autoNote && <div className="sb-auto">{autoNote}</div>}
      {plan.options.length > 1 && (
        <div className="sb-opts" role="radiogroup" aria-label="Routes">
          {plan.options.map((y, i) => {
            const f = XCHAINS[y.fromChain], t = XCHAINS[y.toChain];
            return (
              <button key={i} type="button" role="radio" aria-checked={i === pick} className={"sb-opt" + (i === pick ? " on" : "")} disabled={!!step || !!done} onClick={() => { setPick(i); setAck(false); }}>
                <span className="sb-route">{f.name}{f.id !== t.id ? ` → ${t.name}` : ""}{i === 0 && <em>Best</em>}</span>
                <span>≈ {amt(raw2num(y.toAmount, y.toToken.decimals))} {y.toToken.symbol}</span>
                <small>{y.tool} · fees ≈ {y.costUsd != null ? usd(y.costUsd) : "–"}</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="aw-details">
        <div><span>You pay</span><b>{amt(Number(o.amount))} {o.fromToken.symbol} on {from.name}{o.fromUsd ? ` (${usd(o.fromUsd)})` : ""}</b></div>
        <div><span>You get (about)</span><b>{amt(out)} {o.toToken.symbol} on {to.name}{o.toUsd ? ` (${usd(o.toUsd)})` : ""}</b></div>
        {o.toAmountMin && <div><span>At least</span><b>{amt(raw2num(o.toAmountMin, o.toToken.decimals))} {o.toToken.symbol}</b></div>}
        <div><span>Network fee</span><b>≈ {o.gasUsd != null ? usd(o.gasUsd) : "–"}</b></div>
        {o.feeUsd != null && <div><span>Bridge fee</span><b>≈ {usd(o.feeUsd)}</b></div>}
        <div><span>Route</span><b>{o.tool}{cross ? ` · ${mins(o.seconds)}` : ""}</b></div>
        <div><span>Slippage allowed</span><b>{(o.slipBps / 100).toFixed(1)}%</b></div>
        <div><span>To</span><b>Your wallet</b></div>
      </div>
      {plan.skipped.map((x) => <small key={x} className="muted">{x}</small>)}
      {blocked && <div className="aw-risk danger">{blocked}</div>}
      {needAck && !blocked && !done && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand I lose {impact!.toFixed(1)}% of the value and want to continue.</label>}
      {done ? (
        <div className={"sx-track" + (done.failed ? " bad" : done.pending ? "" : " ok")} role="status">
          <div>{done.pending && <span className="aw-spin" />}{done.text} {done.link && <a href={done.link} target="_blank" rel="noopener noreferrer">View ↗</a>}</div>
          {done.failed && !done.link && <button type="button" className="btn" onClick={() => { setDone(null); setPlan(null); setErr(""); asked.current = false; setPick(0); api<{ plan: Plan }>("x-plan", { text, evm, sol }).then((d) => setPlan(d.plan)).catch((e) => setErr(e.message)); }}>Try again</button>}
        </div>
      ) : step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : (
        <button type="button" className="tx-cta convert" disabled={!!blocked || (needAck && !ack)} onClick={() => go(false)}>Swap now</button>
      )}
    </div>
  );
}
