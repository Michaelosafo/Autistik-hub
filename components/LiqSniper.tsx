"use client";
/**
 * BSC Sniper: the tokens to snipe (paste contract addresses before launch) and when to sell.
 * Wallets, gas speed, MEV protection and the trades card are Copy's (shared component).
 */
import { useState } from "react";

type Target = { token: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[] };
type S = { liq_targets?: Target[]; liq_x?: number; liq_sell_pct?: number; liq_slip?: number; liq_tp_on?: boolean; snipe_usd?: number; enabled: boolean; mode: string; last_note?: string | null };
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function LiqSniper({ s, busy, set, slots }: { s: S; busy: string; set: (b: any, done?: string) => Promise<void>; slots: number[] }) {
  const [ca, setCa] = useState(""), [label, setLabel] = useState(""), [amt, setAmt] = useState(""), [err, setErr] = useState("");
  // Wallets picked for the token being added (empty = all).
  const [pick, setPick] = useState<number[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const who = (w?: number[]) => (w && w.length && w.length < slots.length ? `wallet ${w.map((x) => `#${x}`).join(" + ")}` : "all wallets");
  const toggle = (list: number[], x: number) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x].sort());
  const list = s.liq_targets || [];
  const save = (next: Target[], done?: string) => set({ liq_targets: next }, done);
  const per = Number(s.snipe_usd || 5), x = Number(s.liq_x || 2), pct = Number(s.liq_sell_pct || 100), slip = Number(s.liq_slip || 20), tp = s.liq_tp_on !== false;

  const add = () => {
    const m = ca.trim().match(/0x[0-9a-fA-F]{40}/); // pasted links (BscScan, DexScreener…) work too
    const a = m ? m[0] : "";
    if (!isAddr(a)) { setErr("Paste the token's contract address (0x followed by 40 letters / numbers)."); return; }
    if (list.some((t) => t.token.toLowerCase() === a.toLowerCase())) { setErr("That token is already on the list."); return; }
    const usd = Number(amt);
    setErr(""); setCa(""); setLabel(""); setAmt("");
    const w = pick.length && pick.length < slots.length ? pick : undefined;
    setPick([]);
    save([...list, { token: a, label: label.trim() || undefined, usd: usd > 0 ? usd : undefined, on: true, state: "waiting", added: new Date().toISOString(), wallets: w }],
      `Waiting for liquidity on ${label.trim() || short(a)} with ${who(w)}. It buys within a block of liquidity landing${s.enabled ? "" : " (press ▶ START)"}.`);
  };

  return (
    <section className="card stack">
      <b>🎯 Tokens to snipe</b>
      <small className="muted">Paste the contract address the team shared before launch. When their liquidity lands on PancakeSwap, your wallets buy in the next block.</small>
      <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" style={{ fontFamily: "monospace" }} placeholder="Paste token contract address 0x…" value={ca} onChange={(e) => { setCa(e.target.value); setErr(""); }} aria-label="Token contract address" autoComplete="off" spellCheck={false} />
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 120px" }} placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} aria-label="Name" />
          <input className="input" style={{ flex: "0 1 130px" }} inputMode="decimal" placeholder={`$ per wallet (${per})`} value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Dollars per wallet" />
          <button type="submit" className="btn primary" disabled={!!busy || !ca.trim()}>Snipe it</button>
        </div>
        {slots.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <small><b>Which wallets snipe it:</b></small>
            <button type="button" className={"btn small" + (pick.length === 0 ? " primary" : " ghost")} onClick={() => setPick([])} aria-pressed={pick.length === 0}>All</button>
            {slots.map((x) => <button key={x} type="button" className={"btn small" + (pick.includes(x) ? " primary" : " ghost")} onClick={() => { const next = pick.length === 0 ? [x] : toggle(pick, x); setPick(next.length === slots.length ? [] : next); }} aria-pressed={pick.includes(x)}>#{x}</button>)}
            <small className="muted">{pick.length === 0 ? "all wallets" : who(pick)}</small>
          </div>
        )}
      </form>
      {err && <small className="aic-warn" role="alert">{err}</small>}
      {!list.length && <small className="muted">No tokens yet.</small>}
      {list.map((t) => {
        const st = t.state || "waiting";
        return (
          <div key={t.token} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="chip">{st === "done" ? "✅ Bought" : st === "failed" ? "⚠ Stopped" : t.on === false ? "⏸ Paused" : s.enabled ? "⏳ Waiting" : "⏹ Stopped"} · {t.label || short(t.token)}{t.usd ? ` · $${t.usd}` : ""} · {who(t.wallets)}</span>
            {slots.length > 1 && <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => setEditing(editing === t.token ? null : t.token)}>Wallets</button>}
            <a className="muted" href={`https://bscscan.com/token/${t.token}`} target="_blank" rel="noreferrer"><small>BscScan</small></a>
            {st === "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => save(list.map((x) => (x === t ? { ...x, on: x.on === false } : x)))}>{t.on === false ? "Resume" : "Pause"}</button>}
            {st !== "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => { if (confirm(`Arm ${t.label || short(t.token)} again? It will buy again if it can be bought.`)) save(list.map((x) => (x === t ? { ...x, state: "waiting", on: true } : x))); }}>Arm again</button>}
            <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => save(list.filter((x) => x !== t))}>Remove</button>
            {editing === t.token && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                <small>Snipe {t.label || short(t.token)} with:</small>
                {slots.map((x) => {
                  const cur = t.wallets && t.wallets.length ? t.wallets : slots;
                  const on = cur.includes(x);
                  return <button key={x} type="button" className={"btn small" + (on ? " primary" : " ghost")} disabled={!!busy || (on && cur.length === 1)} onClick={() => {
                    const next = toggle(cur, x);
                    save(list.map((y) => (y === t ? { ...y, wallets: next.length && next.length < slots.length ? next : undefined } : y)), `${t.label || short(t.token)}: ${who(next.length < slots.length ? next : undefined)}.`);
                  }}>#{x}</button>;
                })}
              </div>
            )}
          </div>
        );
      })}
      {s.enabled && s.last_note ? <small className="muted">Now: {s.last_note}</small> : null}

      <b style={{ marginTop: 8 }}>💰 Buy and sell</b>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <small><b>Buy:</b> ${per} per wallet</small>
        <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt("$ each wallet spends per snipe (paid in USDT if the wallet holds enough, else BNB):", String(per)); if (v != null && Number(v) >= 0.5) set({ snipe_usd: Number(v) }); }}>Change</button>
      </div>
      <label className="ait-check" style={{ margin: 0 }}>
        <input type="checkbox" checked={tp} disabled={!!busy} onChange={(e) => set({ liq_tp_on: e.target.checked }, e.target.checked ? `Sells at ${x}x by itself.` : "Auto-sell off: you sell yourself (buttons on each trade).")} />
        <span>Auto-sell for profit <small className="muted">{tp ? `(sells ${pct}% at ${x}x)` : "(off: you sell yourself)"}</small></span>
      </label>
      {tp && <>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <small><b>Sell at:</b></small>
          {[1.5, 2, 3, 5, 10].map((v) => <button key={v} type="button" className={"btn small" + (x === v ? " primary" : " ghost")} disabled={!!busy || x === v} onClick={() => set({ liq_x: v }, `Sells at ${v}x.`)}>{v}x</button>)}
          <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { const v = prompt("Sell when it's worth how many times what you paid (e.g. 2.5):", String(x)); if (v != null && Number(v) > 1) set({ liq_x: Number(v) }, `Sells at ${Number(v)}x.`); }}>Other…</button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <small><b>How much to sell then:</b></small>
          {[25, 50, 75, 100].map((v) => <button key={v} type="button" className={"btn small" + (pct === v ? " primary" : " ghost")} disabled={!!busy || pct === v} onClick={() => set({ liq_sell_pct: v }, v === 100 ? "Sells everything at the target." : `Sells ${v}% at the target; the rest rides (sell it yourself).`)}>{v}%</button>)}
        </div>
        <small className="muted">Selling 50% at 2x gets your money back and lets the rest ride for free.</small>
      </>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <small><b>Slippage:</b> {slip === 20 ? "Auto (20%)" : `${slip}%`}</small>
        {([["Auto", 20], ["10%", 10], ["30%", 30], ["49%", 49]] as const).map(([l, v]) => <button key={l} type="button" className={"btn small" + (slip === v ? " primary" : " ghost")} disabled={!!busy || slip === v} onClick={() => set({ liq_slip: v }, `Slippage ${l}.`)}>{l}</button>)}
      </div>
      <small className="muted">Launches move fast and many tokens have a buy tax: the slippage must be higher than the tax or the buy is refused (the test-run catches it, no gas spent). With MEV protection on, bots can&apos;t use a high slippage against you.</small>
    </section>
  );
}
