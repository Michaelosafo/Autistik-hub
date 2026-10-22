"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http } from "viem";
import { IMPACT_BLOCK, IMPACT_CONFIRM, IMPACT_WARN, toUnits, WSOL } from "@/lib/wallet-chains";
import { isXAddress, isXNative, lifiDiamond, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";
import type { Signer } from "@/components/wallet/types";
import { addTrade, amt, api, friendlyError, raw2num, sendSol, short, store, usd, type Holding } from "@/components/wallet/util";
import { toast } from "@/lib/toast";
import { GAS_RESERVE } from "@/components/wallet/MarketForm";
import { ChainBadge, XTokenPicker } from "./parts";
import type { CardIO } from "./SwapCard";

const pc = (c: XChain): any => createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 10_000 }) });
const explorerTx = (c: XChain, h: string) => `${c.explorer}/tx/${h}`;
const mins = (s: number | null) => (s == null ? "–" : s < 60 ? `about ${Math.max(5, Math.round(s / 5) * 5)} sec` : `about ${Math.round(s / 60)} min`);

/** Raw balance of a coin, read from the network in the browser (Solana through the Wallet API). */
async function balanceOf(c: XChain, owner: string, token: XToken): Promise<bigint> {
  if (c.kind === "solana") {
    const { holdings } = await api<{ holdings: Holding[] }>("balances", { chain: "solana", owner, extra: [] });
    const mint = isXNative(c, token.address) ? WSOL : token.address;
    return BigInt(holdings.find((h) => h.address === mint)?.raw || "0");
  }
  const who = getAddress(owner);
  if (isXNative(c, token.address)) return pc(c).getBalance({ address: who });
  return pc(c).readContract({ address: token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

async function waitTx(c: XChain, hash: `0x${string}`) {
  const r = await pc(c).waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The transaction failed on the network. Nothing was sent (only the network fee was used).");
}

type Stage = { at: 0 | 1 | 2 | 3; hash?: string; receive?: string | null; link?: string | null; failed?: string };

/**
 * A swap that can cross networks: pay a coin on one network, get a coin on another. LI.FI finds the route (bridge +
 * the best DEX on each side); the member's own wallet signs on the "from" network and the coins arrive at their
 * address on the "to" network.
 */
export default function BridgeForm({ signer, from, to, fromToken, toToken, onFromToken, onToToken, logos, card }: {
  signer: Signer; from: XChain; to: XChain; fromToken: XToken | null; toToken: XToken | null;
  onFromToken: (t: XToken) => void; onToToken: (t: XToken) => void; logos: Record<number, string>;
  /** Draws the amount and the two coins itself (the Swap card); otherwise the plain fields below. */
  card?: (io: CardIO) => ReactNode;
}) {
  const owner = (from.kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? null;
  const mine = (to.kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? "";
  const [receiver, setReceiver] = useState(mine); const [editTo, setEditTo] = useState(false);
  useEffect(() => { setReceiver(mine); setEditTo(false); }, [mine, to.id]);
  const toAddress = receiver.trim();
  const toOk = isXAddress(to, toAddress);

  const [amount, setAmount] = useState("");
  const [bal, setBal] = useState<bigint | null>(null);
  const [q, setQ] = useState<XQuote | null>(null); const [qErr, setQErr] = useState(""); const [quoting, setQuoting] = useState(false);
  const [slip, setSlip] = useState<number | "auto">("auto");
  const [ack, setAck] = useState(false); const [review, setReview] = useState(false);
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [stage, setStage] = useState<Stage | null>(null);
  const limit = store.get<number | null>("aw-limit", null);
  const cross = from.id !== to.id;

  const loadBal = useCallback(() => {
    setBal(null);
    if (owner && fromToken) balanceOf(from, owner, fromToken).then(setBal).catch(() => {});
  }, [owner, from, fromToken]);
  useEffect(() => { loadBal(); }, [loadBal]);

  const rawIn = fromToken ? toUnits(amount || "", fromToken.decimals) : null;
  const tooMuch = !!(rawIn && bal != null && rawIn > bal);
  const stable = /USD/.test(fromToken?.symbol || "") && /USD/.test(toToken?.symbol || "");
  const autoSlip = stable ? 50 : 100;
  const slipBps = slip === "auto" ? autoSlip : slip;

  const getQuote = useCallback(() => api<{ quote: XQuote }>("x-quote", {
    fromChain: from.id, toChain: to.id, fromToken: fromToken!.address, toToken: toToken!.address, amount: rawIn!.toString(),
    fromAddress: owner, toAddress, slippageBps: slipBps,
  }).then((d) => d.quote), [from.id, to.id, fromToken, toToken, rawIn, owner, toAddress, slipBps]);

  // A fresh route after typing stops, refreshed every 30 seconds while the member looks at it.
  const seq = useRef(0);
  useEffect(() => {
    setQ(null); setQErr(""); setAck(false); setReview(false);
    if (!fromToken || !toToken || !rawIn || rawIn <= 0n || !owner || !toOk) { setQuoting(false); return; }
    const id = ++seq.current; setQuoting(true);
    const run = () => getQuote().then((x) => id === seq.current && setQ(x)).catch((e) => id === seq.current && setQErr(e.message)).finally(() => id === seq.current && setQuoting(false));
    const t = setTimeout(run, 600);
    const every = setInterval(() => { if (!document.hidden && id === seq.current) run(); }, 30_000);
    return () => { clearTimeout(t); clearInterval(every); };
  }, [from.id, to.id, fromToken?.address, toToken?.address, amount, owner, toAddress, slipBps]); // eslint-disable-line react-hooks/exhaustive-deps

  const out = q && toToken ? raw2num(q.toAmount, toToken.decimals) : 0;
  const minOut = q && toToken ? raw2num(q.toAmountMin, toToken.decimals) : 0;
  const impact = q?.fromUsd && q.toUsd ? Math.max(0, ((q.fromUsd - q.toUsd) / q.fromUsd) * 100) : null;
  const blocked = impact != null && impact >= IMPACT_BLOCK ? `You'd lose ${impact.toFixed(0)}% of the value on this route. Try a smaller amount or another coin.`
    : limit && q?.fromUsd && q.fromUsd > limit ? `This swap (${usd(q.fromUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Security.`
    : tooMuch ? `Not enough ${fromToken?.symbol}.` : "";
  const needAck = impact != null && impact >= IMPACT_CONFIRM;

  function part(p: number) {
    if (bal == null || !fromToken) return;
    let r = (bal * BigInt(p)) / 100n;
    if (p === 100 && isXNative(from, fromToken.address)) { const keep = toUnits(from.wchain ? GAS_RESERVE[from.wchain] : "0.002", fromToken.decimals) || 0n; r = r > keep ? r - keep : 0n; }
    const s = Number(r) / 10 ** fromToken.decimals;
    setAmount(s > 0 ? String(Math.floor(s * 1e8) / 1e8) : "0");
  }

  async function go() {
    if (!q || !fromToken || !toToken || !owner) return;
    setErr(""); setStage(null);
    try {
      let x = q;
      // Routes go stale: get a fresh one if this one is older than 45 seconds, and stop if it got worse.
      if (Date.now() - x.at > 45_000) {
        setStep("Checking the price again…");
        x = await getQuote();
        setQ(x);
        if (BigInt(x.toAmountMin) * 100n < BigInt(q.toAmountMin) * 99n) { setStep(""); setErr("The price moved. Check the new amount and confirm again."); return; }
      }
      let hash: string;
      if (from.kind === "solana") {
        if (!x.sol) throw new Error("Couldn't build the swap. Try again.");
        setStep("Approve in your wallet…");
        hash = await sendSol(signer, x.sol);
      } else {
        const ev = signer.evm!, tx = x.evm!;
        // Never send to a contract we don't expect, even if the server were tampered with.
        if (getAddress(tx.to) !== getAddress(lifiDiamond(from.id)) || (tx.spender && getAddress(tx.spender) !== getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
        if (tx.spender) {
          const have: bigint = await pc(from).readContract({ address: fromToken.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
          if (have < BigInt(x.fromAmount)) {
            // The exact amount only: no unlimited approvals left lying around.
            setStep(`Step 1 of 2: allow this swap to use your ${fromToken.symbol}…`);
            const h = await ev.send(from.id, { to: fromToken.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(x.fromAmount)] }) });
            await waitTx(from, h);
          }
          setStep("Step 2 of 2: confirm in your wallet…");
        } else setStep("Confirm in your wallet…");
        const h = await ev.send(from.id, { to: tx.to, data: tx.data, value: tx.value });
        setStep(`Waiting for ${from.name}…`);
        await waitTx(from, h);
        hash = h;
      }
      addTrade({ at: Date.now(), chain: from.key, side: "convert", pay: `${amount} ${fromToken.symbol} (${from.name})`, get: `${amt(out)} ${toToken.symbol} (${to.name})`, hash });
      setStep(""); setReview(false); setAmount(""); loadBal();
      const what = `${amount} ${fromToken.symbol} → ${amt(out)} ${toToken.symbol}`;
      if (!cross) { setStage({ at: 3, hash }); toast({ kind: "ok", title: "Swap done", text: `${what} on ${from.name}`, link: { href: explorerTx(from, hash), label: "View transaction" } }); return; }
      toast({ kind: "info", title: `Sent on ${from.name}`, text: `${what}. Arrives on ${to.name} in ${mins(x.seconds)}. We'll tell you when it lands.` });
      // Follow the coins across: sent → on the way → arrived.
      setStage({ at: 1, hash });
      for (let i = 0; i < 360; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const { status: s } = await api<{ status: { status: string; receiveHash: string | null; link: string | null; message: string | null } }>("x-status", { hash, fromChain: from.id, toChain: to.id, tool: x.tool })
          .catch(() => ({ status: { status: "pending", receiveHash: null, link: null, message: null } }));
        if (s.status === "done") {
          setStage({ at: 3, hash, receive: s.receiveHash, link: s.link });
          toast({ kind: "ok", title: `Swap done: arrived on ${to.name}`, text: what, link: s.receiveHash ? { href: explorerTx(to, s.receiveHash), label: "View transaction" } : undefined });
          return;
        }
        if (s.status === "failed" || s.status === "refunded") {
          const failed = s.status === "refunded" ? `The transfer didn't go through and your coins were refunded. ${s.message || ""}` : s.message || "The transfer failed. If your coins don't come back soon, open the tracker.";
          setStage({ at: 2, hash, link: s.link, failed });
          toast({ kind: "bad", title: s.status === "refunded" ? "Swap refunded" : "Swap stopped", text: failed });
          return;
        }
        setStage({ at: 2, hash, link: s.link });
      }
    } catch (e: any) { const m = friendlyError(e, from.native.symbol); setErr(m); if (!m.startsWith("You cancelled")) toast({ kind: "bad", title: "Swap didn't go through", text: m }); }
    setStep("");
  }

  const balNum = bal != null && fromToken ? raw2num(bal.toString(), fromToken.decimals) : null;
  const connect = signer.loginExternal ?? signer.login;
  return (
    <div className="stack tx-form" style={{ gap: 10 }}>
      {card ? card({
        amount, setAmount, balance: owner ? balNum ?? 0 : null, onMax: bal != null ? () => part(100) : null,
        inUsd: q?.fromUsd ?? (fromToken?.priceUsd && Number(amount) ? fromToken.priceUsd * Number(amount) : null),
        out: quoting && !q ? <span className="tx-dim">…</span> : q ? amt(out) : <span className="tx-dim">0</span>, outUsd: q?.toUsd ?? null,
        toExtra: owner && (cross || editTo || !toOk) ? (
          <div className="sc-extra">
            <div className="sx-on"><ChainBadge c={to} logo={logos[to.id]} size={14} /> Arrives on {to.name}
              {toOk && !editTo ? <> · to <button type="button" className="sx-link" onClick={() => setEditTo(true)}>{toAddress === mine ? "your wallet" : short(toAddress)} ✎</button></> : null}
            </div>
            {(editTo || !toOk) && (
              <input className="sx-addr" value={receiver} onChange={(e) => setReceiver(e.target.value)} spellCheck={false} autoComplete="off"
                placeholder={`Your ${to.name} address`} aria-label={`Receive at (${to.name} address)`} />
            )}
          </div>
        ) : null,
      }) : <>
      <div className="tx-field">
        <div className="row tx-field-top"><span>You pay</span>{balNum != null && <span>Available <b>{amt(balNum)} {fromToken?.symbol}</b></span>}</div>
        <div className="row tx-field-mid">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Amount" />
          <XTokenPicker c={from} value={fromToken} onPick={onFromToken} label="Pay with" balance={balNum} />
        </div>
        <div className="sx-on"><ChainBadge c={from} logo={logos[from.id]} size={14} /> on {from.name}{q?.fromUsd ? <span> · {usd(q.fromUsd)}</span> : null}</div>
      </div>
      <div className="tx-parts">{[25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => part(p)} disabled={bal == null}>{p === 100 ? "Max" : `${p}%`}</button>)}</div>
      <div className="tx-field">
        <div className="row tx-field-top"><span>You get (about)</span>{q?.toUsd ? <span>{usd(q.toUsd)}</span> : null}</div>
        <div className="row tx-field-mid">
          <div className="tx-out">{quoting && !q ? <span className="tx-dim">Finding the best route…</span> : q ? amt(out) : <span className="tx-dim">0.00</span>}</div>
          <XTokenPicker c={to} value={toToken} onPick={onToToken} label="Receive" />
        </div>
        <div className="sx-on"><ChainBadge c={to} logo={logos[to.id]} size={14} /> on {to.name}
          {owner && <> · to {toOk && !editTo ? <button type="button" className="sx-link" onClick={() => setEditTo(true)}>{toAddress === mine ? "your wallet" : short(toAddress)} ✎</button> : null}</>}
        </div>
        {owner && (editTo || !toOk) && (
          <input className="sx-addr" value={receiver} onChange={(e) => setReceiver(e.target.value)} spellCheck={false} autoComplete="off"
            placeholder={`Your ${to.name} address`} aria-label={`Receive at (${to.name} address)`} />
        )}
      </div>
      </>}

      {qErr && <div className="scan-err">{qErr}</div>}

      {q && fromToken && toToken && (
        <div className="sx-route">
          <div className="sx-route-head">
            <span className="sx-route-tag">{cross ? "Best route" : "Best price"}</span>
            <b>{q.toolName}</b>{q.toolLogo && <img src={q.toolLogo} alt="" width={16} height={16} />}
            <span className="grow" /><span className="sx-time">⏱ {mins(q.seconds)}</span>
          </div>
          {q.steps.length > 1 && (
            <ol className="sx-hops">{q.steps.map((s, i) => <li key={i} className={s.kind === "cross" ? "x" : ""}>{s.kind === "cross" ? "Bridge" : "Swap"} · {s.name}</li>)}</ol>
          )}
          <div className="aw-details">
            <div><span>Rate</span><b>1 {fromToken.symbol} = {amt(out / Number(amount || 1))} {toToken.symbol}</b></div>
            <div><span>Minimum received</span><b>{amt(minOut)} {toToken.symbol}</b></div>
            {impact != null && <div><span>Value lost on the way</span><b className={impact >= IMPACT_WARN ? "down" : ""}>{impact.toFixed(2)}%</b></div>}
            <div><span>Slippage</span><span className="aw-slip">
              {(["auto", 50, 100, 300] as const).map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s === "auto" ? `Auto ${autoSlip / 100}%` : `${s / 100}%`}</button>)}
            </span></div>
            {q.gasUsd != null && <div><span>Network fee</span><b>≈ {usd(q.gasUsd)}</b></div>}
            {q.feeUsd != null && <div><span>Bridge fee</span><b>≈ {usd(q.feeUsd)}</b></div>}
            <div><span>AUTISTIK fee</span><b>{q.feeBps ? `${q.feeBps / 100}%` : "0%"}</b></div>
          </div>
        </div>
      )}
      {impact != null && impact >= IMPACT_WARN && impact < IMPACT_BLOCK && <div className="aw-risk warn">You get {impact.toFixed(1)}% less value than you pay, after fees and price impact.</div>}
      {blocked && q && <div className="aw-risk danger">{blocked}</div>}
      {needAck && !blocked && q && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand and want to continue.</label>}

      {!owner ? (
        <button type="button" className="sw-connect" onClick={from.kind === "solana" && signer.loginEmbedded ? signer.loginEmbedded : connect}>
          {from.kind === "solana" && !signer.sol && signer.evm ? "Connect a Solana wallet" : "Connect Wallet"}
        </button>
      ) : !review ? (
        <button type="button" className="tx-cta convert sx-cta" disabled={!q || !!blocked || (needAck && !ack) || quoting && !q} onClick={() => setReview(true)}>
          {!amount ? "Enter an amount" : !toOk ? `Enter a ${to.name} address` : quoting && !q ? "Finding the best route…" : blocked && q ? "Can't swap" : cross ? `Swap to ${to.name}` : "Swap"}
        </button>
      ) : q && fromToken && toToken && (
        <div className="aw-review stack">
          <b>Confirm your swap</b>
          <div className="aw-details">
            <div><span>Pay</span><b>{amount} {fromToken.symbol} on {from.name}</b></div>
            <div><span>Receive at least</span><b>{amt(minOut)} {toToken.symbol} on {to.name}</b></div>
            <div><span>To</span><b>{toAddress === mine ? "Your wallet" : "This address"} {short(toAddress)}</b></div>
            {cross && <div><span>Arrives in</span><b>{mins(q.seconds)}</b></div>}
          </div>
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : (
            <div className="row" style={{ gap: 8 }}><button type="button" className="btn" onClick={() => setReview(false)}>Back</button><button type="button" className="tx-cta convert grow sx-cta" onClick={go}>Confirm</button></div>
          )}
        </div>
      )}
      {err && <div className="aw-risk danger">{err}</div>}

      {stage && (
        <div className={"sx-track" + (stage.failed ? " bad" : stage.at === 3 ? " ok" : "")} role="status">
          {cross ? (
            <ol>
              <li className="done"><span /> Sent on {from.name} {stage.hash && <a href={explorerTx(from, stage.hash)} target="_blank" rel="noopener noreferrer">↗</a>}</li>
              <li className={stage.at >= 3 ? "done" : stage.failed ? "bad" : "now"}><span /> {stage.failed ? "Transfer stopped" : "Crossing to " + to.name}</li>
              <li className={stage.at >= 3 ? "done" : ""}><span /> Arrived on {to.name} {stage.receive && <a href={explorerTx(to, stage.receive)} target="_blank" rel="noopener noreferrer">↗</a>}</li>
            </ol>
          ) : <div>Swap done. {stage.hash && <a href={explorerTx(from, stage.hash)} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}</div>}
          {stage.failed && <p>{stage.failed}</p>}
          {stage.link && <a href={stage.link} target="_blank" rel="noopener noreferrer">Track this transfer ↗</a>}
        </div>
      )}
    </div>
  );
}
