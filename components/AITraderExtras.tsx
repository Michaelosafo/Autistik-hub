"use client";
/**
 * AI trader extras (admin page):
 * - TradeActions: on any open coin, buy more (in $), sell part of it (25–100%) or change its take profit / stop-loss.
 * - JustBought: right after the AI buys, asks whether to top up, change take profit / stop-loss, or keep it as is.
 * - WalletPanel: tap to see all the money: free to trade, worth of the coins held, each coin and each live wallet.
 * - BuyHours: the times of day the AI may buy (selling is never limited).
 * - TrackedBoard: every Telegram channel / group, X account and caller being followed, in one list, with how many
 *   calls each sent and how many the AI bought, plus every call from all of them in one feed.
 */
import { useEffect, useState } from "react";
import { fmtAmount, fmtUsd } from "@/lib/num-format";
import type { CopyData } from "@/components/AITraderCopy";
import type { LiveWallet } from "@/components/AITraderCopyExtras";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
export type Pos = {
  id: string; mode: string; chain: string; symbol: string | null; logo: string | null; status: string; spent: number; qty: number;
  entry_usd: number; last_usd: number | null; stop_loss: number; take_profit: number; trail: number; opened_at: string;
  source_group?: string | null; source_who?: string | null; why?: string | null;
};
type Sig = { id: number; at: string; source: string; who: string | null; url: string; chain: string; token: string; symbol: string | null; mcap: number | null; result: string | null };
type HoursSettings = { buy_hours_on?: boolean; buy_from?: string; buy_to?: string; buy_tz?: string };

const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
const pctNow = (p: Pos) => ((Number(p.last_usd) || Number(p.entry_usd)) / Number(p.entry_usd) - 1) * 100;
const from = (p: Pos) => (p.source_group ? `${p.source_who ? `${p.source_who} in ` : ""}${p.source_group}` : null);

/** Buy more, sell part, or change take profit / stop-loss on one open coin. */
export function TradeActions({ p, busy, onAct, start = null, freeUsd = null }: { p: Pos; busy: boolean; onAct: Act; start?: "buy" | "sell" | "tpsl" | null; freeUsd?: number | null }) {
  const [mode, setMode] = useState<"buy" | "sell" | "tpsl" | null>(start);
  const [usd, setUsd] = useState("10");
  const [pct, setPct] = useState("50");
  const [tp, setTp] = useState(String(p.take_profit));
  const [sl, setSl] = useState(String(p.stop_loss));
  useEffect(() => { setMode(start); }, [start]);
  const live = p.mode === "live";
  const sym = p.symbol || "this coin";
  const pick = (m: "buy" | "sell" | "tpsl") => setMode(mode === m ? null : m);

  async function buy() {
    const v = Number(usd);
    if (!(v >= 1)) return;
    if (live && !confirm(`Buy $${v} more ${sym} with real money?`)) return;
    await onAct("topup", "topup", { id: p.id, usd: v });
    setMode(null);
  }
  async function sell() {
    const v = Math.round(Number(pct));
    if (!(v >= 1 && v <= 100)) return;
    if (live && !confirm(`Sell ${v}% of ${sym} now?`)) return;
    await onAct("sellpart", "sell-part", { id: p.id, pct: v });
    setMode(null);
  }
  async function saveTpsl() {
    await onAct("edit", "edit", { id: p.id, take_profit: Number(tp), stop_loss: Number(sl) }, `${sym}: take profit +${Number(tp)}%, stop-loss -${Number(sl)}%.`);
    setMode(null);
  }

  return (
    <div className="aitx-act">
      <div className="aitx-act-row" role="group" aria-label={`Actions for ${sym}`}>
        <button type="button" className={"aitx-b buy" + (mode === "buy" ? " on" : "")} aria-expanded={mode === "buy"} disabled={busy || p.status !== "open"} onClick={() => pick("buy")}>➕ Buy more</button>
        <button type="button" className={"aitx-b sell" + (mode === "sell" ? " on" : "")} aria-expanded={mode === "sell"} disabled={busy || p.status !== "open"} onClick={() => pick("sell")}>💸 Sell</button>
        <button type="button" className={"aitx-b" + (mode === "tpsl" ? " on" : "")} aria-expanded={mode === "tpsl"} disabled={busy} onClick={() => pick("tpsl")}>🎯 TP / SL</button>
      </div>
      {mode === "buy" && (
        <div className="aitx-panel">
          <label className="aitx-l">How much more to buy?
            <span className="ait-in"><em>$</em><input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} aria-label="Dollars to add" /></span>
          </label>
          <div className="aitx-chips">{["5", "10", "25", "50", "100"].map((v) => <button key={v} type="button" className={usd === v ? "on" : ""} onClick={() => setUsd(v)}>${v}</button>)}</div>
          {freeUsd != null && <small className="muted">Free to trade: about {fmtUsd(freeUsd)}{live ? "" : " (practice)"}</small>}
          <small className="muted">The extra coins join this trade. Take profit and stop-loss then count from the new average buy price.</small>
          <button type="button" className="btn primary" disabled={busy || !(Number(usd) >= 1)} onClick={buy}>{busy ? "Working…" : `Buy $${Number(usd) || 0} more ${sym}`}</button>
        </div>
      )}
      {mode === "sell" && (
        <div className="aitx-panel">
          <label className="aitx-l">How much to sell?
            <span className="ait-in"><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Percent to sell" /><em>%</em></span>
          </label>
          <div className="aitx-chips">{["25", "50", "75", "100"].map((v) => <button key={v} type="button" className={pct === v ? "on" : ""} onClick={() => setPct(v)}>{v === "100" ? "All" : `${v}%`}</button>)}</div>
          <small className="muted">{Number(pct) >= 100 ? "Sells everything and closes the trade." : "The rest stays open with the same take profit and stop-loss."}</small>
          <button type="button" className="btn primary" disabled={busy || !(Number(pct) >= 1 && Number(pct) <= 100)} onClick={sell}>{busy ? "Working…" : Number(pct) >= 100 ? `Sell all ${sym}` : `Sell ${Math.round(Number(pct)) || 0}% of ${sym}`}</button>
        </div>
      )}
      {mode === "tpsl" && (
        <div className="aitx-panel">
          <div className="aitx-two">
            <label className="aitx-l up">Take profit
              <span className="ait-in"><input inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} aria-label="Take profit percent" /><em>%</em></span>
            </label>
            <label className="aitx-l down">Stop-loss
              <span className="ait-in"><input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} aria-label="Stop-loss percent" /><em>%</em></span>
            </label>
          </div>
          <div className="aitx-chips">
            {[["+10%", "10"], ["+25%", "25"], ["+50%", "50"], ["+100%", "100"]].map(([l, v]) => <button key={v} type="button" onClick={() => setTp(String(Math.max(1, Number(tp) + Number(v))))}>TP {l}</button>)}
            {[["-5", "5"], ["+5", "-5"]].map(([l, v]) => <button key={l} type="button" onClick={() => setSl(String(Math.max(1, Number(sl) - Number(v))))}>SL {l}</button>)}
          </div>
          <button type="button" className="btn primary" disabled={busy || !(Number(tp) > 0) || !(Number(sl) > 0)} onClick={saveTpsl}>Save take profit / stop-loss</button>
        </div>
      )}
    </div>
  );
}

/**
 * The yellow card at the top: the AI's newest coin, with Top up / Change TP-SL / Keep as is. "Keep as is" hides it
 * until the next buy. With nothing bought yet it says so, so the card is always there to find.
 */
export function JustBought({ open, busy, onAct, freeUsd }: { open: Pos[]; busy: boolean; onAct: Act; freeUsd: number | null }) {
  const [seen, setSeen] = useState<string[]>([]);
  const [start, setStart] = useState<"buy" | "tpsl" | null>(null);
  useEffect(() => { try { setSeen(JSON.parse(localStorage.getItem("ait-seen-buys") || "[]")); } catch { /* storage off: show it anyway */ } }, []);
  const newest = open.filter((x) => x.status === "open").sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))[0];
  const p = newest && !seen.includes(newest.id) ? newest : null;
  if (!p) return (
    <section className="aitx-new quiet" aria-live="polite">
      <small className="aitx-new-k">{newest ? "LATEST BUY" : "AI BUYS"}</small>
      <p>{newest ? <>Nothing new since <b>{newest.symbol}</b>. When the AI buys again, it shows here so you can top up or change take profit / stop-loss.</> : <>No open coins right now. The moment the AI buys, it shows here so you can top up or change take profit / stop-loss.</>}</p>
    </section>
  );
  const fresh = Date.now() - Date.parse(p.opened_at) < 60 * 60_000;
  const keep = () => {
    const next = [...seen, p.id].slice(-50);
    setSeen(next); setStart(null);
    try { localStorage.setItem("ait-seen-buys", JSON.stringify(next)); } catch { /* fine */ }
  };
  const src = from(p);
  return (
    <section className="aitx-new" aria-live="polite">
      <small className="aitx-new-k">{fresh ? "AI JUST BOUGHT" : "LATEST BUY"} · {ago(p.opened_at)}{p.mode === "paper" ? " · practice" : ""}</small>
      <p><b>{p.symbol}</b> at <b>{fmtUsd(Number(p.entry_usd))}</b>{src ? <> from <b>{src}</b></> : null}. Top up, or change take profit (+{Number(p.take_profit)}%) / stop-loss (-{Number(p.stop_loss)}%)?</p>
      {!start ? (
        <div className="aitx-act-row">
          <button type="button" className="aitx-b dark" disabled={busy} onClick={() => setStart("buy")}>➕ Top up</button>
          <button type="button" className="aitx-b dark" disabled={busy} onClick={() => setStart("tpsl")}>🎯 Change TP / SL</button>
          <button type="button" className="aitx-b line" onClick={keep}>Keep as is</button>
        </div>
      ) : (
        <>
          <TradeActions p={p} busy={busy} onAct={async (...a) => { await onAct(...a); keep(); }} start={start} freeUsd={freeUsd} />
          <button type="button" className="aitx-b line" style={{ alignSelf: "flex-start" }} onClick={keep}>Done</button>
        </>
      )}
    </section>
  );
}

/** All the money in one place. Tap to open. */
export function WalletPanel({ live, cash, open, bnbUsd, wallets, wallets2 }: { live: boolean; cash: number | null; open: Pos[]; bnbUsd: number | null; wallets: LiveWallet[]; wallets2?: LiveWallet[] }) {
  const [show, setShow] = useState(false);
  const coins = open.map((p) => ({ p, worth: Number(p.spent) * (1 + pctNow(p) / 100), pct: pctNow(p) }));
  const inCoins = coins.reduce((a, c) => a + c.worth, 0);
  const paid = coins.reduce((a, c) => a + Number(c.p.spent), 0);
  const total = (cash ?? 0) + inCoins;
  const usd = (bnb: number) => (bnbUsd ? fmtUsd(bnb * bnbUsd) : `${fmtAmount(bnb)} BNB`);
  const sign = (v: number) => (v >= 0 ? "+" : "−");
  const ws = [...wallets.filter((w) => w.address).map((w) => ({ ...w, slot: 1 })), ...(wallets2 || []).filter((w) => w.address).map((w) => ({ ...w, slot: 2 }))];
  return (
    <section className={"aitx-wallet" + (show ? " open" : "")}>
      <button type="button" className="aitx-wallet-h" aria-expanded={show} onClick={() => setShow(!show)}>
        <span aria-hidden="true">💼</span>
        <span className="grow">
          <small>{live ? "Total funds (live)" : "Total funds (practice)"}</small>
          <b>{usd(total)}</b>
        </span>
        <span className={"aitx-wallet-pl " + (inCoins - paid >= 0 ? "up" : "down")}>{sign(inCoins - paid)}{usd(Math.abs(inCoins - paid))} in trades</span>
        <span aria-hidden="true" className="aitx-chev">{show ? "▴" : "▾"}</span>
      </button>
      {show && (
        <div className="aitx-wallet-b">
          <div className="aitx-two">
            <div className="aitx-tile"><small>Free to trade</small><b>{cash == null ? "–" : usd(cash)}</b><small className="muted">{cash == null ? "" : `${fmtAmount(cash)} BNB`}</small></div>
            <div className="aitx-tile"><small>In {open.length} open coin{open.length === 1 ? "" : "s"}</small><b>{usd(inCoins)}</b><small className="muted">paid {usd(paid)}</small></div>
          </div>
          {coins.length > 0 && (
            <div className="aitx-list">
              {coins.map(({ p, worth, pct }) => (
                <div key={p.id} className="aitx-li">
                  {p.logo ? <img src={p.logo} alt="" width={28} height={28} /> : <span className="ait-ph">{(p.symbol || "?").slice(0, 2)}</span>}
                  <span className="grow"><b>{p.symbol}</b><br /><small className="muted">bought at {fmtUsd(Number(p.entry_usd))}</small></span>
                  <span className="n"><b>{usd(worth)}</b><br /><small className={pct >= 0 ? "up" : "down"}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</small></span>
                </div>
              ))}
            </div>
          )}
          {live && ws.length > 0 && (
            <div className="aitx-list">
              <small className="muted">Live wallets</small>
              {ws.map((w) => (
                <div key={`${w.slot}-${w.chain}`} className="aitx-li">
                  <span className="grow"><b>{w.native}</b> <small className="muted">{w.chain}{w.slot === 2 ? " · Wallet 2" : ""}</small><br /><code className="aitx-addr">{w.address}</code></span>
                  <span className="n"><b>{w.balance == null ? "–" : fmtAmount(w.balance)}</b></span>
                </div>
              ))}
            </div>
          )}
          {!live && <small className="muted">Practice mode: pretend BNB at real prices. Switch to Live below to trade the real wallet.</small>}
        </div>
      )}
    </section>
  );
}

/** The times of day the AI may buy. */
export function BuyHours({ s, busy, onAct }: { s: HoursSettings; busy: boolean; onAct: Act }) {
  const [on, setOn] = useState(!!s.buy_hours_on);
  const [a, setA] = useState(s.buy_from || "09:00");
  const [b, setB] = useState(s.buy_to || "23:00");
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
  const changed = on !== !!s.buy_hours_on || a !== s.buy_from || b !== s.buy_to || (on && tz !== s.buy_tz);
  return (
    <section className="card stack aitx-hours">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b>⏰ Buy hours</b>
        <small className="muted">{s.buy_hours_on ? `Saved: buys only ${s.buy_from} to ${s.buy_to}` : "Saved: buys any time"}</small>
      </div>
      <label className="ait-check"><input type="checkbox" checked={on} disabled={busy} onChange={(e) => setOn(e.target.checked)} /> <span>Only buy between these times</span></label>
      <div className="aitx-two">
        <label className="aitx-l">From<input className="input" type="time" value={a} disabled={!on} onChange={(e) => setA(e.target.value)} /></label>
        <label className="aitx-l">To<input className="input" type="time" value={b} disabled={!on} onChange={(e) => setB(e.target.value)} /></label>
      </div>
      <small className="muted">Your time zone: {tz}. A window like 22:00 to 06:00 runs past midnight. This applies to every way it buys (Telegram, X, callers and its own scanning). Selling never stops: stop-loss and take profit work all day.</small>
      <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy || !changed}
        onClick={() => onAct("hours", "settings", { buy_hours_on: on, buy_from: a, buy_to: b, buy_tz: tz }, on ? `Saved: it buys only between ${a} and ${b}.` : "Saved: it buys any time.")}>
        Save buy hours
      </button>
    </section>
  );
}

const norm = (v: string | null | undefined) => String(v || "").replace(/^@/, "").trim().toLowerCase();
const KIND: Record<string, string> = { tg: "Telegram channel", tg_chat: "Telegram group", x_account: "X account", x_list: "X list", x_community: "X community" };

/** Edit how much one channel / group / caller buys (and a caller's own stop-loss / take profit), in place. */
function BuyEdit({ kind, id, usd, sl, tp, dsl, dtp, busy, onAct, onDone }: { kind: "source" | "caller"; id: number; usd: number | null; sl?: number | null; tp?: number | null; dsl: number; dtp: number; busy: boolean; onAct: Act; onDone: () => void }) {
  const [u, setU] = useState(usd ? String(usd) : ""), [a, setA] = useState(sl ? String(sl) : ""), [b, setB] = useState(tp ? String(tp) : "");
  const save = async () => {
    if (kind === "source") await onAct(`sz${id}`, "source", { op: "size", id, usd: u === "" ? "" : Number(u) });
    else await onAct(`cle${id}`, "caller", { op: "edit", id, usd: Number(u), sl: a, tp: b });
    onDone();
  };
  return (
    <form className="aitx-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <span className="ait-in"><em>$</em><input inputMode="decimal" value={u} placeholder={kind === "source" ? "normal" : ""} onChange={(e) => setU(e.target.value)} aria-label="Dollars per buy" autoFocus /></span>
      {kind === "caller" && <>
        <span className="ait-in"><em>SL −</em><input inputMode="decimal" value={a} placeholder={String(dsl)} onChange={(e) => setA(e.target.value)} aria-label="Stop-loss %" /><em>%</em></span>
        <span className="ait-in"><em>TP +</em><input inputMode="decimal" value={b} placeholder={String(dtp)} onChange={(e) => setB(e.target.value)} aria-label="Take profit %" /><em>%</em></span>
      </>}
      <button type="submit" className="btn small primary" disabled={busy || (kind === "caller" && !(Number(u) > 0))}>Save</button>
      <button type="button" className="btn small" onClick={onDone}>Cancel</button>
    </form>
  );
}

/** Everyone being followed, as one list (with what each one buys, editable), and every call they sent, as one feed. */
export function TrackedBoard({ copy, xCallers, signals, positions, callersOnly = true, normalUsd = 0, dsl = 5, dtp = 100, busy = false, onAct }: { copy: CopyData; xCallers: string[]; signals: Sig[]; positions: Pos[]; callersOnly?: boolean; normalUsd?: number; dsl?: number; dtp?: number; busy?: boolean; onAct?: Act }) {
  const [tab, setTab] = useState<"who" | "calls">("who");
  const [editing, setEditing] = useState<string | null>(null);
  const [kind, setKind] = useState<"all" | "channels" | "callers">("all");
  const rows = [
    ...copy.sources.map((x) => ({ key: `s${x.id}`, name: x.title || x.ref, alt: x.ref, type: KIND[x.kind] || x.kind, group: "channels" as const, platform: x.kind.startsWith("x") ? "X" : "TG", on: x.enabled, last: x.last_post_at,
      edit: x.kind === "tg_chat" ? { kind: "source" as const, id: x.id, usd: x.usd ?? null, sl: null, tp: null } : null })),
    ...copy.callers.map((c) => ({ key: `c${c.id}`, name: `@${c.who}`, alt: c.who, type: c.platform === "x" ? "X caller" : `Caller · ${c.chat_title ? `only in ${c.chat_title}` : "all groups"}`, group: "callers" as const, platform: c.platform === "x" ? "X" : "TG", on: true, last: null as string | null,
      edit: { kind: "caller" as const, id: c.id, usd: Number(c.usd) || null, sl: c.sl ?? null, tp: c.tp ?? null }, trusted: !!c.trusted, scout: !!c.scout })),
    ...xCallers.filter((h) => !copy.callers.some((c) => norm(c.who) === norm(h))).map((h) => ({ key: `x${h}`, name: `@${h}`, alt: h, type: "X caller (fresh signals)", group: "callers" as const, platform: "X", on: true, last: null as string | null, edit: null })),
  ];
  const stats = (r: (typeof rows)[number]) => {
    const names = [norm(r.name), norm(r.alt)].filter(Boolean);
    const hit = (v: string | null | undefined) => !!v && names.includes(norm(v));
    const calls = signals.filter((g) => hit(g.who));
    const bought = positions.filter((p) => hit(p.source_group) || hit(p.source_who));
    const last = [r.last, calls[0]?.at].filter(Boolean).sort().pop() || null;
    return { calls: calls.length, bought: bought.length, last };
  };
  const shown = rows.filter((r) => kind === "all" || r.group === kind);
  const on = rows.filter((r) => r.on).length;
  const label = (src: string) => (src === "telegram" ? "TG" : src === "x" ? "X" : "Dex");
  return (
    <section className="card stack aitx-board">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>📡 Callers &amp; channels we track</b>
        <small className="muted">{on} on · {rows.length} saved</small>
      </div>
      <div className="ait-seg" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={tab === "who"} className={tab === "who" ? "on" : ""} onClick={() => setTab("who")}>Who we track ({rows.length})</button>
        <button type="button" role="tab" aria-selected={tab === "calls"} className={tab === "calls" ? "on" : ""} onClick={() => setTab("calls")}>All calls ({signals.length})</button>
      </div>
      {tab === "who" ? (
        <>
          {onAct && (
            <label className={"aic-row" + (callersOnly ? " on" : "")}>
              <input type="checkbox" checked={callersOnly} disabled={busy} onChange={(e) => onAct("callersonly", "settings", { callers_only: e.target.checked }, e.target.checked ? "Groups now buy only your callers' calls. Channels still buy every call." : "Groups now buy everyone's calls.")} />
              <span className="grow"><b>In groups, buy only my callers</b><small className="muted">A coin posted in a group is bought only when one of your callers below posted it. Channels buy every call, at the channel&apos;s own amount.</small></span>
            </label>
          )}
          <div className="aitx-chips" role="group" aria-label="Filter">
            {([["all", "All"], ["channels", "Channels & groups"], ["callers", "Callers"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}
          </div>
          {!shown.length ? <small className="muted">Nothing saved yet. Add Telegram channels, X accounts and callers in the sections below; they all show here.</small> : (
            <div className="aitx-list">
              {shown.map((r) => {
                const st = stats(r);
                const e = r.edit;
                const buys = e ? (e.usd ? `buys $${Number(e.usd).toLocaleString("en-US")}` : e.kind === "source" ? `buys the normal size${normalUsd ? ` ($${normalUsd})` : ""}` : "") + (e.kind === "caller" ? ` · SL −${e.sl || dsl}% · TP +${e.tp || dtp}%` : "") : "";
                return (
                  <div key={r.key} className={"aitx-li wrap" + (r.on ? "" : " off")}>
                    <span className={"aitx-plat " + r.platform.toLowerCase()}>{r.platform}</span>
                    <span className="grow"><b>{r.name}</b><br /><small className="muted">{r.type}{r.on ? "" : " · paused"}{st.last ? ` · last call ${ago(st.last)}` : ""}</small>{buys && <><br /><small className="aitx-buys">{buys}</small></>}</span>
                    <span className="n"><b>{st.calls}</b> <small className="muted">calls</small><br /><small className={st.bought ? "up" : "muted"}>{st.bought} bought</small></span>
                    {e?.kind === "caller" && onAct && (
                      <button type="button" className={"aitx-trust" + ((r as any).trusted ? " on" : "")} aria-pressed={!!(r as any).trusted} disabled={busy}
                        onClick={() => onAct(`tr${e.id}`, "caller", { op: "trust", id: e.id, trusted: !(r as any).trusted })}
                        title="Trusted: a legit account or consistent winner. Its scout buys skip the rug check.">{(r as any).trusted ? "✓ Trusted" : "Trust"}{(r as any).scout ? " · scout" : ""}</button>
                    )}
                    {e && onAct && editing !== r.key && <button type="button" className="aic-x" disabled={busy} onClick={() => setEditing(r.key)} aria-label={`Edit what ${r.name} buys`}>✏️</button>}
                    {e && onAct && editing === r.key && <BuyEdit kind={e.kind} id={e.id} usd={e.usd} sl={e.sl} tp={e.tp} dsl={dsl} dtp={dtp} busy={busy} onAct={onAct} onDone={() => setEditing(null)} />}
                  </div>
                );
              })}
            </div>
          )}
          <small className="muted">Counts are from the latest {signals.length} calls and this page&apos;s trades. Add, pause or remove sources in Copy trading and Fresh signals below.</small>
        </>
      ) : !signals.length ? <small className="muted">No calls yet. Every call from every source shows here as it lands.</small> : (
        <div className="aitx-list">
          {signals.map((g) => {
            const won = g.result?.startsWith("bought");
            return (
              <div key={g.id} className="aitx-li">
                <span className={"aitx-plat " + label(g.source).toLowerCase()}>{label(g.source)}</span>
                <span className="grow"><b>{g.symbol || `${g.token.slice(0, 6)}…`}</b> <small className="muted">{g.who ? `${g.source === "x" ? "@" : ""}${g.who} · ` : ""}{ago(g.at)}{g.mcap ? ` · $${Math.round(g.mcap).toLocaleString("en-US")} mcap` : ""}</small><br /><small className={won ? "up" : "muted"}>{won ? "✓ " : ""}{g.result}</small></span>
                {g.url.startsWith("http") && <a href={g.url} target="_blank" rel="noopener noreferrer" className="btn small">Open</a>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type Holding = { chain: string; token: string; symbol: string | null; logo: string | null; slot: number; amount: number; usd: number | null; price: number | null; tracked: boolean };

/**
 * What's really in the trading wallets. A coin that's there but that no trade is watching (a buy that landed after it
 * was reported as failed, or bought another way) is flagged, and can be watched with a stop-loss or sold at once.
 */
export function WalletCoins({ busy, onAct, dsl = 5, dtp = 100 }: { busy: boolean; onAct: Act; dsl?: number; dtp?: number }) {
  const [list, setList] = useState<Holding[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sl, setSl] = useState(String(dsl));
  async function load() {
    setLoading(true); setErr("");
    const r = await fetch("/api/ai-trader/holdings", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((x) => x.json()).catch(() => null);
    setLoading(false);
    if (!r?.ok) { setErr(r?.error || "Couldn't read the wallet. Try again."); return; }
    setList(r.holdings);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const loose = (list || []).filter((h) => !h.tracked);
  const act = async (h: Holding, sell: boolean) => {
    if (sell && !confirm(`Sell all ${h.symbol || "of this coin"} now?`)) return;
    await onAct(`adopt${h.token}`, "adopt", { chain: h.chain, token: h.token, slot: h.slot, sl: Number(sl), tp: dtp, sell });
    load();
  };
  return (
    <section className={"card stack aitx-coins" + (loose.length ? " alert" : "")}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>🪙 Coins in the trading wallet</b>
        <button type="button" className="btn small" disabled={loading} onClick={load}>{loading ? "Checking…" : "Check again"}</button>
      </div>
      {err && <small className="down">{err}</small>}
      {list && !list.length && <small className="muted">None of the coins the AI bought are in the wallet right now.</small>}
      <small className="muted">Only coins the AI trader bought are shown. Other tokens that turn up in the wallet (often spam sent to lure you) are hidden and can&apos;t be sold from here.</small>
      {loose.length > 0 && (
        <>
          <p style={{ margin: 0 }}><b>{loose.length} coin{loose.length === 1 ? " is" : "s are"} in the wallet with no stop-loss watching {loose.length === 1 ? "it" : "them"}.</b> Watch {loose.length === 1 ? "it" : "them"} with a stop-loss, or sell.</p>
          <label className="aitx-l" style={{ maxWidth: 220 }}>Stop-loss for these
            <span className="ait-in"><em>−</em><input inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} aria-label="Stop-loss percent" /><em>%</em></span>
          </label>
        </>
      )}
      {list && list.length > 0 && (
        <div className="aitx-list">
          {list.map((h) => (
            <div key={`${h.slot}:${h.chain}:${h.token}`} className={"aitx-li wrap" + (h.tracked ? "" : " loose")}>
              {h.logo ? <img src={h.logo} alt="" width={28} height={28} /> : <span className="ait-ph">{(h.symbol || "?").slice(0, 2)}</span>}
              <span className="grow"><b>{h.symbol || `${h.token.slice(0, 6)}…`}</b> <small className="muted">{h.chain}{h.slot === 2 ? " · Wallet 2" : ""}</small><br />
                <small className={h.tracked ? "up" : "down"}>{h.tracked ? "✓ Watched by a trade (stop-loss on)" : "⚠ Not tracked: no stop-loss"}</small></span>
              <span className="n"><b>{h.usd == null ? "–" : fmtUsd(h.usd)}</b><br /><small className="muted">{h.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}</small></span>
              {!h.tracked && (
                <span className="aitx-act-row" style={{ flexBasis: "100%" }}>
                  <button type="button" className="aitx-b buy" disabled={busy || !(Number(sl) > 0)} onClick={() => act(h, false)}>🎯 Watch with stop-loss −{Number(sl) || dsl}%</button>
                  <button type="button" className="aitx-b sell" disabled={busy} onClick={() => act(h, true)}>💸 Sell all now</button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Trade in stablecoins: on Solana, BNB Chain and Ethereum, buys with USDT or USDC (whichever the wallet holds more of on
 * that network) and sells back into the same one, so money between trades stays in dollars. Each network still needs a
 * little of its own coin for fees. SOL ↔ USDT / USDC can be converted here.
 */
export function StableMode({ on, live, wallets, busy, onAct }: { on: boolean; live: boolean; wallets: LiveWallet[]; busy: boolean; onAct: Act }) {
  const [amt, setAmt] = useState("");
  const [dir, setDir] = useState<"usdc" | "sol">("usdc");
  const [sym, setSym] = useState<"USDT" | "USDC">("USDT");
  const nets = wallets.filter((w) => w.address && (w.stables || []).length);
  const sol = wallets.find((w) => w.chain === "solana" && w.address) || null;
  const NAME: Record<string, string> = { solana: "Solana", bsc: "BNB Chain", ethereum: "Ethereum" };
  return (
    <section className={"card stack" + (on ? " aitx-hours" : "")}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>💵 Trade in stablecoins</b>
        <small className="muted">{on ? "On: buys with USDT / USDC, sells back into it" : "Off: buys with each network's own coin"}</small>
      </div>
      <label className={"aic-row" + (on ? " on" : "")}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => onAct("stable", "settings", { stable_on: e.target.checked }, e.target.checked ? "Stablecoins on: coins are bought with USDT / USDC on their own network and sold back into it." : "Stablecoins off: coins are bought with each network's own coin.")} />
        <span className="grow"><b>Buy with USDT / USDC and sell back into it</b><small className="muted">On Solana, BNB Chain and Ethereum: a coin on Solana is bought with Solana USDT / USDC, a BNB Chain coin with BNB Chain USDT / USDC, and so on. It uses whichever of the two you hold more of there (USDT if you mostly keep USDT). Keep a little SOL / BNB / ETH on each network for fees.</small></span>
      </label>
      {live && nets.length > 0 && (
        <div className="aitx-list">
          {nets.map((w) => (
            <div key={w.chain} className="aitx-li">
              <span className="grow"><b>{NAME[w.chain] || w.chain}</b><br /><small className="muted">fees: {w.balance == null ? "–" : w.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })} {w.native}</small></span>
              <span className="n">{(w.stables || []).map((x) => <span key={x.symbol} style={{ display: "block" }}><b>${x.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b> <small className="muted">{x.symbol}</small></span>)}</span>
            </div>
          ))}
        </div>
      )}
      {live && sol && (
        <div className="aitx-act-row">
          <small className="muted" style={{ flexBasis: "100%" }}>Solana: convert SOL and stablecoins</small>
          <span className="ait-seg" role="group" aria-label="Convert direction">
            <button type="button" className={dir === "usdc" ? "on" : ""} onClick={() => setDir("usdc")}>SOL → {sym}</button>
            <button type="button" className={dir === "sol" ? "on" : ""} onClick={() => setDir("sol")}>{sym} → SOL</button>
          </span>
          <span className="ait-seg" role="group" aria-label="Stablecoin">
            {(["USDT", "USDC"] as const).map((x) => <button key={x} type="button" className={sym === x ? "on" : ""} onClick={() => setSym(x)}>{x}</button>)}
          </span>
          <span className="ait-in" style={{ maxWidth: 160 }}><input inputMode="decimal" value={amt} placeholder="Amount" onChange={(e) => setAmt(e.target.value)} aria-label="Amount to convert" /><em>{dir === "usdc" ? "SOL" : sym}</em></span>
          <button type="button" className="btn primary small" disabled={busy || !(Number(amt) > 0)} onClick={() => { if (confirm(`Convert ${amt} ${dir === "usdc" ? `SOL into ${sym}` : `${sym} into SOL`}?`)) onAct("convert", "convert", { to: dir, symbol: sym, amount: Number(amt) }).then(() => setAmt("")); }}>Convert</button>
        </div>
      )}
    </section>
  );
}

type ScoutRow = { key: string; platform: "tg" | "x"; who: string; chats: string[]; calls: number; wins: number; winRate: number; medianPeak: number; rugRate: number; fastRate: number; following: boolean };
type ScoutData = { board: { callers: ScoutRow[]; groups: ScoutRow[]; calls: number; scored: number; chats: number }; money: { avail: number; inTrades: number; pnl: number }; chats: { ref: string; title: string; kind: string; enabled: boolean; scanned_at: string | null }[] };
type ScoutS = { scout_on?: boolean; scout_budget?: number; scout_trade_usd?: number; scout_min_win?: number; scout_min_calls?: number; scout_multiple?: number; scout_fast_min?: number; scout_group_rate?: number; scout_trust_skip?: boolean; scout_honeypot_trusted?: boolean };

/**
 * Caller scout: reads every group / channel the Telegram account is in (and public ones added by link) and the X
 * accounts you follow, scores every call against real prices, follows the callers and groups that clear the bar, and
 * trades them from a capped budget (rug-checked, except trusted callers).
 */
export function ScoutCard({ s, busy, onAct }: { s: ScoutS; busy: boolean; onAct: Act }) {
  const [d, setD] = useState<ScoutData | null>(null);
  const [tab, setTab] = useState<"callers" | "groups">("callers");
  const [link, setLink] = useState("");
  const on = !!s.scout_on;
  const load = async () => { const r = await fetch("/api/ai-trader/scout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((x) => x.json()).catch(() => null); if (r?.ok) setD(r); };
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (b: ScoutS, done?: string) => onAct("scout-set", "settings", b, done);
  const num = (k: keyof ScoutS, label: string, unit: string, hint: string) => (
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <small><b>{label}:</b> {String(s[k] ?? "–")}{unit}</small>
      <button type="button" className="btn small" disabled={busy} onClick={() => { const v = prompt(`${label} (${hint}):`, String(s[k] ?? "")); if (v != null && v.trim() !== "" && isFinite(Number(v))) set({ [k]: Number(v) } as ScoutS); }}>Change</button>
      <small className="muted">{hint}</small>
    </div>
  );
  const rows = d ? (tab === "callers" ? d.board.callers : d.board.groups) : [];
  const budget = Number(s.scout_budget) || 0;
  const m = d?.money;
  return (
    <section className={"card stack" + (on ? " aitx-hours" : "")}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <b>🔎 Caller scout</b>
        <small className="muted">{d ? `${d.board.chats} chats read · ${d.board.calls} calls seen · ${d.board.scored} scored` : "…"}</small>
      </div>
      <label className={"aic-row" + (on ? " on" : "")}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => set({ scout_on: e.target.checked }, e.target.checked ? "Scout on: it reads all your Telegram groups and channels and the X accounts you follow, and learns who calls winners." : "Scout off.")} />
        <span className="grow"><b>Find and trade the best callers and groups</b><small className="muted">Reads every group and channel your Telegram account is in (not only the ones you copy) and the X accounts you follow. Each call is checked against the real price for 24 hours. Callers whose calls reach {s.scout_multiple ?? 3}x at least {s.scout_min_win ?? 97}% of the time (over {s.scout_min_calls ?? 5}+ calls), and groups whose calls double within {s.scout_fast_min ?? 30} min at least {s.scout_group_rate ?? 60}% of the time, are followed automatically.</small></span>
      </label>
      <div className="aitx-two">
        <div className="aitx-tile"><small>Scout budget</small><b>${budget.toLocaleString("en-US")}</b><small className="muted">its trades never use more than this{m ? `, plus what they've made (${m.pnl >= 0 ? "+" : "−"}$${Math.abs(m.pnl).toFixed(2)})` : ""}</small></div>
        <div className="aitx-tile"><small>Free to use now</small><b>{m ? `$${m.avail.toFixed(2)}` : "–"}</b><small className="muted">{m ? `$${m.inTrades.toFixed(2)} in open scout trades` : ""}</small></div>
      </div>
      {num("scout_budget", "Budget", " $", "the most the scout's trades can have in at once; losses shrink it, wins grow it")}
      {num("scout_trade_usd", "Each trade", " $", "per call; it buys less if the budget has less left")}
      <details>
        <summary><b>The bar to be followed</b></summary>
        <div className="stack" style={{ gap: 6, marginTop: 6 }}>
          {num("scout_min_win", "Caller win rate", " %", "share of their calls that reached the target")}
          {num("scout_multiple", "Target", "x", "a call wins if the price reached this within 24 h")}
          {num("scout_min_calls", "At least", " calls", "fewer is too little to tell skill from luck")}
          {num("scout_group_rate", "Group fast-pump rate", " %", "share of a group's calls that doubled fast")}
          {num("scout_fast_min", "Fast means within", " min", "")}
        </div>
      </details>
      <label className="ait-check"><input type="checkbox" checked={s.scout_trust_skip !== false} disabled={busy} onChange={(e) => set({ scout_trust_skip: e.target.checked })} /> <span>No rug check for trusted callers (consistent winners the scout found, and ones you mark ✓ Trusted). Everyone else is rug-checked: honeypot, extreme tax, freeze traps, pool under $5K, danger flags.</span></label>
      {s.scout_trust_skip !== false && <label className="ait-check"><input type="checkbox" checked={s.scout_honeypot_trusted !== false} disabled={busy} onChange={(e) => set({ scout_honeypot_trusted: e.target.checked })} /> <span>Still block honeypots for trusted callers (coins that can&apos;t be sold at all). Recommended: a legit account can be hacked or paid to post.</span></label>}
      <div className="ait-seg" role="tablist" aria-label="Scoreboard">
        <button type="button" role="tab" aria-selected={tab === "callers"} className={tab === "callers" ? "on" : ""} onClick={() => setTab("callers")}>Top callers</button>
        <button type="button" role="tab" aria-selected={tab === "groups"} className={tab === "groups" ? "on" : ""} onClick={() => setTab("groups")}>Fast-pump groups</button>
      </div>
      {!d ? <small className="muted">Loading…</small> : !rows.length ? <small className="muted">{on ? "Learning: calls are scored once their 24 hours are up (or they hit the target). The first scores show within the hour from the groups' recent history." : "Switch the scout on to start learning."}</small> : (
        <div className="aitx-list">
          {rows.slice(0, 25).map((r) => (
            <div key={r.key} className="aitx-li wrap">
              <span className={"aitx-plat " + (r.platform === "x" ? "x" : "tg")}>{r.platform === "x" ? "X" : "TG"}</span>
              <span className="grow"><b>{tab === "callers" ? `@${r.who}` : r.who}</b>{r.following && <small className="up"> · following</small>}<br />
                <small className="muted">{tab === "callers" ? `${r.chats.join(", ")} · ` : ""}{r.calls} calls · median peak {r.medianPeak.toFixed(1)}x · rugs {Math.round(r.rugRate)}%</small></span>
              <span className="n"><b className={(tab === "callers" ? r.winRate : r.fastRate) >= (tab === "callers" ? Number(s.scout_min_win ?? 97) : Number(s.scout_group_rate ?? 60)) ? "up" : ""}>{Math.round(tab === "callers" ? r.winRate : r.fastRate)}%</b><br /><small className="muted">{tab === "callers" ? `hit ${s.scout_multiple ?? 3}x` : `2x in ${s.scout_fast_min ?? 30}m`}</small></span>
            </div>
          ))}
        </div>
      )}
      <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); if (link.trim()) onAct("scout-chat", "scout-chat", { link: link.trim() }).then(() => { setLink(""); load(); }); }}>
        <input className="input" style={{ flex: "1 1 200px" }} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Add a public group: t.me/name or @name" aria-label="Public group link" />
        <button type="submit" className="btn small" disabled={busy || !link.trim()}>Add to scout</button>
      </form>
      <small className="muted">A high win rate over a few calls can be luck, and callers sometimes delete their losing calls, so the scoreboard shows every number. Few callers reach {s.scout_min_win ?? 97}%: if nobody qualifies after a few days, lowering the bar is a choice, not a fix.</small>
    </section>
  );
}
