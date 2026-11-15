"use client";
/**
 * AI trader: every coin bought in the last 14 days, first thing on the page. What it cost, what came back, where the
 * money came from (the Solana wallet directly, or moved to BNB Chain / Ethereum with Relay), and links to each buy
 * and sell. Plus the USDT / USDC left on other chains, with "Send back to Solana".
 */
import { useEffect, useState } from "react";

type Row = {
  id: string; opened_at: string; closed_at: string | null; mode: string; status: string; chain: string; token: string; symbol: string;
  native: string | null; spent_native: number | null; received_native: number | null; spent: number; received: number | null; pnl: number | null;
  pnl_pct: number | null; why: string | null; close_reason: string | null; source_group: string | null; source_who: string | null; pot: string | null;
  buy_tx: string | null; sell_tx: string | null; entry_usd: number | null; last_usd: number | null;
};
type Data = { rows: Row[]; away: { chain: string; symbol: string; balance: number }[]; returnHome: boolean; evm: string | null; sol: string | null };

const CH: Record<string, string> = { solana: "◎ Solana", bsc: "🟡 BNB Chain", ethereum: "⟠ Ethereum", robinhood: "🪶 Robinhood", elysium: "Elysium" };
const SCAN: Record<string, string> = { solana: "https://solscan.io/tx/", bsc: "https://bscscan.com/tx/", ethereum: "https://etherscan.io/tx/" };
const ADDR: Record<string, string> = { solana: "https://solscan.io/account/", bsc: "https://bscscan.com/address/", ethereum: "https://etherscan.io/address/" };
const usd = (v: number) => `$${v.toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Dollars in and out: from the stablecoin amounts when bought with USDT / USDC, else estimated from the price move. */
function money(r: Row) {
  const stable = /^USD/.test(String(r.native || ""));
  const inn = stable && r.spent_native ? Number(r.spent_native) : null;
  if (inn == null) return { inn: null as number | null, out: null as number | null, pct: r.pnl_pct != null ? Number(r.pnl_pct) : null };
  const out = r.status === "closed" ? (r.received_native != null ? Number(r.received_native) : null)
    : r.entry_usd && r.last_usd ? inn * (Number(r.last_usd) / Number(r.entry_usd)) : null;
  return { inn, out, pct: out != null ? (out / inn - 1) * 100 : null };
}

export default function CoinsTraded({ busy, onAct }: { busy: boolean; onAct: (n: string, a: string, b: unknown, done?: string) => Promise<void> }) {
  const [d, setD] = useState<Data | null>(null);
  const [more, setMore] = useState<0 | 1 | 2>(0); // 0 = last 3, 1 = everything today, 2 = last 14 days
  const [pick, setPick] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const load = () => fetch("/api/ai-trader/traded", { cache: "no-store" }).then((r) => r.json()).then((j) => j.ok && setD(j)).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  if (!d) return <section className="card"><small className="muted">Loading coins traded…</small></section>;
  const rows = d.rows.filter((r) => (live ? r.mode === "live" : r.mode !== "live"));
  const day = new Date().toDateString();
  const today = rows.filter((r) => new Date(r.opened_at).toDateString() === day || (r.closed_at && new Date(r.closed_at).toDateString() === day));
  const list = more === 0 ? rows.slice(0, 3) : more === 1 ? (today.length > 3 ? today : rows.slice(0, 3)) : rows;
  let tIn = 0, tOut = 0;
  for (const r of today) { const m = money(r); if (m.inn != null && m.out != null) { tIn += m.inn; tOut += m.out; } }
  const act = async (n: string, a: string, b: unknown, msg?: string) => { await onAct(n, a, b, msg); load(); };
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="card stack ct mini">
      <div className="ct-head">
        <b>🧾 Coins traded</b>
        <small className="muted">Today: <b className={tOut - tIn >= 0 ? "up" : "down"}>{tOut - tIn >= 0 ? "+" : "-"}{usd(Math.abs(tOut - tIn))}</b> · {today.length} coin{today.length === 1 ? "" : "s"}</small>
        <span className="ct-tabs">
          <button type="button" className={live ? "on" : ""} onClick={() => { setLive(true); setMore(0); }}>Live</button>
          <button type="button" className={!live ? "on" : ""} onClick={() => { setLive(false); setMore(0); }}>Practice</button>
        </span>
      </div>
      {!rows.length ? <small className="muted">No {live ? "live" : "practice"} trades in the last 14 days.</small> : list.map((r) => {
        const m = money(r), open = r.status !== "closed", on = pick === r.id;
        const res = m.inn != null && m.out != null ? m.out - m.inn : null;
        const bridged = /bridged from Solana/.test(r.why || "");
        const paidFrom = r.chain === "solana" ? `Solana wallet (${r.native || "SOL"})` : bridged ? `Solana wallet → ${CH[r.chain] || r.chain} with Relay` : `${CH[r.chain] || r.chain} wallet (${r.native || "BNB"})`;
        const from = r.pot === "scout" ? `🔎 Scout · ${r.source_group || ""}` : r.source_group ? `📡 ${r.source_group}${r.source_who ? ` · ${r.source_who}` : ""}` : "🤖 AI pick";
        return (
          <div key={r.id} className={"ct-line" + (on ? " on" : "")}>
            <button type="button" className="ct-tap" onClick={() => setPick(on ? null : r.id)} aria-expanded={on}>
              <span className={"ct-dot" + (open ? " open" : (m.pct ?? 0) >= 0 ? " win" : " loss")} aria-hidden="true" />
              <span className="ct-name">{r.symbol} <small className="muted">{(CH[r.chain] || r.chain).split(" ")[0]}</small></span>
              <span className="muted ct-time">{open ? "open" : time(r.closed_at || r.opened_at)}</span>
              {res != null ? <b className={res >= 0 ? "up" : "down"}>{res >= 0 ? "+" : "-"}{usd(Math.abs(res))}{m.pct != null ? <small> {m.pct >= 0 ? "+" : ""}{m.pct.toFixed(0)}%</small> : null}</b>
                : <b className={(m.pct ?? 0) >= 0 ? "up" : "down"}>{m.pct != null ? `${m.pct >= 0 ? "+" : ""}${m.pct.toFixed(0)}%` : "…"}</b>}
            </button>
            {on && (
              <div className="ct-more">
                <small>{m.inn != null ? `In ${usd(m.inn)}` : `In ${Number(r.spent).toFixed(4)} BNB`}{m.out != null ? ` → ${open ? "now " : "out "}${usd(m.out)}` : ""}</small>
                <small>💳 Paid from: <b>{paidFrom}</b></small>
                <small>{from}</small>
                <small>Bought {when(r.opened_at)}{r.closed_at ? ` · sold ${when(r.closed_at)}` : ""}</small>
                <small>{open ? "🟢 Still open" : `Why it sold: ${r.close_reason || "–"}`}</small>
                <span className="ct-links">
                  {r.buy_tx && SCAN[r.chain] && <a href={SCAN[r.chain] + r.buy_tx} target="_blank" rel="noreferrer">See the buy</a>}
                  {r.sell_tx && SCAN[r.chain] && <a href={SCAN[r.chain] + r.sell_tx} target="_blank" rel="noreferrer">See the sell</a>}
                </span>
              </div>
            )}
          </div>
        );
      })}
      {rows.length > 3 && (
        <button type="button" className="ct-morebtn" onClick={() => setMore(more === 0 ? (today.length > 3 ? 1 : 2) : more === 1 ? 2 : 0)}>
          {more === 0 ? (today.length > 3 ? `More: all ${today.length} today` : `More (${rows.length - 3})`) : more === 1 ? `Older (${rows.length - today.length})` : "Show less"}
        </button>
      )}
      {(more > 0 || d.away.length > 0) && <div className="ct-away stack" style={{ gap: 6 }}>
        <b>🏠 Money on other chains</b>
        {!d.away.length ? <small className="muted">None: everything is back in the Solana wallet (or still in open trades).</small> : (
          <>
            {d.away.map((a) => <small key={a.chain + a.symbol}>{CH[a.chain] || a.chain}: <b>{usd(a.balance)} {a.symbol}</b> {d.evm && <a className="muted" href={ADDR[a.chain] + d.evm} target="_blank" rel="noreferrer">view wallet</a>}</small>)}
            <small className="muted">Coins bought on BNB Chain / Ethereum are paid with money moved there from your Solana wallet, so your Solana history shows only that Relay transfer out, not the buy itself (see the buy / sell links above, or "view wallet"). When they&apos;re sold, the money stays there as USDT and the next buy on that chain uses it first, which saves bridge fees.</small>
            <button type="button" className="btn small primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => { if (confirm("Send the USDT / USDC on BNB Chain / Ethereum back to your Solana wallet now (Relay, small fee)? Chains with an open trade are skipped.")) act("home", "send-home", {}); }}>Send back to Solana now</button>
          </>
        )}
        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={d.returnHome} disabled={busy} onChange={(e) => act("rh", "settings", { return_home: e.target.checked }, e.target.checked ? "On: after each sale on BNB Chain / Ethereum, the money (with any profit) goes back to Solana once nothing else is open there." : "Off: money from sales stays on that chain for the next buy there.")} />
          <small><b>Send money back to Solana after each sale</b> <span className="muted">(profit included; each trip costs a small Relay fee)</span></small>
        </label>
      </div>}
    </section>
  );
}
