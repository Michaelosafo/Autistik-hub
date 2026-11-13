"use client";
/**
 * Admin: the AI trader. Turn it on or off, practice (pretend BNB) or live (its own wallet), how much per trade, how
 * many coins at once, the safety gates, default stop-loss / take profit / trailing stop, and each coin's own
 * stop-loss and take profit. Shows open coins with live profit, closed trades and everything it did.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtAmount, fmtUsd } from "@/lib/num-format";
import AITraderCopy, { type CopyData } from "@/components/AITraderCopy";
import TraderTabs from "@/components/TraderTabs";
import { BuyHours, JustBought, StableMode, TrackedBoard, TradeActions, WalletCoins, WalletPanel } from "@/components/AITraderExtras";

type S = {
  enabled: boolean; mode: "paper" | "live"; paper_cash: number; paper_start: number; per_trade: number; max_positions: number; min_liquidity: number;
  max_tax: number; min_age_hours: number; stop_loss: number; take_profit: number; trail: number; max_hold_hours: number; daily_loss_limit: number;
  use_ai: boolean; last_run: string; last_note: string | null; chains: string[]; need_socials: boolean; manual_active: boolean; away_take_profit: number;
  signals_on: boolean; callers: string[]; caller_mcap_max: number; per_trade_usd: number;
  hype_on: boolean; dip_on: boolean; mcap_min: number; mcap_max: number; micro_min_liq: number; target_profit: number; strat_stop: number;
  copy_on: boolean; copy_tp: number; copy_sl: number; trade_mode: string; rebuy_on: boolean; rebuy_dump: number; rebuy_tp: number;
  use_tg: boolean; use_x: boolean; use_general: boolean; copy_check: boolean; callers_only: boolean;
  buy_hours_on?: boolean; buy_from?: string; buy_to?: string; buy_tz?: string;
};
type P = {
  id: string; mode: string; chain: string; strategy?: string | null; token: string; symbol: string | null; name: string | null; logo: string | null; status: string; spent: number; qty: number;
  entry_usd: number; high_usd: number; last_usd: number | null; stop_loss: number; take_profit: number; trail: number; why: string | null;
  buy_tx: string | null; sell_tx: string | null; received: number | null; pnl: number | null; pnl_pct: number | null; close_reason: string | null; opened_at: string; closed_at: string | null;
  low_usd?: number | null; source_group?: string | null; source_who?: string | null; shared_at?: string | null; coin_age_hours?: number | null; pump_1h?: number | null; wallet?: number | null; native?: string | null; spent_native?: number | null; received_native?: number | null;
};

/** Seconds → "42s", "10m", "2.5h", "8d". */
const secs = (x: number) => (!isFinite(x) || x < 0 ? "0s" : x < 60 ? `${Math.round(x)}s` : x < 3600 ? `${Math.round(x / 60)}m` : x < 86400 ? `${(x / 3600).toFixed(x < 36000 ? 1 : 0)}h` : `${Math.round(x / 86400)}d`);

/** 1234567 → 1.23M (token amounts). */
function qtyFmt(n: number) {
  if (!isFinite(n) || n <= 0) return "–";
  for (const [d, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) if (n >= d) return `${(n / d).toFixed(n / d >= 100 ? 0 : 2)}${u}`;
  return n >= 1 ? n.toFixed(2) : n.toPrecision(3);
}

/**
 * The facts of one trade: how many coins it bought (and for how much), which group / account shared the call (and
 * who posted it), and the price range since buying: lowest → highest, with where it bought, where it is now, and the
 * stop-loss and take-profit prices.
 */
function TradeFacts({ p, closed = false }: { p: P; closed?: boolean }) {
  const entry = Number(p.entry_usd) || 0;
  const now = Number(p.last_usd) || entry;
  const sl = entry * (1 - Number(p.stop_loss) / 100), tp = entry * (1 + Number(p.take_profit) / 100);
  const lo = Math.min(Number(p.low_usd) || entry, entry, now), hi = Math.max(Number(p.high_usd) || entry, entry, now);
  const span = hi - lo || entry * 0.0001 || 1;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / span) * 100))}%`;
  const native = p.native || "BNB";
  const paid = p.spent_native != null ? Number(p.spent_native) : Number(p.spent);
  return (
    <div className="ait-facts">
      <span className="ait-fact"><i aria-hidden="true">🪙</i>Bought <b>{qtyFmt(Number(p.qty))} {p.symbol}</b> for <b>{fmtAmount(paid)} {native}</b>{closed && p.received_native != null ? <> · got back <b>{fmtAmount(Number(p.received_native))} {native}</b></> : null}</span>
      {p.source_group && (
        <span className="ait-fact"><i aria-hidden="true">📣</i>Caller: <b>{p.source_who || p.source_group}</b>{p.source_who ? <> in <b>{p.source_group}</b></> : null}</span>
      )}
      {(p.shared_at || p.coin_age_hours != null) && (
        <span className="ait-fact"><i aria-hidden="true">⏱</i>
          {p.shared_at ? <>Shared <b>{secs((Date.parse(p.opened_at) - Date.parse(p.shared_at)) / 1000)}</b> before the buy</> : null}
          {p.coin_age_hours != null ? <>{p.shared_at ? " · " : ""}coin was <b>{secs(Number(p.coin_age_hours) * 3600)}</b> old</> : null}
          {p.pump_1h != null ? <> · <b>{Number(p.pump_1h) >= 0 ? "+" : ""}{Math.round(Number(p.pump_1h))}%</b> in the hour before</> : null}
          {Number(p.wallet) === 2 ? <> · <b>Wallet 2</b></> : null}
        </span>
      )}
      {entry > 0 && (
        <div className="ait-range" aria-label={`Price range ${fmtUsd(lo)} to ${fmtUsd(hi)}`}>
          <div className="ait-range-bar">
            <span className="ait-range-fill" style={{ left: at(Math.min(entry, now)), width: `calc(${at(Math.max(entry, now))} - ${at(Math.min(entry, now))})` }} data-up={now >= entry ? "1" : "0"} />
            <i className="ait-mk entry" style={{ left: at(entry) }} title={`Bought at ${fmtUsd(entry)}`} />
            <i className={"ait-mk now" + (now >= entry ? " up" : " down")} style={{ left: at(now) }} title={`${closed ? "Sold at" : "Now"} ${fmtUsd(now)}`} />
          </div>
          <div className="ait-range-l">
            <span>Low <b>{fmtUsd(lo)}</b></span>
            <span>Bought <b>{fmtUsd(entry)}</b></span>
            <span>{closed ? "Sold" : "Now"} <b className={now >= entry ? "up" : "down"}>{fmtUsd(now)}</b></span>
            <span>High <b>{fmtUsd(hi)}</b></span>
          </div>
          {!closed && <small className="ait-range-t">Stop-loss at <b className="down">{fmtUsd(sl)}</b> · take profit at <b className="up">{fmtUsd(tp)}</b></small>}
        </div>
      )}
    </div>
  );
}
type Sig = { id: number; at: string; source: string; who: string | null; body: string | null; url: string; chain: string; token: string; symbol: string | null; mcap: number | null; result: string | null };
type Data = { isOwner: boolean; traderId: number; copy: CopyData; perTradeBnb: number; bnbUsd?: number | null; signals: Sig[]; sources: { x: boolean; telegram: boolean }; settings: S; open: P[]; closed: P[]; log: { id: number; at: string; kind: string; text: string }[]; wallet: { address: string | null; bnb: number | null }; liveReady: boolean; owner: boolean; active: boolean; activeMinutes: number; stats: { trades: number; wins: number; winRate: number | null; pnl: number } };

const CHAINS = [
  { k: "bsc", name: "BNB Chain", note: "Always on: the AI trades with BNB" },
  { k: "ethereum", name: "Ethereum", note: "ETH coins" },
  { k: "robinhood", name: "Robinhood Chain", note: "Robinhood Chain coins" },
  { k: "elysium", name: "Elysium", note: "Hyperliquid's L2 (HYPE)" },
  { k: "solana", name: "Solana", note: "Optional" },
];
const chainName = (k: string) => CHAINS.find((c) => c.k === k)?.name || k;
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const sign = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);
async function post(action: string, body: unknown) {
  const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}

const FIELDS: { k: keyof S; label: string; unit: string; step: string; hint: string }[] = [
  { k: "per_trade_usd", label: "Per trade in $", unit: "$", step: "1", hint: "Spends this many dollars of BNB on each coin (0 = use the BNB amount below)" },
  { k: "per_trade", label: "Per trade in BNB", unit: "BNB", step: "0.001", hint: "Used only when the $ amount is 0" },
  { k: "max_positions", label: "Coins at once", unit: "", step: "1", hint: "Most coins it holds at the same time" },
  { k: "stop_loss", label: "Stop-loss", unit: "%", step: "1", hint: "Sells if a coin falls this much below the buy price" },
  { k: "take_profit", label: "Take profit", unit: "%", step: "5", hint: "Sells when a coin is up this much" },
  { k: "trail", label: "Trailing stop", unit: "%", step: "1", hint: "Once up 10%+, sells if it drops this much from its high (0 = off)" },
  { k: "max_hold_hours", label: "Max hold", unit: "hours", step: "1", hint: "Sells anything held longer than this" },
  { k: "min_liquidity", label: "Min liquidity", unit: "$", step: "1000", hint: "Skips coins with a smaller pool" },
  { k: "max_tax", label: "Max tax", unit: "%", step: "1", hint: "Skips coins with a higher buy or sell tax" },
  { k: "min_age_hours", label: "Min coin age", unit: "hours", step: "1", hint: "Skips coins newer than this" },
  { k: "daily_loss_limit", label: "Daily loss limit", unit: "BNB", step: "0.05", hint: "Pauses itself after losing this much in 24 hours" },
];

export default function AITrader() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState<Partial<Record<keyof S, string>>>({});
  const load = () => fetch("/api/ai-trader/status", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  async function act(name: string, action: string, body: unknown, done?: string) {
    setBusy(name); setMsg("");
    try { const r = await post(action, body); setMsg(done || r.note || r.skipped || "Done."); await load(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  }

  if (err && !d) return <div className="card"><b>AI trader</b><p className="muted">{err}</p></div>;
  if (!d) return <div className="card"><small className="muted">Loading the AI trader…</small></div>;
  const s = d.settings;
  const live = s.mode === "live";
  const cash = live ? d.wallet.bnb : s.paper_cash;
  const invested = d.open.filter((p) => p.mode === s.mode).reduce((a, p) => a + Number(p.spent), 0);
  const value = d.open.filter((p) => p.mode === s.mode).reduce((a, p) => a + Number(p.spent) * ((Number(p.last_usd) || Number(p.entry_usd)) / Number(p.entry_usd)), 0);
  const openNow = d.open.filter((p) => p.mode === s.mode);
  const freeUsd = cash != null && d.bnbUsd ? cash * d.bnbUsd : null;

  return (
    <div className="stack ait">
      <TraderTabs />
      <div className="page-head">
        <Link href="/admin" className="muted">← Admin</Link>
        <div className="label">{d.isOwner ? "Owner" : "Admin"} · your own trader</div>
        <h1>🤖 AI trader</h1>
        <p className="muted ait-mine">This trader is yours alone: its wallet, settings, Telegram and X logins, followed groups and trades are separate from every other admin&apos;s.</p>
        <p className="muted">It trades with BNB. It looks at coins trending and new on BNB Chain, Ethereum and Robinhood Chain (Solana if you turn it on), favours coins with buzz on X and Telegram, keeps only ones that pass the safety checks (safety label, honeypot, taxes, liquidity, age), lets the AI pick the best, buys, and sells on stop-loss, take profit, trailing stop or max hold time. It checks every 5 minutes.</p>
      </div>

      <JustBought open={openNow} busy={!!busy} onAct={act} freeUsd={freeUsd} />
      <WalletPanel live={live} cash={cash} open={openNow} bnbUsd={d.bnbUsd ?? null} wallets={d.copy.wallets || []} wallets2={d.copy.wallets2} />
      {live && <WalletCoins busy={!!busy} onAct={act} dsl={Number((s as any).copy_sl) || 5} dtp={Number((s as any).copy_tp) || 100} />}

      <section className={"card ait-top" + (s.enabled ? " on" : "")}>
        <div className="ait-state">
          <span className={"ait-dot" + (s.enabled ? " on" : "")} aria-hidden="true" />
          <div><b>{s.enabled ? "Started: looking for trades" : "Stopped: not buying"}</b> · {live ? "LIVE (real BNB)" : "Practice (pretend BNB)"}<br /><small className="muted">{s.last_note || "Hasn't run yet."} {s.last_run && Date.parse(s.last_run) > 0 ? `· ${ago(s.last_run)}` : ""}</small></div>
        </div>
        <button type="button" className={"ait-go" + (s.enabled ? " stop" : "")} disabled={!!busy}
          onClick={() => act("toggle", "settings", { enabled: !s.enabled }, s.enabled ? "Stopped. It won't buy anything until you press Start. Open coins still have their stop-loss and target." : "Started. It checks fresh signals every minute and scans for setups every 5 minutes.")}>
          {s.enabled ? "■ STOP" : "▶ START"}
        </button>
        <div className="ait-size">Each trade: <b>{s.per_trade_usd > 0 ? `$${s.per_trade_usd}` : `${s.per_trade} BNB`}</b> <small className="muted">({fmtAmount(d.perTradeBnb)} BNB{cash != null && d.perTradeBnb > 0 ? ` · room for about ${Math.floor(cash / d.perTradeBnb)} trades` : ""})</small>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt("How many dollars of BNB should each trade use?", String(s.per_trade_usd || 5)); if (v && Number(v) > 0) act("size", "settings", { per_trade_usd: Number(v) }, `Each trade now uses $${Number(v)} of BNB.`); }}>Change</button></div>
        <small className="muted">{s.enabled ? "Stop halts all buying until you press Start again." : "Start makes it look for trades and buy."} Open coins are always protected by their stop-loss and target.</small>
        {s.enabled && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => act("run", "run", {})}>{busy === "run" ? "Scanning…" : "Scan now"}</button>}
      </section>

      <StableMode on={!!(s as any).stable_on} live={live} sol={(d.copy.wallets || []).find((w) => w.chain === "solana") ?? null} busy={!!busy} onAct={act} />
      <BuyHours s={s} busy={!!busy} onAct={act} />

      <AITraderCopy c={d.copy} s={s} owner={d.owner} busy={!!busy} onAct={act} reload={load} />

      <section className="ait-stats">
        <div><small>{live ? "Wallet BNB" : "Practice BNB"}</small><b>{cash == null ? "–" : fmtAmount(cash)}</b></div>
        <div><small>In coins</small><b>{fmtAmount(invested)} BNB</b><em className={value - invested >= 0 ? "up" : "down"}>{sign(value - invested)} BNB now</em></div>
        <div><small>Closed trades</small><b>{d.stats.trades}</b><em>{d.stats.winRate == null ? "–" : `${d.stats.winRate}% won`}</em></div>
        <div><small>Profit (closed)</small><b className={d.stats.pnl >= 0 ? "up" : "down"}>{sign(d.stats.pnl)} BNB</b>{!live && <em>from {s.paper_start} BNB start</em>}</div>
      </section>

      <section className={"card ait-ctrl" + (s.manual_active && d.active ? " you" : " ai")}>
        <div className="ait-ctrl-h">
          <span className="ait-ctrl-ic" aria-hidden="true">{s.manual_active && d.active ? "🧑‍✈️" : "🤖"}</span>
          <div className="grow">
            <b>{s.manual_active && d.active ? "You're in control" : "The AI is in control"}</b>
            <small className="muted">{s.manual_active
              ? d.active ? `While you're here, nothing is sold for you: tap Sell on any coin when you want. If you leave for ${d.activeMinutes} minutes, the AI takes over and sells at +${s.away_take_profit}% (or the stop-loss).`
                : `Nobody is here, so the AI sells at +${s.away_take_profit}% or the stop-loss. Open this page and you're back in control.`
              : `The AI follows the rules below all the time.`}</small>
          </div>
        </div>
        <label className="ait-check"><input type="checkbox" checked={s.manual_active} disabled={!!busy} onChange={(e) => act("manual", "settings", { manual_active: e.target.checked }, e.target.checked ? "You close trades yourself while you're here." : "The AI follows the rules all the time.")} /> <span>I close trades myself while I&apos;m here</span></label>
        {s.manual_active && (
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>When I&apos;m away, the AI sells at</span>
            <span className="ait-in" style={{ width: 110 }}><input inputMode="decimal" defaultValue={String(s.away_take_profit)} onBlur={(e) => { const v = Number(e.target.value); if (v && v !== s.away_take_profit) act("away", "settings", { away_take_profit: v }, `Away take profit: +${v}%.`); }} /><em>%</em></span>
            <small className="muted">profit</small>
          </div>
        )}
      </section>

      <Bought open={openNow} closed={d.closed.filter((p) => p.mode === s.mode)} busy={!!busy} onAct={act} freeUsd={freeUsd} onSell={(p) => { if (confirm(`Cancel ${p.symbol}: sell all of it now?`)) act("close", "close", { id: p.id }, `${p.symbol} sold.`); }}
        onForget={(p) => { if (confirm(`Stop the bot managing ${p.symbol}? Nothing is sold: the coins stay in your wallet and you sell them yourself.`)) act("forget", "forget", { id: p.id }, `${p.symbol}: the bot stopped managing it.`); }} />

      <section className="card stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <b>Mode</b>
          <div className="ait-seg" role="radiogroup" aria-label="Mode">
            <button type="button" role="radio" aria-checked={!live} className={!live ? "on" : ""} disabled={!!busy} onClick={() => act("mode", "settings", { mode: "paper" }, "Practice mode: pretend BNB, real prices.")}>Practice</button>
            <button type="button" role="radio" aria-checked={live} className={live ? "on live" : ""} disabled={!!busy || !d.liveReady || !d.owner} onClick={() => { if (confirm("Switch to LIVE? It will trade real BNB from the AI trader wallet.")) act("mode", "settings", { mode: "live" }, "Live mode on."); }}>Live</button>
          </div>
        </div>
        {d.liveReady ? (
          <div className="ait-wallet">
            <small className="muted">Live trading wallet (BNB Chain)</small>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <code className="ait-addr">{d.wallet.address}</code>
              <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(d.wallet.address || ""); setMsg("Address copied."); }}>Copy</button>
            </div>
            <b>{d.wallet.bnb != null ? `${fmtAmount(d.wallet.bnb)} BNB` : "–"}</b>
            <small className="muted">To fund it, send BNB on <b>BNB Chain</b> to this address from your own wallet or an exchange. Only this wallet is ever traded.</small>
            {d.owner && <KeyTools busy={!!busy} onAct={act} />}
            {d.owner && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => { const to = prompt("Send all the BNB back to which BNB Chain address? (your own wallet)"); if (to && confirm(`Send all BNB from the AI trader wallet to ${to}?`)) act("withdraw", "withdraw", { to }); }}>Withdraw BNB to my wallet</button>}
          </div>
        ) : d.owner ? (
          <div className="ait-wallet">
            <small className="muted">Live trading needs its own wallet. Create one here: it's made on the server, its key is locked in the database vault (nobody sees it, not even here), and you can withdraw the BNB to your own wallet any time.</small>
            <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => { if (confirm("Create the AI trader's live wallet?")) act("wallet", "wallet", {}); }}>Create live wallet</button>
            <KeyTools busy={!!busy} onAct={act} importOnly />
          </div>
        ) : <small className="muted">Live trading is set up by the owner.</small>}
        {!live && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => { const v = prompt("Reset the practice account to how much pretend BNB?", "1"); if (v) act("reset", "reset", { start: Number(v) }, "Practice account reset."); }}>Reset practice account</button>}
      </section>

      <TrackedBoard copy={d.copy} xCallers={s.callers || []} signals={d.signals} positions={[...d.open, ...d.closed]} callersOnly={s.callers_only} normalUsd={Number((s as any).per_trade_usd) || 0} dsl={Number((s as any).copy_sl) || 5} dtp={Number((s as any).copy_tp) || 100} busy={!!busy} onAct={act} />

      <Strategy s={s} busy={!!busy} onAct={act} />
      <Signals d={d} busy={!!busy} onAct={act} />

      <section className="card stack">
        <b>Where it looks</b>
        <div className="ait-chains">
          {CHAINS.map((c) => {
            const on = s.chains.includes(c.k);
            return (
              <button key={c.k} type="button" className={"ait-chain" + (on ? " on" : "")} aria-pressed={on} disabled={!!busy || c.k === "bsc"}
                onClick={() => act("chains", "settings", { chains: on ? s.chains.filter((x) => x !== c.k) : [...s.chains, c.k] }, `${c.name} ${on ? "off" : "on"}.`)}>
                <b>{on ? "✓ " : ""}{c.name}</b><small>{c.note}</small>
              </button>
            );
          })}
        </div>
        <label className="ait-check"><input type="checkbox" checked={s.need_socials} disabled={!!busy} onChange={(e) => act("soc", "settings", { need_socials: e.target.checked })} /> <span>Only coins with an X or Telegram community (coins being pushed on X / Telegram right now score higher)</span></label>
        {live && <small className="muted">Live mode buys on BNB Chain only, because the wallet holds BNB. The other chains are traded in practice mode.</small>}
      </section>

      <section className="card stack">
        <b>Rules</b>
        <div className="ait-form">
          {FIELDS.map((f) => (
            <label key={f.k}>
              <span>{f.label}</span>
              <span className="ait-in"><input inputMode="decimal" step={f.step} value={form[f.k] ?? String(s[f.k])} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />{f.unit && <em>{f.unit}</em>}</span>
              <small>{f.hint}</small>
            </label>
          ))}
          <label className="ait-check"><input type="checkbox" checked={s.use_ai} onChange={(e) => act("ai", "settings", { use_ai: e.target.checked })} /> <span>Let the AI pick among the safe coins (off: highest momentum score wins)</span></label>
        </div>
        <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy || !Object.keys(form).length} onClick={() => act("save", "settings", Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])), "Rules saved. New coins use the new stop-loss and take profit.").then(() => setForm({}))}>Save rules</button>
      </section>

      <section className="card stack">
        <b>Open coins ({d.open.length})</b>
        {!d.open.length ? <small className="muted">Nothing open. It buys when a coin passes every check.</small> : d.open.map((p) => <Open key={p.id} p={p} busy={!!busy} onAct={act} />)}
      </section>

      <section className="card stack">
        <b>Closed trades</b>
        {!d.closed.length ? <small className="muted">None yet.</small> : (
          <div className="ait-table">
            {d.closed.map((p) => (
              <div key={p.id} className="ait-tr">
                <span><b>{p.symbol}</b> <small className="muted">{chainName(p.chain)} · {p.mode === "paper" ? "practice" : "live"} · {p.closed_at ? ago(p.closed_at) : ""}</small><br /><small className="muted">{p.close_reason}</small></span>
                <span className="n">{fmtAmount(Number(p.spent))} → {fmtAmount(Number(p.received) || 0)} BNB</span>
                <span className={"n " + ((Number(p.pnl) || 0) >= 0 ? "up" : "down")}><b>{sign(Number(p.pnl_pct) || 0)}%</b></span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack">
        <b>What it did</b>
        <div className="ait-log">{d.log.map((l) => <div key={l.id} className={"ait-l " + l.kind}><small>{ago(l.at)}</small><span>{l.text}</span></div>)}</div>
      </section>
      {msg && <div className="notice aitx-toast" role="status">{msg}<button type="button" aria-label="Close message" onClick={() => setMsg("")}>✕</button></div>}
      <p className="fin-note">This is an experiment. Automated trading can lose money fast, especially with new coins. Test in practice mode first and only fund the live wallet with what you can afford to lose.</p>
    </div>
  );
}

/** One open coin: live profit, why it was bought, and its own stop-loss / take profit / trailing stop. */
function Open({ p, busy, onAct }: { p: P; busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const [sl, setSl] = useState(String(p.stop_loss));
  const [tp, setTp] = useState(String(p.take_profit));
  const [tr, setTr] = useState(String(p.trail));
  const now = Number(p.last_usd) || Number(p.entry_usd);
  const ch = (now / Number(p.entry_usd) - 1) * 100;
  return (
    <div className="ait-pos">
      <div className="ait-pos-h">
        {p.logo ? <img src={p.logo} alt="" width={34} height={34} /> : <span className="ait-ph">{(p.symbol || "?").slice(0, 2)}</span>}
        <div className="grow"><b>{p.symbol}</b> <small className="muted">{chainName(p.chain)} · {p.mode === "paper" ? "practice" : "live"} · bought {ago(p.opened_at)}</small></div>
        <b className={ch >= 0 ? "up" : "down"}>{sign(ch)}%</b>
      </div>
      <TradeFacts p={p} />
      {p.why && <small className="ait-why">{p.why}</small>}
      <TradeActions p={p} busy={busy} onAct={onAct} />
      <div className="ait-pos-f">
        <label>Stop-loss <span className="ait-in"><input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} /><em>%</em></span></label>
        <label>Take profit <span className="ait-in"><input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} /><em>%</em></span></label>
        <label>Trailing <span className="ait-in"><input inputMode="decimal" value={tr} onChange={(e) => setTr(e.target.value)} /><em>%</em></span></label>
        <button type="button" className="btn small" disabled={busy} onClick={() => onAct("edit", "edit", { id: p.id, stop_loss: Number(sl), take_profit: Number(tp), trail: Number(tr) }, `${p.symbol}: saved.`)}>Save</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => { if (confirm(`Sell all ${p.symbol} now?`)) onAct("close", "close", { id: p.id }, `${p.symbol} sold.`); }}>Sell now</button>
        <a className="btn small" href={`/analytics/${p.chain}/${p.token}`} target="_blank" rel="noopener noreferrer">Scan ↗</a>
      </div>
    </div>
  );
}

/** Every coin the AI bought: what it paid, what it's worth now, and the % up or down. */
function Bought({ open, closed, busy, onAct, freeUsd, onSell, onForget }: { open: P[]; closed: P[]; busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void>; freeUsd: number | null; onSell: (p: P) => void; onForget: (p: P) => void }) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const rows = tab === "open"
    ? open.map((p) => { const now = Number(p.last_usd) || Number(p.entry_usd); const pct = (now / Number(p.entry_usd) - 1) * 100; return { p, pct, worth: Number(p.spent) * (1 + pct / 100), price: now as number | null }; })
    : closed.map((p) => ({ p, pct: Number(p.pnl_pct) || 0, worth: Number(p.received) || 0, price: (Number(p.last_usd) || null) as number | null }));
  const spent = rows.reduce((a, r) => a + Number(r.p.spent), 0), worth = rows.reduce((a, r) => a + r.worth, 0);
  const total = spent ? (worth / spent - 1) * 100 : 0;
  const best = Math.max(10, ...rows.map((r) => Math.abs(r.pct)));
  return (
    <section className="card stack ait-bought">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <b>Coins the AI bought</b>
        <div className="ait-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? "on" : ""} onClick={() => setTab("open")}>Holding ({open.length})</button>
          <button type="button" role="tab" aria-selected={tab === "closed"} className={tab === "closed" ? "on" : ""} onClick={() => setTab("closed")}>Sold ({closed.length})</button>
        </div>
      </div>
      {!rows.length ? <small className="muted">{tab === "open" ? "Not holding anything right now." : "Nothing sold yet."}</small> : (
        <>
          <div className="ait-sum">
            <span>Paid <b>{fmtAmount(spent)} BNB</b></span>
            <span>{tab === "open" ? "Worth now" : "Got back"} <b>{fmtAmount(worth)} BNB</b></span>
            <span className={total >= 0 ? "up" : "down"}><b>{sign(total)}%</b> overall</span>
          </div>
          <div className="ait-bl">
            {rows.map(({ p, pct, worth: w, price }) => (
              <div key={p.id} className="ait-b">
                {p.logo ? <img src={p.logo} alt="" width={36} height={36} /> : <span className="ait-ph">{(p.symbol || "?").slice(0, 2)}</span>}
                <div className="ait-b-name">
                  <b>{p.symbol} {p.strategy && <span className={"ait-tag " + p.strategy}>{({ hype: "🔥 Hype", dip: "📉 Dip", signal: "⚡ Signal", caller: "📣 Caller", copy: "📡 Copy", rebuy: "🔁 Re-buy" } as Record<string, string>)[p.strategy] || p.strategy}</span>}</b>
                  <small className="muted">{chainName(p.chain)} · {tab === "open" ? `bought ${ago(p.opened_at)}` : `sold ${p.closed_at ? ago(p.closed_at) : ""}`}</small>
                  <small className="muted">{fmtAmount(Number(p.spent))} → {fmtAmount(w)} BNB · {fmtUsd(Number(p.entry_usd))} → {price ? fmtUsd(price) : "–"}</small>
                  <TradeFacts p={p} closed={tab === "closed"} />
                  {tab === "open" && p.status === "open" && <TradeActions p={p} busy={busy} onAct={onAct} freeUsd={freeUsd} />}
                </div>
                <div className={"ait-b-pct " + (pct >= 0 ? "up" : "down")}>
                  <b>{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%</b>
                  <i style={{ width: `${Math.max(4, (Math.abs(pct) / best) * 100)}%` }} aria-hidden="true" />
                  {tab === "open" && (p.status === "closing" ? <span className="ait-sell">Selling…</span> : (
                    <details className="ait-cancel">
                      <summary>✕ Cancel trade</summary>
                      <div>
                        <button type="button" className="ait-sell" disabled={busy} onClick={() => onSell(p)}>💸 Sell now</button>
                        <button type="button" className="ait-keep" disabled={busy} onClick={() => onForget(p)}>✋ Keep coins, stop bot</button>
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {tab === "open" && <small className="muted">Prices update every 5 minutes.</small>}
        </>
      )}
    </section>
  );
}

/** Owner: see the trading wallet's private key (to import it into your own wallet app), or use your own wallet. */
function KeyTools({ busy, onAct, importOnly }: { busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void>; importOnly?: boolean }) {
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [imp, setImp] = useState(false);
  const [paste, setPaste] = useState("");
  async function reveal() {
    if (!confirm("Show the private key?\n\nAnyone who sees it can take every coin in this wallet. Make sure nobody is looking at your screen, never send it to anyone (AUTISTIK will never ask for it), and keep it somewhere safe.")) return;
    setErr("");
    try { const r = await post("key-reveal", {}); setKey(r.key); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="ait-keys">
      {!importOnly && (key ? (
        <div className="ait-key">
          <small><b>Private key</b>: import it in MetaMask, Trust Wallet or any EVM wallet (Import account › Private key). Works on BNB Chain, Ethereum and Robinhood Chain.</small>
          <code>{key}</code>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(key); }}>Copy</button>
            <button type="button" className="btn small" onClick={() => setKey(null)}>Hide</button>
          </div>
          <small className="muted">If you trade from the same wallet yourself, the AI and you share the BNB: keep enough in it for the AI&apos;s trades.</small>
        </div>
      ) : <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={reveal}>🔑 Show private key</button>)}
      {!imp ? <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setImp(true)}>Use my own wallet instead</button> : (
        <div className="ait-key">
          <small>Paste the private key of a wallet you own (export it from your wallet app). Use a separate wallet just for the AI, never your main one. {importOnly ? "" : "The current trading wallet must be empty first (Withdraw)."}</small>
          <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="0x…" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Private key" />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small primary" disabled={busy || paste.trim().length < 64} onClick={() => onAct("import", "key-import", { key: paste.trim() }).then(() => { setPaste(""); setImp(false); })}>Use this wallet</button>
            <button type="button" className="btn small" onClick={() => { setPaste(""); setImp(false); }}>Cancel</button>
          </div>
        </div>
      )}
      {err && <small role="status">{err}</small>}
    </div>
  );
}

/** How it picks coins: small-cap HYPE and DIP setups, the market-cap window, the target and the stop. */
function Strategy({ s, busy, onAct }: { s: S; busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: keyof S) => f[k as string] ?? String(s[k]);
  const field = (k: keyof S, label: string, unit: string, hint: string) => (
    <label key={k as string}><span>{label}</span><span className="ait-in">{unit === "$" && <em>$</em>}<input inputMode="decimal" value={v(k)} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{unit !== "$" && <em>{unit}</em>}</span><small>{hint}</small></label>
  );
  return (
    <section className="card stack">
      <b>Strategy</b>
      <small className="muted">The AI looks for small coins and reads each one&apos;s 5-minute chart (RSI, moving averages, higher lows, volume) plus who is buying and selling right now, and the buzz on X and Telegram, before it buys. It skips a round when nothing is clean. Coins this small can make big moves but often rug: keep each trade small.</small>
      <div className="ait-chains">
        <button type="button" className={"ait-chain" + (s.hype_on ? " on" : "")} aria-pressed={s.hype_on} disabled={busy} onClick={() => onAct("hype", "settings", { hype_on: !s.hype_on }, `Hype setup ${s.hype_on ? "off" : "on"}.`)}>
          <b>{s.hype_on ? "✓ " : ""}🔥 Hype</b><small>Buys early when people are piling in: more buyers every few minutes, volume speeding up, not yet a vertical candle</small>
        </button>
        <button type="button" className={"ait-chain" + (s.dip_on ? " on" : "")} aria-pressed={s.dip_on} disabled={busy} onClick={() => onAct("dip", "settings", { dip_on: !s.dip_on }, `Dip setup ${s.dip_on ? "off" : "on"}.`)}>
          <b>{s.dip_on ? "✓ " : ""}📉 Buy the dip</b><small>After a coin ran and dropped 30–75% in fear, buys when buyers come back (higher low, RSI turning up)</small>
        </button>
      </div>
      {!s.hype_on && !s.dip_on && <small className="muted">Both off: it uses the older trending-coins mode.</small>}
      <div className="ait-form">
        {field("mcap_min", "Smallest market cap", "$", "Skips coins worth less")}
        {field("mcap_max", "Biggest market cap", "$", "Skips coins worth more")}
        {field("micro_min_liq", "Smallest pool", "$", "Skips coins with less liquidity than this")}
        {field("target_profit", "Target profit", "%", "Sells when up this much (the AI may set its own between +50% and +300%)")}
        {field("strat_stop", "Stop-loss", "%", "Cuts the loss here (the AI may tighten or widen it, 15–45%)")}
      </div>
      <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !Object.keys(f).length} onClick={() => onAct("strat", "settings", Object.fromEntries(Object.entries(f).map(([k, x]) => [k, Number(x)])), "Strategy saved.").then(() => setF({}))}>Save strategy</button>
    </section>
  );
}

const SRC: Record<string, string> = { x: "𝕏", telegram: "✈️ TG", "dex-profile": "DexScreener profile", "dex-boost": "DexScreener boost", "dex-cto": "Community takeover" };

/** Fresh signals: X callers, Telegram groups and DexScreener, acted on within a minute. */
function Signals({ d, busy, onAct }: { d: Data; busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const s = d.settings;
  const [add, setAdd] = useState("");
  const [cap, setCap] = useState("");
  const callers = s.callers || [];
  const save = (list: string[], done: string) => onAct("callers", "settings", { callers: list }, done);
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b>⚡ Fresh signals</b>
        <label className="ait-check" style={{ margin: 0 }}><input type="checkbox" checked={s.signals_on} disabled={busy} onChange={(e) => onAct("sig", "settings", { signals_on: e.target.checked })} /> <span>On</span></label>
      </div>
      <small className="muted">Checked every minute. It buys the moment a fresh post lands, if the coin is still small (in your market-cap window, not already up 100% in 1h or 300% in 24h, buyers ahead of sellers). Posts from the callers below may be bigger and already moving (up to the caller limit), as long as the post is under 5 minutes old.</small>
      <div className="ait-src">
        <span className="on">✓ DexScreener: new profiles, boosts, takeovers</span>
        <span className={d.sources.x ? "on" : ""}>{d.sources.x ? "✓ X connected" : "✗ X not connected"}</span>
        <span className={d.sources.telegram ? "on" : ""}>{d.sources.telegram ? "✓ Telegram bot ready" : "✗ Telegram not connected"}</span>
      </div>
      {!d.sources.x && <small className="muted">To read X: get a key from <a href="https://twitterapi.io" target="_blank" rel="noopener noreferrer">twitterapi.io</a> (pay per use, cheap) and add it in Vercel as <code>TWITTERAPI_IO_KEY</code>, or an official X API key as <code>X_BEARER_TOKEN</code>. Then redeploy.</small>}
      {!d.sources.telegram ? <small className="muted">To read Telegram: make a bot with @BotFather, add its token in Vercel as <code>TELEGRAM_BOT_TOKEN</code>, redeploy, tap Connect, then add the bot to your channels and groups.</small>
        : d.owner && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => onAct("tg", "tg-hook", {})}>Connect Telegram bot</button>}
      <div>
        <small className="muted">Callers on X</small>
        <div className="ait-callers">
          {callers.map((h) => <span key={h}>@{h}<button type="button" aria-label={`Remove @${h}`} disabled={busy} onClick={() => save(callers.filter((x) => x !== h), `@${h} removed.`)}>✕</button></span>)}
          <input className="input" placeholder="@caller" value={add} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && add.trim()) { save([...callers, add.trim()], `${add.trim()} added.`); setAdd(""); } }} aria-label="Add a caller" />
        </div>
      </div>
      <label className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>Caller coins up to</span>
        <span className="ait-in" style={{ width: 150 }}><em>$</em><input inputMode="decimal" value={cap || String(s.caller_mcap_max)} onChange={(e) => setCap(e.target.value)} onBlur={() => { if (cap && Number(cap) !== s.caller_mcap_max) onAct("cap", "settings", { caller_mcap_max: Number(cap) }, "Saved."); }} /></span>
        <small className="muted">market cap</small>
      </label>
      <div className="ait-sigs">
        {!d.signals.length ? <small className="muted">No signals yet. They show here as they land.</small> : d.signals.map((g) => (
          <div key={g.id} className={"ait-sig" + (g.result?.startsWith("bought") ? " won" : "")}>
            <span className="ait-sig-src">{SRC[g.source] || g.source}</span>
            <div className="grow">
              <b>{g.symbol || `${g.token.slice(0, 6)}…`}</b> <small className="muted">{chainName(g.chain)}{g.mcap ? ` · $${Math.round(g.mcap).toLocaleString("en-US")}` : ""}{g.who && g.source !== "dex-profile" && g.source !== "dex-boost" && g.source !== "dex-cto" ? ` · ${g.source === "x" ? "@" : ""}${g.who}` : ""} · {ago(g.at)}</small>
              <small className="ait-sig-r">{g.result}</small>
            </div>
            {g.url.startsWith("http") && <a href={g.url} target="_blank" rel="noopener noreferrer" className="btn small">Open</a>}
          </div>
        ))}
      </div>
    </section>
  );
}
