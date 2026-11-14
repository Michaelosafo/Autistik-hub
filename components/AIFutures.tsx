"use client";
/**
 * Admin: AI Futures. A futures trader separate from the copy-trading bot: its own wallet, settings and trades.
 * Practice or Live (Hyperliquid), never above 3x, every trade with a stop-loss well before liquidation.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import TraderTabs from "@/components/TraderTabs";

type S = {
  enabled: boolean; mode: "paper" | "live"; paper_usd: number; paper_start: number; venues: string[]; coins: string[]; max_lev: number; max_loss_pct: number; risk_pct: number;
  max_positions: number; daily_loss_pct: number; max_hold_hours: number; use_ta: boolean; use_news: boolean; use_x: boolean; x_handles: string[];
  last_run: string | null; last_note: string | null; no_liq?: boolean;
};
type Trade = { id: number; coin: string; side: string; lev: number; venue: string; entry: number; exit: number; pnl: number; fees: number; impactPct: number | null; r: number | null; holdMin: number; opened: string; closed: string; driver: string; at: string };
type Group = { key: string; trades: number; wins: number; pnl: number };
type Perf = {
  start: number; now: number; returnPct: number | null; today: number; trades: number; winRate: number | null; avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; maxDrawdownPct: number; fees: number; best: Trade | null; worst: Trade | null; avgHoldMin: number | null;
  byCoin: Group[]; byExit: Group[]; byDriver: Group[]; curve: { t: string; v: number }[]; journal: Trade[];
};
type P = {
  id: number; mode: string; venue: string; coin: string; side: "long" | "short"; lev: number; margin_usd: number; notional_usd: number; entry: number; stop: number;
  target: number; liq: number | null; price?: number; upnl?: number | null; exit: number | null; pnl_usd: number | null; reason: string | null; why: string | null;
  opened_at: string; closed_at: string | null;
};
type D = {
  settings: S; equity: { total: number; free: number }; liveVenues: string[];
  wallet: { address: string; hlValue: number | null; hlFree: number | null; arbUsdc: number | null; arbEth: number | null } | null;
  open: P[]; closed: P[]; log: { id: number; at: string; kind: string; text: string }[];
  news: { key: string; at: string; source: string; title: string; url: string; coin: string; direction: number; strength: number }[];
  stats: { trades: number; wins: number; winRate: number | null; pnl: number };
  perf?: Perf | null;
};
const VN: Record<string, string> = { hyperliquid: "Hyperliquid", aster: "Aster" };
const usd = (x: number | null | undefined, d = 2) => (x == null || !isFinite(x) ? "–" : `${x < 0 ? "-" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const px = (x: number | null | undefined) => (x == null || !isFinite(x) ? "–" : `$${x >= 100 ? x.toLocaleString("en-US", { maximumFractionDigits: 2 }) : x.toPrecision(5)}`);
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

const hold = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`);
const pct = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`);

/** The account's value over time: one point per closed trade, then now. */
function Curve({ pts, start }: { pts: { t: string; v: number }[]; start: number }) {
  if (pts.length < 2) return <small className="muted">The chart starts after the first closed trade.</small>;
  const W = 600, H = 170, P = 6;
  const vs = pts.map((p) => p.v), lo = Math.min(...vs, start), hi = Math.max(...vs, start), span = hi - lo || 1;
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P), y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1].v >= start;
  return (
    <figure className="fut-curve" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Account value from $${start.toFixed(2)} to $${pts[pts.length - 1].v.toFixed(2)} over ${pts.length - 2} trades`} preserveAspectRatio="none">
        <line x1={P} x2={W - P} y1={y(start)} y2={y(start)} className="fut-base" />
        <path d={`${line} L${x(pts.length - 1).toFixed(1)},${H - P} L${P},${H - P} Z`} className={"fut-area" + (up ? " up" : " down")} />
        <path d={line} className={"fut-line" + (up ? " up" : " down")} />
      </svg>
      <figcaption className="row" style={{ justifyContent: "space-between" }}><small className="muted">Start {usd(start)}</small><small className="muted">Now {usd(pts[pts.length - 1].v)}</small></figcaption>
    </figure>
  );
}

/** How the trader is doing: growth, risk, and every trade's reason and effect. */
function Performance({ p, live }: { p: Perf; live: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const stat = (label: string, val: string, cls = "", hint = "") => <div><small>{label}</small><b className={cls}>{val}</b>{hint && <em>{hint}</em>}</div>;
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b>📈 Performance{live ? " (live)" : " (practice)"}</b>
        <small className="muted">{p.trades} closed trade{p.trades === 1 ? "" : "s"}</small>
      </div>
      <Curve pts={p.curve} start={p.start} />
      <div className="ait-stats fut-perf">
        {stat("Return", pct(p.returnPct), (p.returnPct ?? 0) >= 0 ? "up" : "down", `${usd(p.start)} → ${usd(p.now)}`)}
        {stat("Today (closed)", usd(p.today), p.today >= 0 ? "up" : "down")}
        {stat("Win rate", p.winRate == null ? "–" : `${Math.round(p.winRate)}%`, "", `avg win ${usd(p.avgWin)} · avg loss ${usd(p.avgLoss)}`)}
        {stat("Profit factor", p.profitFactor == null ? "–" : p.profitFactor.toFixed(2), (p.profitFactor ?? 0) >= 1 ? "up" : "down", "won ÷ lost (above 1 = making money)")}
        {stat("Biggest drop", `-${p.maxDrawdownPct.toFixed(1)}%`, p.maxDrawdownPct > 10 ? "down" : "", "from its highest point")}
        {stat("Fees paid", usd(p.fees), "", p.avgHoldMin == null ? "" : `avg hold ${hold(p.avgHoldMin)}`)}
      </div>
      <div className="fut-groups">
        {([["By coin", p.byCoin], ["Why trades closed", p.byExit], ["What started them", p.byDriver]] as [string, Group[]][]).map(([title, g]) => (
          <div key={title} className="stack" style={{ gap: 4 }}>
            <small><b>{title}</b></small>
            {!g.length ? <small className="muted">–</small> : g.map((x) => (
              <small key={x.key} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span>{x.key === "news" ? "📰 News" : x.key === "chart" ? "📊 Chart" : x.key} <span className="muted">· {x.trades} · {Math.round((x.wins / x.trades) * 100)}% won</span></span>
                <b className={x.pnl >= 0 ? "up" : "down"}>{usd(x.pnl)}</b>
              </small>
            ))}
          </div>
        ))}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <small><b>Every trade: why, and its effect</b> <span className="muted">tap one for the full reason</span></small>
        {!p.journal.length ? <small className="muted">No closed trades yet.</small> : p.journal.map((t) => (
          <div key={t.id} className="fut-trade">
            <button type="button" className="fut-trade-h" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <b className={t.pnl >= 0 ? "up" : "down"}>{usd(t.pnl)}</b>
              <span className="grow">{t.side === "long" ? "📈" : "📉"} {t.side} {t.coin} {t.lev}x <span className="muted">· {t.closed.replace(/\s*\(.*$/, "")} · {ago(t.at)}</span></span>
              <small className={(t.impactPct ?? 0) >= 0 ? "up" : "down"}>{pct(t.impactPct, 2)} of account</small>
            </button>
            {open === t.id && (
              <div className="fut-trade-b">
                <small><b>Why it opened:</b> {t.opened || "–"}</small>
                <small><b>Why it closed:</b> {t.closed || "–"}</small>
                <small><b>Effect:</b> {usd(t.pnl)} ({pct(t.impactPct, 2)} of the account){t.r != null ? ` · ${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R (R = what its stop-loss would have cost)` : ""} · fees {usd(t.fees)} · held {hold(t.holdMin)}</small>
                <small className="muted">{px(t.entry)} → {px(t.exit)} · {VN[t.venue] || t.venue} · started by {t.driver === "news" ? "news" : "the chart"}</small>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Send USDT / USDC from the AI trader's Solana wallet straight into the futures account on Hyperliquid. */
function FundFromSolana({ busy, act }: { busy: string; act: (n: string, a: string, b: unknown, d?: string) => Promise<void> }) {
  const [amt, setAmt] = useState("100");
  const [sym, setSym] = useState<"USDT" | "USDC">("USDT");
  const [q, setQ] = useState("");
  return (
    <div className="stack fut-fund" style={{ gap: 8 }}>
      <small><b>Fund from Solana</b> <span className="muted">USDT / USDC in the AI trader&apos;s Solana wallet goes straight to Hyperliquid, ready to trade (Relay; about a minute, no Arbitrum or ETH needed).</span></small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="ait-seg" role="group" aria-label="Stablecoin">{(["USDT", "USDC"] as const).map((x) => <button key={x} type="button" className={sym === x ? "on" : ""} onClick={() => { setSym(x); setQ(""); }}>{x}</button>)}</span>
        <span className="ait-in" style={{ maxWidth: 140 }}><em>$</em><input inputMode="decimal" value={amt} onChange={(e) => { setAmt(e.target.value); setQ(""); }} aria-label="Dollars to send" /></span>
        <button type="button" className="btn small" disabled={!!busy || !(Number(amt) >= 5)} onClick={async () => { try { const r = await call("fund-sol", { usd: Number(amt), symbol: sym, quote: true }); setQ(r.note); } catch (e) { setQ((e as Error).message); } }}>Check fee</button>
        <button type="button" className="btn small primary" disabled={!!busy || !(Number(amt) >= 5)} onClick={() => { if (confirm(`Send $${amt} ${sym} from the Solana trading wallet to the AI Futures account on Hyperliquid?`)) act("fund", "fund-sol", { usd: Number(amt), symbol: sym }); }}>{busy === "fund" ? "Sending…" : `Send $${Number(amt) || 0} ${sym}`}</button>
      </div>
      {q && <small className="muted" role="status">{q}</small>}
    </div>
  );
}

async function call(action: string, body: unknown) {
  const r = await fetch(`/api/ai-futures/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}

export default function AIFutures() {
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const load = async () => {
    const r = await fetch("/api/ai-futures/status", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error || "Couldn't load."); return; }
    setD(j); setErr("");
  };
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []);
  const act = async (name: string, action: string, body: unknown, done?: string) => {
    setBusy(name); setMsg("");
    try { const r = await call(action, body); setMsg(done || r.note || "Done."); await load(); }
    catch (e) { setMsg((e as Error).message); }
    setBusy("");
  };

  if (err) return <div className="card stack"><b>AI Futures</b><p className="muted">{err}</p>{/AI Trader page/.test(err) && <Link className="btn" href="/admin/ai-trader">Open AI Trader</Link>}</div>;
  if (!d) return <div className="card"><small className="muted">Loading AI Futures…</small></div>;
  const s = d.settings, live = s.mode === "live";
  const set = (b: Partial<S>, done?: string) => act("set", "settings", b, done);
  const list = (label: string, cur: string[], key: "coins" | "x_handles", hint: string) => (
    <div className="stack" style={{ gap: 4 }}>
      <small><b>{label}</b> <span className="muted">{hint}</span></small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {cur.map((c) => <span key={c} className="chip">{key === "x_handles" ? "@" : ""}{c} <button type="button" className="aic-addr" aria-label={`Remove ${c}`} disabled={!!busy} onClick={() => set({ [key]: cur.filter((x) => x !== c) } as any)}>×</button></span>)}
        <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt(key === "coins" ? "Coin to trade (e.g. AVAX, LINK, PEPE):" : "X account to watch (e.g. WatcherGuru):"); if (v?.trim()) set({ [key]: [...cur, v.trim().replace(/^@/, "")] } as any); }}>+ Add</button>
      </div>
    </div>
  );

  return (
    <div className="stack ait">
      <TraderTabs />
      <div className="page-head">
        <Link href="/admin" className="muted">← Admin</Link>
        <h1>📊 AI Futures</h1>
        <p className="muted">Its own trader, separate from the copy bot: its own wallet, money and trades. Every minute it reads fresh crypto news (CoinDesk, Cointelegraph, Decrypt, The Block) and the X accounts below, lets the AI judge which coin each headline moves, checks the charts (1-hour trend, 5-minute momentum, breakouts on high volume, RSI, volatility), and opens a long or short on Hyperliquid or Aster when news and chart agree. Leverage {s.max_lev}x, and every trade auto-sells at -{s.max_loss_pct}%. Every trade has a stop-loss far before liquidation, moves it to break-even once it&apos;s in profit, then trails it.</p>
      </div>

      <section className={"card ait-top" + (s.enabled ? " on" : "")}>
        <div className="ait-state">
          <span className={"ait-dot" + (s.enabled ? " on" : "")} aria-hidden="true" />
          <div><b>{s.enabled ? "Started: looking for trades" : "Stopped: not opening trades"}</b> · {live ? "LIVE (real money, Hyperliquid)" : "Practice (pretend dollars, real prices)"}<br /><small className="muted">{s.last_note || "Hasn't run yet."} {s.last_run ? `· ${ago(s.last_run)}` : ""}</small></div>
        </div>
        <button type="button" className={"ait-go" + (s.enabled ? " stop" : "")} disabled={!!busy} onClick={() => set({ enabled: !s.enabled })}>{s.enabled ? "■ STOP" : "▶ START"}</button>
        <div className="ait-seg" role="radiogroup" aria-label="Mode">
          <button type="button" role="radio" aria-checked={!live} className={!live ? "on" : ""} disabled={!!busy || !live} onClick={() => set({ mode: "paper" })}>Practice</button>
          <button type="button" role="radio" aria-checked={live} className={live ? "on" : ""} disabled={!!busy || live}
            onClick={() => { if (confirm(`Go LIVE? The AI will trade real money from its wallet on Hyperliquid at ${s.max_lev}x leverage, auto-selling any trade at -${s.max_loss_pct}%. You can lose money. Only use money you can afford to lose.`)) set({ mode: "live" }); }}>Live</button>
        </div>
        {s.enabled && <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => act("run", "run", {})}>{busy === "run" ? "Checking…" : "Check now"}</button>}
        {msg && <small className="aic-note" role="status">{msg}</small>}
      </section>

      <section className="ait-stats">
        <div><small>{live ? "Account (Hyperliquid)" : "Practice account"}</small><b>{usd(d.equity.total)}</b><em>{usd(d.equity.free)} free</em></div>
        <div><small>Open</small><b>{d.open.length}</b><em className={(d.open.reduce((a, p) => a + (p.upnl || 0), 0)) >= 0 ? "up" : "down"}>{usd(d.open.reduce((a, p) => a + (p.upnl || 0), 0))} now</em></div>
        <div><small>Closed trades</small><b>{d.stats.trades}</b><em>{d.stats.winRate == null ? "–" : `${d.stats.winRate}% won`}</em></div>
        <div><small>Profit (closed)</small><b className={d.stats.pnl >= 0 ? "up" : "down"}>{usd(d.stats.pnl)}</b>{!live && <em>from {usd(s.paper_start, 0)} start</em>}</div>
      </section>

      {d.perf && <Performance p={d.perf} live={live} />}

      <section className="card stack">
        <b>Open positions</b>
        {!d.open.length ? <small className="muted">None right now.</small> : d.open.map((p) => (
          <div key={p.id} className="aic-row on" style={{ alignItems: "flex-start" }}>
            <span className="grow">
              <b className={p.side === "long" ? "up" : "down"}>{p.side === "long" ? "📈 LONG" : "📉 SHORT"} {p.coin}</b> <small className="muted">· {VN[p.venue] || p.venue} · {p.lev}x · {usd(p.notional_usd, 0)} position ({usd(p.margin_usd, 0)} margin){p.mode === "paper" ? " · practice" : ""}</small><br />
              <small>Entry {px(p.entry)} · now {px(p.price)} · <b className={(p.upnl || 0) >= 0 ? "up" : "down"}>{usd(p.upnl)}</b></small><br />
              <small className="muted">Stop {px(p.stop)} · target {px(p.target)} · liquidation ~{px(p.liq)} · opened {ago(p.opened_at)}</small>
              {p.liq && p.price ? <><br /><small className="up">🛡 The stop is {Math.max(1, Math.round(Math.abs(p.price - p.liq) / Math.max(1e-9, Math.abs(p.price - p.stop))))}× closer than liquidation{p.mode === "live" ? " and rests on Hyperliquid itself" : ""}.</small></> : null}
              {p.why && <><br /><small className="muted">{p.why}</small></>}
            </span>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => { if (confirm(`Close ${p.side} ${p.coin} now at the market price?`)) act(`c${p.id}`, "close", { id: p.id }); }}>{busy === `c${p.id}` ? "Closing…" : "Close"}</button>
          </div>
        ))}
      </section>

      <section className="card stack">
        <b>👛 AI Futures wallet</b>
        {!d.wallet ? (
          <>
            <small className="muted">Its own wallet, separate from the copy bot. Only this futures trader uses it. Practice mode doesn&apos;t need it.</small>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={!!busy} onClick={() => act("w", "wallet", {})}>Create AI Futures wallet</button>
              <button type="button" className="btn ghost" disabled={!!busy} onClick={() => { const k = prompt("Paste the private key of your own wallet (MetaMask / Rabby: Account details → Show private key). Use a wallet just for this, never your main one. It's stored encrypted."); if (k?.trim()) act("imp", "key-import", { key: k.trim() }); }}>Import my own wallet</button>
            </div>
          </>
        ) : (
          <>
            <small>Address: <button type="button" className="aic-addr" onClick={() => { navigator.clipboard?.writeText(d.wallet!.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Copied ✓" : d.wallet.address}</button></small>
            <small>On Hyperliquid: <b>{usd(d.wallet.hlValue)}</b> ({usd(d.wallet.hlFree)} free) · Waiting on Arbitrum: <b>{d.wallet.arbUsdc == null ? "–" : `${d.wallet.arbUsdc.toFixed(2)} USDC`}</b>, {d.wallet.arbEth == null ? "–" : `${d.wallet.arbEth.toFixed(5)} ETH`}</small>
            <FundFromSolana busy={busy} act={act} />
            <details>
              <summary><b>Other ways to fund it</b></summary>
              <ol className="muted" style={{ margin: "6px 0", paddingLeft: 18, fontSize: ".9em" }}>
                <li><b>Easiest:</b> on Hyperliquid (app.hyperliquid.xyz), open your own account → <b>Send</b> → paste the address above → send USDC. It arrives at once, no gas.</li>
                <li><b>Or from any wallet / exchange:</b> send <b>USDC on Arbitrum</b> (at least 5) plus a little <b>ETH on Arbitrum</b> for gas to the address above, then tap <b>Deposit to Hyperliquid</b>.</li>
                <li>Aster runs in practice only for now; live trades go to Hyperliquid.</li>
                <li>Or use your own wallet: <b>Import my own wallet</b> below.</li>
              </ol>
            </details>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {(d.wallet.arbUsdc ?? 0) >= 5 && <button type="button" className="btn small primary" disabled={!!busy} onClick={() => act("dep", "deposit", {})}>Deposit {d.wallet.arbUsdc!.toFixed(2)} USDC to Hyperliquid</button>}
              <button type="button" className="btn small" disabled={!!busy} onClick={() => { const k = prompt("Paste the private key of your own wallet (MetaMask / Rabby: Account details → Show private key). Use a wallet just for this, never your main one. It's stored encrypted."); if (k?.trim()) act("imp", "key-import", { key: k.trim() }); }}>Import my own wallet</button>
              <button type="button" className="btn small ghost" disabled={!!busy} onClick={async () => { if (!confirm("Show the wallet's private key? Anyone who sees it can take the money. Use it to open the wallet in Rabby or MetaMask and withdraw from Hyperliquid.")) return; try { const r = await call("key-reveal", {}); prompt("AI Futures private key (keep it secret):", r.key); } catch (e) { alert((e as Error).message); } }}>Show private key</button>
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <b>⚙️ Rules</b>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {["hyperliquid", "aster"].map((v) => (
            <label key={v} className="ait-check"><input type="checkbox" checked={s.venues.includes(v)} disabled={!!busy} onChange={(e) => set({ venues: e.target.checked ? [...s.venues, v] : s.venues.filter((x) => x !== v) })} /> <span>{VN[v]}{!d.liveVenues.includes(v) ? " (practice only for now)" : ""}</span></label>
          ))}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <label className="ait-check"><input type="checkbox" checked={s.use_ta} disabled={!!busy} onChange={(e) => set({ use_ta: e.target.checked })} /> <span>Charts (technical analysis)</span></label>
          <label className="ait-check"><input type="checkbox" checked={s.use_news} disabled={!!busy} onChange={(e) => set({ use_news: e.target.checked })} /> <span>News sites</span></label>
          <label className="ait-check"><input type="checkbox" checked={s.use_x} disabled={!!busy} onChange={(e) => set({ use_x: e.target.checked })} /> <span>X accounts</span></label>
        </div>
        <label className={"aic-row" + (s.no_liq !== false ? " on" : "")}>
          <input type="checkbox" checked={s.no_liq !== false} disabled={!!busy} onChange={(e) => set({ no_liq: e.target.checked }, e.target.checked ? "Never get liquidated: on (at most 6x, liquidation 15%+ away)." : "Never get liquidated: off. Your leverage setting is used as is.")} />
          <span className="grow"><b>🛡 Never get liquidated</b><small className="muted">Caps leverage at 6x so liquidation is at least 15% away, and every trade&apos;s stop-loss sits at least 8× closer than that, resting on Hyperliquid itself. Each trade uses only its own margin (isolated), so one trade can never take the rest of the account.</small></span>
        </label>
        {[
          ["max_lev", "Leverage", "x", `1 to 50 (each coin's own maximum applies). At ${s.max_lev}x, liquidation is ~${(100 / s.max_lev).toFixed(1)}% away.`],
          ["max_loss_pct", "Auto-sell every trade at", "% loss", `of its margin (the P&L % Hyperliquid shows). At ${s.max_lev}x that's a ${(s.max_loss_pct / s.max_lev).toFixed(2)}% price move.`],
          ["risk_pct", "Risk per trade", "% of the account", "What one stop-loss costs. 1% means 10 losses in a row lose about 10%."],
          ["max_positions", "Positions at once", "", ""],
          ["daily_loss_pct", "Daily loss limit", "%", "Down this much today: no new trades until tomorrow (UTC)."],
          ["max_hold_hours", "Max hold", "hours", ""],
        ].map(([k, label, unit, hint]) => (
          <div key={k} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <small><b>{label}:</b> {String((s as any)[k])}{unit ? ` ${unit}` : ""}</small>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt(`${label}${hint ? ` (${hint})` : ""}:`, String((s as any)[k])); if (v != null && v.trim() !== "" && isFinite(Number(v))) set({ [k]: Number(v) } as any); }}>Change</button>
            {hint && <small className="muted">{hint}</small>}
          </div>
        ))}
        {list("Coins", s.coins, "coins", "it trades these (Hyperliquid names)")}
        {list("X accounts", s.x_handles, "x_handles", "fast news accounts it reads every minute (uses your X login from the AI trader page)")}
        {!live && <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => { const v = prompt("Reset the practice account to how many dollars? (closes all practice positions)", "1000"); if (v && Number(v) >= 100) act("reset", "reset", { usd: Number(v) }); }}>Reset practice account</button>}
      </section>

      <section className="card stack">
        <b>📰 News the AI acted on</b>
        {!d.news.length ? <small className="muted">Nothing market-moving yet.</small> : d.news.map((x) => (
          <small key={x.key}><b className={x.direction > 0 ? "up" : "down"}>{x.direction > 0 ? "▲" : "▼"} {x.coin}</b> {Math.round(x.strength * 100)}% · <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title.slice(0, 140)}</a> <span className="muted">· {x.source} · {ago(x.at)}</span></small>
        ))}
      </section>

      <section className="card stack">
        <b>Closed trades</b>
        {!d.closed.length ? <small className="muted">None yet.</small> : d.closed.slice(0, 30).map((p) => (
          <small key={p.id}><b className={(p.pnl_usd || 0) >= 0 ? "up" : "down"}>{usd(p.pnl_usd)}</b> · {p.side} {p.coin} {p.lev}x on {VN[p.venue] || p.venue} · {px(p.entry)} → {px(p.exit)} · {p.reason}{p.mode === "paper" ? " · practice" : ""} · <span className="muted">{p.closed_at ? ago(p.closed_at) : ""}</span></small>
        ))}
      </section>

      <section className="card stack">
        <b>What it did</b>
        {d.log.map((l) => <small key={l.id}><span className="muted">{ago(l.at)} ·</span> {l.text}</small>)}
      </section>

      <small className="muted">Futures with leverage can lose money fast. Nothing here is guaranteed: news can be wrong or already priced in, and big trading firms react in milliseconds. This trader checks every minute, uses {s.max_lev}x leverage, and auto-sells any trade at -{s.max_loss_pct}%.</small>
    </div>
  );
}
