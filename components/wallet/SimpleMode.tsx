"use client";
import { useEffect, useRef, useState } from "react";
import { IMPACT_BLOCK, IMPACT_CONFIRM, MAX_SLIPPAGE_BPS, WCHAIN_LIST, isNative, isTokenAddress, toUnits, type WChain, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "./types";
import { GAS_RESERVE } from "./MarketForm";
import { Receive } from "./panels";
import { LISTINGS } from "@/lib/listings";
import { addTrade, amt, api, friendlyError, Logo, pct, raw2num, runTrade, usd, type Holding, type Quote, type TokenInfo } from "./util";

type Badge = "safer" | "caution" | "risky" | "scam";
type Coin = { token: string; symbol: string; name: string; image: string | null; price: number; change1h: number; change24h: number; liquidity: number; mcap: number | null; ageHours: number | null; badge: Badge; reasons: string[]; autistik?: "launchpad" | "listed" };
type Lists = { trending: Coin[]; fresh: Coin[]; listed: Coin[] };
const BADGE: Record<Badge, string> = { safer: "Safer", caution: "Caution", risky: "Risky", scam: "Scam warning" };
const age = (h: number | null) => (h == null ? "" : h < 1 ? "new" : h < 48 ? `${Math.floor(h)}h old` : `${Math.floor(h / 24)}d old`);
const PRESETS = [5, 10, 25, 50, 100];
const badgeFromRisk = (r: TokenInfo["risk"]): Badge => (r.honeypot ? "scam" : r.level === "danger" ? "risky" : r.level === "ok" ? "safer" : "caution");

/** Beginner screen: find a coin, see if it looks safe, buy with a dollar amount in one tap, sell in one tap. */
export default function SimpleMode({ c, onChain, signer, owner, holdings, balanceOf, onAdd, onDone, startBuy, startUsd }: {
  c: WChain; onChain: (k: WChainKey) => void; signer: Signer; owner: string; holdings: Holding[] | null;
  balanceOf: (a: string) => Holding | undefined; onAdd: (t: WToken) => void; onDone: () => void; startBuy?: string; startUsd?: number;
}) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [tab, setTab] = useState<"trending" | "fresh">("trending");
  const [q, setQ] = useState(""); const [qErr, setQErr] = useState("");
  const [buy, setBuy] = useState<Partial<Coin> & { token: string } | null>(() => {
    // Opened from a "Buy" link (home page, New listings): go straight to the Buy screen for that coin.
    if (!startBuy || !isTokenAddress(c, startBuy)) return null;
    const l = LISTINGS.find((x) => x.chain === c.key && x.token.toLowerCase() === startBuy.toLowerCase());
    return l ? { token: l.token, symbol: l.symbol, name: l.name } : { token: startBuy };
  });
  const [sell, setSell] = useState<Holding | null>(null);
  const [money, setMoney] = useState(false);

  useEffect(() => {
    setLists(null);
    api<Lists>("discover", { chain: c.key }).then((l) => setLists({ ...l, listed: l.listed || [] })).catch(() => setLists({ trending: [], fresh: [], listed: [] }));
  }, [c.key]);

  const total = (holdings || []).reduce((s, h) => s + (h.valueUsd || 0), 0);
  const mine = (holdings || []).filter((h) => !isNative(c, h.address) && h.amount > 0 && !/^(USD|W(BNB|ETH))/.test(h.symbol));
  const nat = holdings?.[0];
  // Coins listed by the team, then every token launched or listed on the AUTISTIK Launch Pad on this network.
  const listed = [
    ...LISTINGS.filter((l) => l.chain === c.key).map((l) => ({ token: l.token, symbol: l.symbol, name: l.name, note: l.note, image: null as string | null })),
    ...(lists?.listed || []).map((x) => ({ token: x.token, symbol: x.symbol, name: x.name, note: x.autistik === "listed" ? "Listed on AUTISTIK" : "Launched on AUTISTIK", image: x.image })),
  ].filter((l, i, all) => all.findIndex((y) => y.token.toLowerCase() === l.token.toLowerCase()) === i);
  const shown = (lists?.[tab] || []).filter((x) => !q || x.symbol.toLowerCase().includes(q.toLowerCase()) || x.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="sm">
      <section className="sm-top">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div><small>Your balance</small><div className="sm-total">{holdings ? usd(total) : "…"}</div><small>{nat ? `${amt(nat.amount)} ${c.native.symbol} ready to spend` : ""}</small></div>
          <select className="tx-net" value={c.key} onChange={(e) => onChain(e.target.value as WChainKey)} aria-label="Network">
            {WCHAIN_LIST.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </div>
        <div className="sm-actions">
          <button type="button" className="sm-btn main" onClick={() => setMoney(true)}>Add money</button>
          <button type="button" className="sm-btn" onClick={() => document.getElementById("sm-mine")?.scrollIntoView({ behavior: "smooth" })}>Sell</button>
        </div>
      </section>

      <form className="sm-search" onSubmit={(e) => { e.preventDefault(); const v = q.trim(); if (isTokenAddress(c, v)) { setBuy({ token: v }); setQ(""); } else setQErr(`Paste a ${c.name} coin address, or pick one below.`); }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setQErr(""); const v = e.target.value.trim(); if (isTokenAddress(c, v)) { setBuy({ token: v }); setQ(""); } }}
          placeholder="Search, or paste a coin address" aria-label="Find a coin" spellCheck={false} autoComplete="off" />
      </form>
      {qErr && <small className="down">{qErr}</small>}

      {!!listed.length && (
        <section className="stack sm-listed" style={{ gap: 6 }}>
          <b>New on AUTISTIK</b>
          {listed.map((l) => (
            <button key={l.token} type="button" className="sm-coin" onClick={() => setBuy({ token: l.token, symbol: l.symbol, name: l.name })}>
              <Logo t={{ symbol: l.symbol, logo: l.image }} size={38} />
              <span className="grow"><b>{l.symbol}</b><small>{l.name} · {l.note}</small></span>
              <span className="sm-buy">Buy</span>
            </button>
          ))}
        </section>
      )}

      <div className="sm-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "trending"} className={tab === "trending" ? "on" : ""} onClick={() => setTab("trending")}>Trending</button>
        <button type="button" role="tab" aria-selected={tab === "fresh"} className={tab === "fresh" ? "on" : ""} onClick={() => setTab("fresh")}>New today</button>
      </div>
      <div className="sm-list">
        {!lists && <div className="tx-dim">Finding coins…</div>}
        {lists && !shown.length && <div className="tx-dim">No coins to show right now.</div>}
        {shown.map((x) => (
          <button key={x.token} type="button" className="sm-coin" onClick={() => setBuy(x)}>
            <Logo t={{ symbol: x.symbol, logo: x.image }} size={38} />
            <span className="grow"><span><b>{x.symbol}</b>{x.autistik && <span className="sm-ours">AUTISTIK</span>}</span><small>{x.name}{x.ageHours != null ? ` · ${age(x.ageHours)}` : ""}</small></span>
            <span className="sm-num"><b>{usd(x.price)}</b><small className={x.change24h >= 0 ? "up" : "down"}>{pct(x.change24h)}</small></span>
            <span className={"sm-badge " + x.badge}>{BADGE[x.badge]}</span>
          </button>
        ))}
      </div>

      <section id="sm-mine" className="stack" style={{ gap: 6 }}>
        <b>My coins</b>
        {!mine.length && <div className="tx-dim">Coins you buy show here. Tap one to sell.</div>}
        {mine.map((h) => (
          <button key={h.address} type="button" className="sm-coin" onClick={() => setSell(h)}>
            <Logo t={h} size={34} />
            <span className="grow"><b>{h.symbol}</b><small>{amt(h.amount)}</small></span>
            <span className="sm-num"><b>{usd(h.valueUsd)}</b></span>
            <span className="sm-sell">Sell</span>
          </button>
        ))}
      </section>

      {buy && <BuySheet c={c} signer={signer} owner={owner} coin={buy} nat={nat} startUsd={buy.token === startBuy ? startUsd : undefined} onAdd={onAdd} onMoney={() => { setBuy(null); setMoney(true); }} onClose={() => setBuy(null)} onDone={onDone} />}
      {sell && <SellSheet c={c} signer={signer} owner={owner} h={sell} onClose={() => setSell(null)} onDone={onDone} />}
      {money && (
        <Sheet title={`Add money on ${c.name}`} onClose={() => setMoney(false)}>
          <ol className="sm-steps">
            <li>Buy <b>{c.native.symbol}</b> on an exchange like Binance (card, bank or mobile money).</li>
            <li>Withdraw it to your address below. Pick the network <b>{c.key === "bsc" ? "BNB Smart Chain (BEP20)" : c.name}</b>.</li>
            <li>It shows here in a minute or two. Then pick a coin and tap Buy.</li>
          </ol>
          <Receive c={c} address={owner} />
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="aw-sheet" role="dialog" aria-label={title} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-sheet-in sm-sheet">
        <div className="row" style={{ justifyContent: "space-between" }}><b>{title}</b><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** Live price for a trade, refreshed when the amount changes. */
function useQuote(c: WChain, tokenIn: string, tokenOut: string, raw: bigint | null) {
  const [q, setQ] = useState<Quote | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    setQ(null); setErr("");
    if (!raw || raw <= 0n) return;
    const id = ++seq.current; setBusy(true);
    const t = setTimeout(() => api<{ quote: Quote }>("quote", { chain: c.key, tokenIn, tokenOut, amount: raw.toString() })
      .then((d) => id === seq.current && setQ(d.quote)).catch((e) => id === seq.current && setErr(e.message)).finally(() => id === seq.current && setBusy(false)), 350);
    return () => clearTimeout(t);
  }, [c.key, tokenIn, tokenOut, raw?.toString()]); // eslint-disable-line react-hooks/exhaustive-deps
  return { q, err, busy };
}

function BuySheet({ c, signer, owner, coin, nat, startUsd, onAdd, onMoney, onClose, onDone }: {
  c: WChain; signer: Signer; owner: string; coin: Partial<Coin> & { token: string }; nat: Holding | undefined; startUsd?: number;
  onAdd: (t: WToken) => void; onMoney: () => void; onClose: () => void; onDone: () => void;
}) {
  const [info, setInfo] = useState<TokenInfo | null>(null); const [infoErr, setInfoErr] = useState("");
  const [usdAmt, setUsdAmt] = useState(startUsd && PRESETS.includes(startUsd) ? startUsd : 10);
  const [custom, setCustom] = useState(startUsd && !PRESETS.includes(startUsd) ? String(startUsd) : "");
  const [ack, setAck] = useState(false); const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState<string | null>(null);
  useEffect(() => { api<{ token: TokenInfo }>("token", { chain: c.key, address: coin.token }).then((d) => { setInfo(d.token); onAdd(d.token); }).catch((e) => setInfoErr(e.message)); }, [c.key, coin.token]); // eslint-disable-line react-hooks/exhaustive-deps
  const natUsd = nat?.priceUsd ?? null;
  const dollars = custom ? Number(custom) : usdAmt;
  const payNative = natUsd && dollars > 0 ? dollars / natUsd : 0;
  const raw = payNative > 0 ? toUnits(payNative.toFixed(Math.min(c.native.decimals, 12)), c.native.decimals) : null;
  const { q, err: qErr, busy } = useQuote(c, c.native.address, coin.token, raw);
  const badge: Badge = info ? (coin.badge === "scam" || info.risk.honeypot ? "scam" : coin.badge && coin.badge !== "safer" ? coin.badge : badgeFromRisk(info.risk)) : coin.badge ?? "caution";
  const reasons = [...new Set([...(info?.risk.notes || []), ...(coin.reasons || [])])].slice(0, 4);
  const out = q && info ? raw2num(q.amountOut, info.decimals) : 0;
  const keep = Number(GAS_RESERVE[c.key]);
  const short = nat ? payNative + keep > nat.amount : true;
  const impact = q?.impact ?? null;
  const blocked = badge === "scam" ? "This coin looks like a scam (people can't sell it). Buying is blocked to protect you."
    : impact != null && impact >= IMPACT_BLOCK ? "This coin's pool is too small for that amount. Try less." : "";
  const needAck = badge === "risky" || (impact != null && impact >= IMPACT_CONFIRM);
  const tax = Math.max(info?.risk.buyTax || 0, info?.risk.sellTax || 0);
  const slip = Math.min(MAX_SLIPPAGE_BPS, tax > 0 ? Math.ceil((tax + 3) * 100) : 300);

  async function go() {
    if (!q || !info) return;
    setErr("");
    try {
      const hash = await runTrade(c, signer, owner, q, c.native, slip, setStep);
      addTrade({ at: Date.now(), chain: c.key, side: "buy", pay: `${amt(payNative)} ${c.native.symbol}`, get: `${amt(out)} ${info.symbol}`, hash });
      setDone(hash); onDone();
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  const sym = info?.symbol || coin.symbol || "coin";
  return (
    <Sheet title={`Buy ${sym}`} onClose={onClose}>
      {infoErr ? <div className="aw-risk danger">{infoErr}</div> : (
        <>
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <Logo t={{ symbol: sym, logo: coin.image ?? info?.logo }} size={44} />
            <div className="grow"><b style={{ fontSize: "1.15em" }}>{sym}</b><br /><small className="tx-dim">{info?.name || coin.name}{coin.ageHours != null ? ` · ${age(coin.ageHours)}` : ""}</small></div>
            <span className={"sm-badge " + badge}>{BADGE[badge]}</span>
          </div>
          <ul className={"sm-why " + badge}>{(reasons.length ? reasons : ["Checking safety…"]).map((r) => <li key={r}>{r}</li>)}</ul>
          {done ? (
            <div className="stack" style={{ gap: 10 }}>
              <div className="aw-risk ok"><b>Done! You bought about {amt(out)} {sym}.</b> It&apos;s in your wallet now.</div>
              <a className="btn" href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
              <button type="button" className="tx-cta buy" onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              <b>How much do you want to spend?</b>
              <div className="sm-presets">
                {PRESETS.map((p) => <button key={p} type="button" className={!custom && usdAmt === p ? "on" : ""} onClick={() => { setUsdAmt(p); setCustom(""); }}>${p}</button>)}
                <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other $" aria-label="Other amount in dollars" />
              </div>
              <div className="aw-details">
                <div><span>You pay</span><b>{natUsd ? `${amt(payNative)} ${c.native.symbol} (${usd(dollars)})` : "…"}</b></div>
                <div><span>You get about</span><b>{busy ? "…" : q ? `${amt(out)} ${sym}` : "–"}</b></div>
                <div><span>Fee</span><b>{q?.feeBps ? `${q.feeBps / 100}%` : "0%"}{q?.gasUsd ? ` + network ≈ ${usd(q.gasUsd)}` : ""}</b></div>
              </div>
              {qErr && <div className="aw-risk warn">{qErr}</div>}
              {short && <div className="aw-risk warn">You need more {c.native.symbol} for this (keep a little for network fees). <button type="button" className="aw-link" onClick={onMoney}>Add money</button></div>}
              {blocked && <div className="aw-risk danger">{blocked}</div>}
              {needAck && !blocked && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this coin is risky and I could lose this money.</label>}
              {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
                : <button type="button" className="tx-cta buy sm-go" disabled={!q || !!blocked || short || (needAck && !ack)} onClick={go}>{short ? `Not enough ${c.native.symbol}` : `Buy ${sym} for ${usd(dollars)}`}</button>}
              {err && <div className="aw-risk danger">{err}</div>}
              <small className="tx-dim">New coins are very risky: many lose most of their value. Only spend what you can afford to lose. Not financial advice.</small>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function SellSheet({ c, signer, owner, h, onClose, onDone }: { c: WChain; signer: Signer; owner: string; h: Holding; onClose: () => void; onDone: () => void }) {
  const [part, setPart] = useState(100); const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState<string | null>(null);
  const [tax, setTax] = useState(0);
  useEffect(() => { api<{ token: TokenInfo }>("token", { chain: c.key, address: h.address }).then((d) => setTax(d.token.risk.sellTax || 0)).catch(() => {}); }, [c.key, h.address]);
  const raw = (BigInt(h.raw) * BigInt(part)) / 100n;
  const { q, err: qErr, busy } = useQuote(c, h.address, c.native.address, raw);
  const out = q ? raw2num(q.amountOut, c.native.decimals) : 0;
  const slip = Math.min(MAX_SLIPPAGE_BPS, tax > 0 ? Math.ceil((tax + 3) * 100) : 300);
  async function go() {
    if (!q) return;
    setErr("");
    try {
      const hash = await runTrade(c, signer, owner, q, h, slip, setStep);
      addTrade({ at: Date.now(), chain: c.key, side: "sell", pay: `${amt(raw2num(raw.toString(), h.decimals))} ${h.symbol}`, get: `${amt(out)} ${c.native.symbol}`, hash });
      setDone(hash); onDone();
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }
  return (
    <Sheet title={`Sell ${h.symbol}`} onClose={onClose}>
      {done ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="aw-risk ok"><b>Sold.</b> You got about {amt(out)} {c.native.symbol}.</div>
          <a className="btn" href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
          <button type="button" className="tx-cta" onClick={onClose}>Close</button>
        </div>
      ) : (
        <>
          <div className="sm-presets">{[25, 50, 100].map((p) => <button key={p} type="button" className={part === p ? "on" : ""} onClick={() => setPart(p)}>{p === 100 ? "All" : `${p}%`}</button>)}</div>
          <div className="aw-details">
            <div><span>You sell</span><b>{amt(raw2num(raw.toString(), h.decimals))} {h.symbol}</b></div>
            <div><span>You get about</span><b>{busy ? "…" : q ? `${amt(out)} ${c.native.symbol}${q.outUsd ? ` (${usd(q.outUsd)})` : ""}` : "–"}</b></div>
            {tax > 0 && <div><span>Coin&apos;s sell tax</span><b>{Math.round(tax)}%</b></div>}
          </div>
          {qErr && <div className="aw-risk warn">{qErr}</div>}
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
            : <button type="button" className="tx-cta sell sm-go" disabled={!q || raw <= 0n} onClick={go}>Sell {part === 100 ? "all" : `${part}%`}</button>}
          {err && <div className="aw-risk danger">{err}</div>}
        </>
      )}
    </Sheet>
  );
}
