"use client";
/**
 * Believer's trading bot, like a Telegram trading bot: paste a coin's contract address and it finds the coin on any
 * network, shows its price and safety check, then asks what you want to do, one question at a time:
 *   Buy · Sell · Limit buy · Take profit · Stop-loss · My orders
 * Buys and sells go through the member's own wallet (the AUTISTIK wallet on their account, or one they connected).
 * Limit, take-profit and stop-loss orders are signed once (free) and then run on their own, 24/7, even when the site is
 * closed: the keeper fills them when the price is reached. Nobody else ever holds the member's keys.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import SignerScope from "@/components/wallet/SignerScope";
import { OpenOrders, orderContracts, placeOrder } from "@/components/wallet/OrderForm";
import { GAS_RESERVE } from "@/components/wallet/MarketForm";
import type { Member, Signer } from "@/components/wallet/types";
import { addTrade, amt, api, friendlyError, Logo, pct, raw2num, runTrade, short, store, usd, type Holding, type Market, type Quote, type TokenInfo } from "@/components/wallet/util";
import { IMPACT_BLOCK, IMPACT_CONFIRM, MAX_SLIPPAGE_BPS, WCHAINS, isNative, toUnits, type WChain, type WChainKey } from "@/lib/wallet-chains";
import { STOP_SLIPPAGE_DEFAULT } from "@/lib/orders";
import { plainNum } from "@/lib/num-format";
import { claimAuto } from "@/lib/auto-trade";
import { isApproved } from "@/lib/swap-read";

/** `auto`: the message said "approved" (or "confirm", "go ahead"): a buy or sell runs by itself. */
export type TradeIntent = { action: Action; amount?: number; pct?: number; mult?: number; auto?: boolean };
type Action = "buy" | "sell" | "limit" | "tp" | "sl" | "orders" | "scan" | "info";
type Found = { chain: WChainKey; token: TokenInfo; market: Market | null };

const ACTIONS: { id: Action; label: string; tone: string; hint: string }[] = [
  { id: "scan", label: "Scan & review", tone: "scan", hint: "Safety scan and a buy-or-sell read" },
  { id: "buy", label: "Buy", tone: "buy", hint: "Buy now at the market price" },
  { id: "sell", label: "Sell", tone: "sell", hint: "Sell now at the market price" },
  { id: "limit", label: "Limit buy", tone: "buy", hint: "Buy automatically if the price drops" },
  { id: "tp", label: "Take profit", tone: "gold", hint: "Sell automatically when the price goes up" },
  { id: "sl", label: "Stop-loss", tone: "sell", hint: "Sell automatically if the price falls" },
  { id: "orders", label: "My orders", tone: "", hint: "See or cancel your open orders" },
];
const BUY_SIZES: Record<WChainKey, number[]> = { bsc: [0.01, 0.05, 0.1, 0.25, 0.5], base: [0.002, 0.005, 0.01, 0.05, 0.1], ethereum: [0.005, 0.01, 0.05, 0.1, 0.25], arbitrum: [0.002, 0.005, 0.01, 0.05, 0.1], solana: [0.05, 0.1, 0.25, 0.5, 1] };
const DIPS = [10, 20, 30, 50];
const PROFITS: { label: string; mult: number }[] = [{ label: "+25%", mult: 1.25 }, { label: "+50%", mult: 1.5 }, { label: "2x", mult: 2 }, { label: "3x", mult: 3 }, { label: "5x", mult: 5 }];
const STOPS = [10, 20, 30, 50];
const PARTS = [25, 50, 75, 100];
const DAYS = 30;

/** Finds a contract address in a message, and anything it says to do with it ("buy 0.1", "sl 20%", "tp 2x"). */
export function findTradeRequest(text: string): { ca: string; intent?: TradeIntent } | null {
  const evm = text.match(/\b0x[a-fA-F0-9]{40}\b/);
  const sol = evm ? null : text.match(/(?:^|\s)([1-9A-HJ-NP-Za-km-z]{32,44})(?=\s|$)/);
  const ca = evm?.[0] || sol?.[1];
  if (!ca) return null;
  const r = findTradeAction(text, ca);
  return r && isApproved(text) && r.intent && (r.intent.action === "buy" || r.intent.action === "sell") ? { ca, intent: { ...r.intent, auto: true } } : r;
}
function findTradeAction(text: string, ca: string): { ca: string; intent?: TradeIntent } | null {
  const t = text.replace(ca, " ").toLowerCase();
  const n = (s?: string) => (s ? Number(s) : undefined);
  let m: RegExpMatchArray | null;
  if ((m = t.match(/\b(?:tp|take\s*profit)\b[^\d]*([\d.]+)\s*(x|%)/))) return { ca, intent: { action: "tp", mult: m[2] === "x" ? n(m[1]) : 1 + Number(m[1]) / 100 } };
  if ((m = t.match(/\b(?:sl|stop(?:\s*-?\s*loss)?)\b[^\d]*([\d.]+)\s*%/))) return { ca, intent: { action: "sl", pct: n(m[1]) } };
  if ((m = t.match(/\blimit\b[^\d]*([\d.]+)\s*%/))) return { ca, intent: { action: "limit", pct: n(m[1]) } };
  if ((m = t.match(/\bsell\b\s*(all|[\d.]+\s*%)?/))) return { ca, intent: { action: "sell", pct: m[1] === "all" ? 100 : m[1] ? parseFloat(m[1]) : undefined } };
  // "buy 1 usd" / "buy $1" is a dollar amount (the swap bot handles it), never 1 BNB.
  if ((m = t.match(/\bbuy\b\s*([\d.]+)?(?!\s*(?:usd|dollars?|bucks|\$))/)) && !/\$\s*\d|\d\s*(?:usd|dollars?|bucks|\$)/.test(t)) return { ca, intent: { action: "buy", amount: n(m[1]) } };
  if (/\bbuy\b/.test(t)) return { ca, intent: { action: "buy" } };
  if (/\borders?\b/.test(t)) return { ca, intent: { action: "orders" } };
  if (/\b(scan|review|check|safe|audit|rug)\b/.test(t)) return { ca, intent: { action: "scan" } };
  return { ca };
}

export default function TradeBot({ ca, at, intent, appId, member, signedIn, scanOnly = false }: { ca: string; at?: number; intent?: TradeIntent; scanOnly?: boolean; appId: string | null; member: Member | null; signedIn: boolean }) {
  const [found, setFound] = useState<Found | null>(null);
  const [err, setErr] = useState("");
  const [slim, setSlim] = useState(false); // a step is open: on phones the coin details fold away to make room
  useEffect(() => {
    let live = true;
    api<Found>("detect", { address: ca }).then((d) => live && setFound(d)).catch((e) => live && setErr(e.message || "Couldn't find that coin."));
    return () => { live = false; };
  }, [ca]);

  if (err) return <div className="tb tb-err"><b>Coin not found</b><p>{err}</p><small className="tb-ca">{short(ca)}</small></div>;
  if (!found) return <div className="tb"><div className="tb-load"><span className="aw-spin" />Looking up {short(ca)} on every network…</div></div>;
  const c = WCHAINS[found.chain];
  return (
    <div className={"tb" + (slim ? " slim" : "")}>
      <CoinCard c={c} t={found.token} m={found.market} />
      {scanOnly ? <div className="tb-flow"><ScanStep c={c} t={found.token} canOrder={false} onAction={() => {}} noTrade /></div> : !signedIn ? <p className="tb-q">Sign in to trade this coin with your wallet.</p> : (
        <SignerScope appId={appId} member={member}>
          {(signer) => <div className="tb-flow"><Flow c={c} t={found.token} m={found.market} signer={signer} intent={intent} at={at} onStep={setSlim} /></div>}
        </SignerScope>
      )}
    </div>
  );
}

function CoinCard({ c, t, m }: { c: WChain; t: TokenInfo; m: Market | null }) {
  const r = t.risk;
  const [copied, setCopied] = useState(false);
  return (
    <div className="tb-coin">
      <div className="tb-coin-h">
        <Logo t={{ symbol: t.symbol, logo: m?.logo || t.logo }} size={44} />
        <div className="tb-coin-t">
          <b>{t.name} <span>${t.symbol}</span></b>
          <small><i className={`tb-net ${c.key}`} />{c.name} · <button type="button" className="tb-copy" onClick={() => { navigator.clipboard?.writeText(t.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied" : short(t.address)}</button></small>
        </div>
        <div className="tb-px"><b>{usd(m?.priceUsd ?? t.priceUsd)}</b>{m?.change24 != null && <small className={m.change24 >= 0 ? "up" : "down"}>{pct(m.change24)} 24h</small>}</div>
      </div>
      <div className="tb-stats">
        <span><small>Market cap</small><b>{usd(m?.mcap)}</b></span>
        <span><small>Liquidity</small><b>{usd(m?.liquidity)}</b></span>
        <span><small>Volume 24h</small><b>{usd(m?.volume24)}</b></span>
        <span><small>1h</small><b className={(m?.change1h ?? 0) >= 0 ? "up" : "down"}>{pct(m?.change1h)}</b></span>
        <span><small>Buy / sell tax</small><b>{r.buyTax}% / {r.sellTax}%</b></span>
        <span><small>Safety</small><b className={`tb-risk ${r.level}`}>{r.honeypot ? "Honeypot" : r.level === "ok" ? "Looks OK" : r.level === "warn" ? "Be careful" : r.level === "danger" ? "Risky" : "Unknown"}</b></span>
      </div>
      {r.notes.length > 0 && <ul className="tb-notes">{r.notes.slice(0, 3).map((n) => <li key={n}>{n}</li>)}</ul>}
      {m?.pair && <a className="tb-chart" href={`https://dexscreener.com/${c.key}/${m.pair}`} target="_blank" rel="noopener noreferrer">Open chart ↗</a>}
    </div>
  );
}

function Flow({ c, t, m, signer, intent, at, onStep }: { c: WChain; t: TokenInfo; m: Market | null; signer: Signer; intent?: TradeIntent; at?: number; onStep?: (open: boolean) => void }) {
  const owner = c.kind === "solana" ? signer.sol?.address : signer.evm?.address;
  const [action, setAction] = useState<Action | null>(intent?.action ?? null);
  const [hold, setHold] = useState<{ native: Holding | null; token: Holding | null } | null>(null);
  const [contract, setContract] = useState<string | null | undefined>(undefined);
  useEffect(() => { onStep?.(!!action); }, [action]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => {
    if (!owner) return;
    api<{ holdings: Holding[] }>("balances", { chain: c.key, owner, extra: [t.address] }).then((d) => setHold({
      native: d.holdings.find((h) => isNative(c, h.address)) ?? null,
      token: d.holdings.find((h) => h.address.toLowerCase() === t.address.toLowerCase()) ?? null,
    })).catch(() => setHold({ native: null, token: null }));
  };
  useEffect(load, [owner, c.key, t.address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (c.kind === "evm") orderContracts().then((x) => setContract(x[c.key] ?? null)); else setContract(null); }, [c]);

  if (!signer.ready) return <p className="tb-q">Loading your wallet…</p>;
  if (!owner) return (
    <div className="tb-step">
      <p className="tb-q">Which wallet should I trade with?</p>
      <div className="tb-btns">
        {signer.loginEmbedded && <button type="button" className="tb-btn buy" onClick={signer.loginEmbedded}>My AUTISTIK wallet</button>}
        <button type="button" className="tb-btn" onClick={() => (signer.loginExternal || signer.login)()}>Connect my wallet</button>
      </div>
      <small className="tb-dim">{c.kind === "solana" ? "This coin is on Solana, so I need a Solana wallet." : "Your wallet approves every trade. I never hold your keys."}</small>
    </div>
  );

  return (
    <>
      <div className="tb-wallet">
        <span>Your wallet <b>{short(owner)}</b></span>
        <span>{hold ? <>{amt(hold.native?.amount ?? 0)} {c.native.symbol} · {amt(hold.token?.amount ?? 0)} {t.symbol}{hold.token?.valueUsd ? ` (${usd(hold.token.valueUsd)})` : ""}</> : "…"}</span>
      </div>
      {!action ? (
        <div className="tb-step">
          <p className="tb-q">What do you want to do with ${t.symbol}?</p>
          <div className="tb-btns grid">
            {ACTIONS.map((a) => {
              const off = (a.id === "limit" || a.id === "tp" || a.id === "sl" || a.id === "orders") && !contract;
              return <button key={a.id} type="button" className={`tb-btn ${a.tone}`} disabled={off || (contract === undefined && !["buy", "sell", "scan"].includes(a.id))} title={off ? `Auto orders aren't open on ${c.name} yet` : a.hint} onClick={() => setAction(a.id)}>{a.label}<small>{off ? "Not on this network yet" : a.hint}</small></button>;
            })}
          </div>
        </div>
      ) : (
        <div className="tb-step">
          <button type="button" className="tb-back" onClick={() => setAction(null)}>← Back</button>
          {action === "buy" && <MarketStep c={c} t={t} m={m} signer={signer} owner={owner} side="buy" hold={hold} preset={intent?.action === "buy" ? intent.amount : undefined} auto={intent?.action === "buy" && intent.auto ? at : undefined} onDone={load} />}
          {action === "sell" && <MarketStep c={c} t={t} m={m} signer={signer} owner={owner} side="sell" hold={hold} preset={intent?.action === "sell" ? intent.pct : undefined} auto={intent?.action === "sell" && intent.auto ? at : undefined} onDone={load} />}
          {(action === "limit" || action === "tp" || action === "sl") && contract && (
            <OrderStep c={c} t={t} m={m} signer={signer} contract={contract} kind={action} hold={hold}
              presetMove={intent?.action === action ? (action === "tp" ? intent.mult : intent.pct) : undefined} onDone={() => { load(); setAction("orders"); }} />
          )}
          {action === "orders" && signer.evm && <OpenOrders c={c} signer={signer} owner={signer.evm.address} />}
          {action === "scan" && <ScanStep c={c} t={t} canOrder={!!contract} onAction={setAction} />}
        </div>
      )}
    </>
  );
}

/** Buy or sell now. Buy asks "how much BNB?", sell asks "how much of it?", then shows the quote to confirm. */
function MarketStep({ c, t, m, signer, owner, side, hold, preset, auto, onDone }: {
  c: WChain; t: TokenInfo; m: Market | null; signer: Signer; owner: string; side: "buy" | "sell"; hold: { native: Holding | null; token: Holding | null } | null; preset?: number;
  /** When the request was typed, if it said "approved": the trade runs by itself once the price is in. */
  auto?: number; onDone: () => void;
}) {
  const from = side === "buy" ? c.native : t, to = side === "buy" ? t : c.native;
  const bal = side === "buy" ? hold?.native : hold?.token;
  const [amount, setAmount] = useState<string>(() => (preset && side === "buy" ? String(preset) : ""));
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState("");
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState("");
  const [hash, setHash] = useState("");
  const [ack, setAck] = useState(false);

  function part(p: number) {
    if (!bal) return;
    let r = (BigInt(bal.raw) * BigInt(Math.round(p))) / 100n;
    if (p >= 100 && isNative(c, from.address)) { const keep = toUnits(GAS_RESERVE[c.key], 18) || 0n; r = r > keep ? r - keep : 0n; }
    setAmount(plainNum(raw2num(r.toString(), from.decimals), Math.min(8, from.decimals)));
  }
  useEffect(() => { if (preset && side === "sell" && bal) part(preset); }, [!!bal]); // eslint-disable-line react-hooks/exhaustive-deps

  const raw = toUnits(amount || "", from.decimals);
  useEffect(() => {
    setQ(null); setQErr(""); setAck(false);
    if (!raw || raw <= 0n) return;
    const tm = setTimeout(() => api<{ quote: Quote }>("quote", { chain: c.key, tokenIn: from.address, tokenOut: to.address, amount: raw.toString(), chat: true })
      .then((d) => setQ(d.quote)).catch((e) => setQErr(e.message)), 400);
    return () => clearTimeout(tm);
  }, [amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const tax = side === "buy" ? t.risk.buyTax : t.risk.sellTax;
  const slipBps = Math.min(MAX_SLIPPAGE_BPS, tax > 0 ? Math.ceil((tax + 3) * 100) : 300);
  const out = q ? raw2num(q.amountOut, to.decimals) : 0;
  const limit = store.get<number | null>("aw-limit", null);
  const tooMuch = !!(raw && bal && raw > BigInt(bal.raw)) || (!!raw && !bal);
  const blocked = side === "buy" && t.risk.honeypot ? "This coin looks like a honeypot (you couldn't sell it). Buying is blocked for your safety."
    : q?.impact != null && q.impact >= IMPACT_BLOCK ? `This would move the price ${q.impact.toFixed(0)}%. Try a smaller amount.`
    : limit && q?.inUsd && q.inUsd > limit ? `This trade (${usd(q.inUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Wallet › Security.`
    : tooMuch ? `Not enough ${from.symbol}.` : "";
  const needAck = t.risk.level === "danger" || (q?.impact != null && q.impact >= IMPACT_CONFIRM);

  async function go(quiet = false) {
    if (!q) return;
    setErr(""); setDone("");
    // Approved in the message: the built-in wallet signs without its confirm window.
    const s: Signer = quiet && signer.quiet ? { ...signer, evm: signer.quiet.evm ?? signer.evm, sol: signer.quiet.sol ?? signer.sol } : signer;
    try {
      const hash = await runTrade(c, s, owner, q, from, slipBps, setStep);
      addTrade({ at: Date.now(), chain: c.key, side, pay: `${amount} ${from.symbol}`, get: `${amt(out)} ${to.symbol}`, hash });
      setHash(hash);
      setDone(`Done. ${side === "buy" ? "Bought" : "Sold"} about ${amt(out)} ${to.symbol} for ${amount} ${from.symbol}.`);
      setTimeout(onDone, 2500);
    } catch (e) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  // "0x… approved sell 50%": once the price is in, sell (or buy) by itself, unless a safety check needs a look.
  const fired = useRef(false);
  const [autoNote, setAutoNote] = useState("");
  useEffect(() => {
    if (!auto || !q || fired.current || step || done) return;
    fired.current = true;
    if (blocked || needAck) { setAutoNote("I didn't run this by itself: check the warning below first."); return; }
    if (!claimAuto(auto)) return;
    setAutoNote(c.kind === "solana" ? (signer.quiet?.sol ? "Approved in your message: doing it now." : "Approved in your message. Your wallet will still ask in its own window.")
      : signer.quiet?.evm ? "Approved in your message: doing it now." : "Approved in your message. Your wallet will still ask in its own window.");
    go(true);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) return <div className="tb-done">✅ {done} {hash && <a href={`${c.explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">View ↗</a>}</div>;
  return (
    <>
      {autoNote && <div className="sb-auto">{autoNote}</div>}
      <p className="tb-q">{side === "buy" ? `How much ${c.native.symbol} do you want to spend?` : `How much of your ${t.symbol} do you want to sell?`}</p>
      <div className="tb-btns">
        {side === "buy"
          ? BUY_SIZES[c.key].map((v) => <button key={v} type="button" className={"tb-chip" + (Number(amount) === v ? " on" : "")} onClick={() => setAmount(String(v))}>{v} {c.native.symbol}</button>)
          : PARTS.map((p) => <button key={p} type="button" className="tb-chip" disabled={!hold?.token} onClick={() => part(p)}>{p === 100 ? "All" : `${p}%`}</button>)}
      </div>
      <label className="tb-amt"><span>Or type an amount</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.0" aria-label={`Amount of ${from.symbol}`} />
        <b>{from.symbol}</b>
      </label>
      <small className="tb-dim">You have {amt(bal?.amount ?? 0)} {from.symbol}.</small>
      {qErr && <div className="aw-risk danger">{qErr}</div>}
      {q && (
        <div className="tb-quote">
          <div><span>You get about</span><b>{amt(out)} {to.symbol}</b></div>
          <div><span>Worth</span><b>{usd(q.outUsd)}</b></div>
          {q.impact != null && <div><span>Price impact</span><b className={q.impact >= 3 ? "down" : ""}>{q.impact.toFixed(2)}%</b></div>}
          <div><span>Slippage allowed</span><b>{(slipBps / 100).toFixed(1)}%{tax ? ` (includes ${tax}% tax)` : ""}</b></div>
          {q.gasUsd != null && <div><span>Network fee</span><b>~{usd(q.gasUsd)}</b></div>}
        </div>
      )}
      {needAck && q && !blocked && <label className="tb-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this is risky and want to go ahead.</label>}
      {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
        : <button type="button" className={`tb-go ${side}`} disabled={!q || !!blocked || (needAck && !ack)} onClick={() => go()}>{blocked || (q ? `Confirm: ${side} ${side === "buy" ? `${amount} ${c.native.symbol} of ${t.symbol}` : `${amt(Number(amount))} ${t.symbol}`}` : raw ? "Getting the best price…" : "Pick an amount")}</button>}
      {err && <div className="aw-risk danger">{err}</div>}
    </>
  );
}

/** Limit buy, take profit (limit sell) or stop-loss: asks the price, then how much, then places a signed order. */
function OrderStep({ c, t, m, signer, contract, kind, hold, presetMove, onDone }: {
  c: WChain; t: TokenInfo; m: Market | null; signer: Signer; contract: string; kind: "limit" | "tp" | "sl"; hold: { native: Holding | null; token: Holding | null } | null; presetMove?: number; onDone: () => void;
}) {
  const now = m?.priceNative ?? null; // price of 1 token in BNB/ETH
  const nowUsd = m?.priceUsd ?? t.priceUsd ?? null;
  // The price target as a multiple of today's price.
  const [mult, setMult] = useState<number | null>(() => presetMove == null ? null : kind === "tp" ? presetMove : 1 - presetMove / 100);
  const [custom, setCustom] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [ok, setOk] = useState("");
  const side = kind === "limit" ? "buy" : "sell";
  const pay = side === "buy" ? c.native : t;
  const get = side === "buy" ? t : c.native;
  const bal = side === "buy" ? hold?.native : hold?.token;
  const target = custom && nowUsd ? Number(custom) / nowUsd : mult; // custom price is in USD
  const priceN = now && target ? now * target : null; // target price in BNB/ETH per token
  const A = Number(amount);
  const outQty = priceN && A > 0 ? (side === "sell" ? A * priceN : A / priceN) : 0;
  const what = kind === "limit" ? "Limit buy" : kind === "tp" ? "Take profit" : "Stop-loss";

  function part(p: number) {
    if (!bal) return;
    let v = (bal.amount * p) / 100;
    if (p >= 100 && isNative(c, pay.address)) v = Math.max(0, v - Number(GAS_RESERVE[c.key]));
    setAmount(plainNum(v, Math.min(8, pay.decimals)));
  }

  async function go() {
    setErr(""); setOk("");
    try {
      await placeOrder({ c, signer, contract, kind: kind === "sl" ? "stop" : "limit", side, payToken: pay, getToken: get, amount, outQty, slip: STOP_SLIPPAGE_DEFAULT, days: DAYS, step: setStep });
      setOk(`${what} placed. It runs on its own for ${DAYS} days and fills when ${t.symbol} reaches ${usd((nowUsd ?? 0) * (target ?? 0))}, even if you close the site.`);
      setTimeout(onDone, 3000);
    } catch (e) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  if (!now) return <p className="tb-q">I can't get a live price for {t.symbol} right now, so I can't set an order. Try again in a minute.</p>;
  if (ok) return <div className="tb-done">✅ {ok}</div>;
  const problem = !target ? "Pick a price" : !A ? "Pick an amount" : bal && A > bal.amount + 1e-12 ? `Not enough ${pay.symbol}` : !bal ? `No ${pay.symbol} in this wallet` : "";
  return (
    <>
      <p className="tb-q">{kind === "limit" ? `Buy ${t.symbol} automatically when the price drops by…` : kind === "tp" ? `Sell ${t.symbol} automatically when the price goes up to…` : `Sell ${t.symbol} automatically if the price falls by…`}</p>
      <div className="tb-btns">
        {kind === "tp"
          ? PROFITS.map((p) => <button key={p.label} type="button" className={"tb-chip" + (!custom && mult === p.mult ? " on" : "")} onClick={() => { setCustom(""); setMult(p.mult); }}>{p.label}</button>)
          : (kind === "limit" ? DIPS : STOPS).map((d) => <button key={d} type="button" className={"tb-chip" + (!custom && mult === 1 - d / 100 ? " on" : "")} onClick={() => { setCustom(""); setMult(1 - d / 100); }}>-{d}%</button>)}
      </div>
      <label className="tb-amt"><span>Or a price in USD</span>
        <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder={nowUsd ? plainNum(nowUsd, 12) : "0.0"} aria-label="Target price in USD" /><b>$</b>
      </label>
      {target && nowUsd && <small className="tb-dim">Target {usd(nowUsd * target)} ({target >= 1 ? "+" : ""}{((target - 1) * 100).toFixed(0)}% from {usd(nowUsd)} now)</small>}

      {target && (
        <>
          <p className="tb-q">{side === "buy" ? `How much ${c.native.symbol} should it spend?` : `How much of your ${t.symbol}?`}</p>
          <div className="tb-btns">
            {side === "buy"
              ? BUY_SIZES[c.key].map((v) => <button key={v} type="button" className={"tb-chip" + (A === v ? " on" : "")} onClick={() => setAmount(String(v))}>{v} {c.native.symbol}</button>)
              : PARTS.map((p) => <button key={p} type="button" className="tb-chip" disabled={!bal} onClick={() => part(p)}>{p === 100 ? "All" : `${p}%`}</button>)}
          </div>
          <label className="tb-amt"><span>Or type an amount</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.0" aria-label={`Amount of ${pay.symbol}`} /><b>{pay.symbol}</b>
          </label>
          <small className="tb-dim">You have {amt(bal?.amount ?? 0)} {pay.symbol}.</small>
        </>
      )}
      {outQty > 0 && (
        <div className="tb-quote">
          <div><span>{kind === "sl" ? "You get about" : "You get at least"}</span><b>{amt(outQty)} {get.symbol}</b></div>
          <div><span>Runs for</span><b>{DAYS} days, 24/7</b></div>
          <div><span>Fee</span><b>0.5% when it fills</b></div>
          {kind === "sl" && <div><span>Room in a fast drop</span><b>{STOP_SLIPPAGE_DEFAULT}%</b></div>}
        </div>
      )}
      <small className="tb-dim">Your {pay.symbol} stays in your wallet until the order fills. You sign once (free); if it's the first time, your wallet also approves this amount.</small>
      {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
        : <button type="button" className={`tb-go ${kind === "limit" ? "buy" : kind === "tp" ? "gold" : "sell"}`} disabled={!!problem} onClick={go}>{problem || `Set ${what.toLowerCase()}`}</button>}
      {err && <div className="aw-risk danger">{err}</div>}
    </>
  );
}

type Review = {
  chainName: string; path: string; symbol: string | null;
  verdict: { kind: "buy" | "wait" | "careful" | "sell" | "avoid"; emoji: string; title: string; summary: string; score: number; reasons: { level: string; text: string }[] };
  hold: { short: { level: string; title: string }; long: { level: string; title: string } };
  trust: { score: number | null; level: string; title: string; checks: { key: string; name: string; state: "ok" | "warn" | "bad"; text: string }[] };
  holders: { top: number; topShare: number | null; devPct: number | null; bundle: { level: string; title: string } | null };
  know: { level: string; text: string }[];
};

/** Scan & review: the built-in scanner's read on this coin, then the next step (buy, set a stop-loss…). */
function ScanStep({ c, t, canOrder, onAction, noTrade = false }: { c: WChain; t: TokenInfo; canOrder: boolean; onAction: (a: Action) => void; noTrade?: boolean }) {
  const [r, setR] = useState<Review | null>(null);
  const [err, setErr] = useState("");
  const [k, setK] = useState(0);
  useEffect(() => {
    let live = true;
    setR(null); setErr("");
    fetch("/api/analytics/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, token: t.address }) })
      .then(async (res) => { const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || "The scan didn't work. Try again."); return d as Review; })
      .then((d) => live && setR(d)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <><div className="aw-risk danger">{err}</div><button type="button" className="tb-chip" onClick={() => setK((n) => n + 1)}>Try again</button></>;
  if (!r) return <div className="tb-load"><span className="aw-spin" />Scanning {t.symbol}: safety, top 40 wallets, the dev and recent trades… (up to 30 seconds)</div>;
  const v = r.verdict;
  const tone = (l: string) => (l === "good" || l === "ok" ? "ok" : l === "bad" || l === "weak" ? "bad" : "warn");
  return (
    <div className="tb-scan">
      <div className={`tb-verdict ${v.kind}`}>
        <span className="tb-verdict-e" aria-hidden="true">{v.emoji}</span>
        <div><b>{v.title}</b><p>{v.summary}</p></div>
      </div>
      {v.kind !== "avoid" && (
        <div className="tb-meter" aria-label={`Buy score ${v.score} out of 100`}><i style={{ left: `${Math.max(2, Math.min(98, v.score))}%` }} /><small>Sell</small><small>Wait</small><small>Buy</small></div>
      )}
      <div className="tb-scan-grid">
        <div className={`tb-trust ${r.trust.level}`}>
          <small>Trust score</small>
          <b>{r.trust.score == null ? "?" : r.trust.score}<span>/100</span></b>
          <em>{r.trust.title}</em>
        </div>
        <div className="tb-holds">
          <span><small>Day trade</small><b className={tone(r.hold.short.level)}>{r.hold.short.title}</b></span>
          <span><small>Long term</small><b className={tone(r.hold.long.level)}>{r.hold.long.title}</b></span>
          <span><small>Top {r.holders.top || 40} wallets hold</small><b>{r.holders.topShare != null ? `${r.holders.topShare}%` : "–"}</b></span>
          <span><small>Dev holds</small><b>{r.holders.devPct != null ? `${r.holders.devPct}%` : "–"}</b></span>
          {r.holders.bundle && <span><small>Bundles</small><b className={r.holders.bundle.level === "low" ? "ok" : r.holders.bundle.level === "high" ? "bad" : "warn"}>{r.holders.bundle.title}</b></span>}
        </div>
      </div>
      <ul className="tb-checks">
        {r.trust.checks.map((ch) => <li key={ch.key} className={ch.state}><b>{ch.name}</b> {ch.text}</li>)}
      </ul>
      {(v.reasons.length > 0 || r.know.length > 0) && (
        <details className="tb-why" open>
          <summary>Why, and what buyers should know</summary>
          <ul>{[...v.reasons, ...r.know].slice(0, 8).map((x, i) => <li key={i} className={tone(x.level)}>{x.text}</li>)}</ul>
        </details>
      )}
      <p className="tb-q">What next?</p>
      <div className="tb-btns">
        {v.kind !== "avoid" && !noTrade && <button type="button" className="tb-chip" onClick={() => onAction("buy")}>Buy</button>}
        {canOrder && <button type="button" className="tb-chip" onClick={() => onAction("sl")}>Set a stop-loss</button>}
        {canOrder && <button type="button" className="tb-chip" onClick={() => onAction("tp")}>Set take profit</button>}
        <a className="tb-chip" href={r.path} target="_blank" rel="noopener noreferrer">Full scan report ↗</a>
      </div>
      <small className="tb-dim">Worked out automatically from blockchain activity on {r.chainName}. It can be wrong and isn&apos;t financial advice.</small>
    </div>
  );
}
