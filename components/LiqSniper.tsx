"use client";
/**
 * BSC Sniper: the tokens to snipe (paste contract addresses before launch) and when to sell.
 * Wallets, gas speed, MEV protection and the trades card are Copy's (shared component).
 */
import { useState } from "react";

type Target = { token: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[] };
type S = { liq_targets?: Target[]; liq_x?: number; liq_sell_pct?: number; liq_slip?: number; liq_tp_on?: boolean; snipe_usd?: number; copy_key_usd?: Record<string, number>; enabled: boolean; mode: string; last_note?: string | null };
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function LiqSniper({ s, busy, set, slots }: { s: S; busy: string; set: (b: any, done?: string) => Promise<void>; slots: number[] }) {
  const [ca, setCa] = useState(""), [label, setLabel] = useState(""), [amt, setAmt] = useState(""), [err, setErr] = useState("");
  // Wallets picked for the token being added (empty = all).
  // Wallets for the token being added: null = not chosen yet (required when you have more than one), "all", or a list.
  const [pick, setPick] = useState<number[] | "all" | null>(null);
  const needPick = slots.length > 1 && pick === null;
  const pickList = Array.isArray(pick) ? pick : [];
  const [editing, setEditing] = useState<string | null>(null);
  const who = (w?: number[]) => (w && w.length && w.length < slots.length ? `wallet ${w.map((x) => `#${x}`).join(" + ")}` : "all wallets");
  const toggle = (list: number[], x: number) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x].sort((a, b) => a - b));
  const list = s.liq_targets || [];
  const save = (next: Target[], done?: string) => set({ liq_targets: next }, done);
  const per = Number(s.snipe_usd || 5), x = Number(s.liq_x || 2), pct = Number(s.liq_sell_pct || 100), slip = Number(s.liq_slip || 20), tp = s.liq_tp_on !== false;
  // Each wallet's own $ per snipe (the same amounts as on the wallet cards below); none = the normal amount.
  const amounts = s.copy_key_usd || {};
  const own = (w: number) => Number(amounts[String(w)] || 0);
  const amtOf = (w: number) => (own(w) > 0 ? own(w) : per);
  const setOwn = (w: number) => {
    const v = prompt(`$ wallet #${w} spends on each snipe. Leave empty to use the normal amount ($${per}):`, own(w) > 0 ? String(own(w)) : "");
    if (v == null) return;
    const next = { ...amounts };
    if (Number(v) >= 0.5) next[String(w)] = Number(v); else delete next[String(w)];
    set({ copy_key_usd: next }, Number(v) >= 0.5 ? `Wallet #${w} now snipes $${Number(v)} each time.` : `Wallet #${w} snipes the normal amount ($${per}).`);
  };
  const typed = Number(amt) > 0 ? Number(amt) : 0;
  // The wallets that will buy the token being added: the ones tapped, or all.
  const shown = slots.length <= 1 ? slots : pick === "all" ? slots : pickList;

  const add = () => {
    const m = ca.trim().match(/0x[0-9a-fA-F]{40}/); // pasted links (BscScan, DexScreener…) work too
    const a = m ? m[0] : "";
    if (!isAddr(a)) { setErr("Paste the token's contract address (0x followed by 40 letters / numbers)."); return; }
    if (list.some((t) => t.token.toLowerCase() === a.toLowerCase())) { setErr("That token is already on the list."); return; }
    if (needPick) { setErr("Choose which wallet(s) snipe this token first (tap #1, #2… or All)."); return; }
    const usd = Number(amt);
    setErr(""); setCa(""); setLabel(""); setAmt("");
    const w = pickList.length && pickList.length < slots.length ? [...pickList] : undefined;
    setPick(null); // every new token gets its own choice
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
          <input className="input" style={{ flex: "0 1 130px" }} inputMode="decimal" placeholder="$ (optional)" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Dollars per wallet for this token only (optional)" />
          <button type="submit" className="btn primary" disabled={!!busy || !ca.trim() || needPick}>{needPick ? "Choose wallet(s) below" : `Snipe it${slots.length > 1 ? ` with ${pick === "all" ? "all wallets" : pickList.map((x) => `#${x}`).join(" + ")}` : ""}`}</button>
        </div>
        {slots.length > 1 && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <small><b>Which wallet snipes it:</b></small>
            {slots.map((x) => <button key={x} type="button" className={"btn small" + (pickList.includes(x) ? " primary" : " ghost")} onClick={() => { const next = toggle(pickList, x); setPick(next.length ? next : null); }} aria-pressed={pickList.includes(x)}>#{x} · ${typed || amtOf(x)}</button>)}
            <button type="button" className={"btn small" + (pick === "all" ? " primary" : " ghost")} onClick={() => setPick(pick === "all" ? null : "all")} aria-pressed={pick === "all"}>All</button>
            <small className={needPick ? "aic-warn" : "muted"}>{needPick ? "tap the wallet(s) for this token" : pick === "all" ? "every wallet" : `only ${pickList.map((x) => `#${x}`).join(" + ")}`}</small>
          </div>
        )}
        {shown.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            {typed > 0
              ? <small className="muted">This token only: each wallet buys <b>${typed}</b> (clear the $ box to use each wallet&apos;s own amount).</small>
              : <>
                  {shown.map((w) => (
                    <div key={w} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <small>💵 Wallet #{w} buys <b>${amtOf(w)}</b> <span className="muted">{own(w) > 0 ? "(its own amount)" : "(normal amount)"}</span></small>
                      <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => setOwn(w)}>Change</button>
                    </div>
                  ))}
                  <small className="muted">Total for this token: ${+shown.reduce((a, w) => a + amtOf(w), 0).toFixed(2)}. Saved per wallet, so you set it once.</small>
                </>}
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
                {(() => {
                  const cur = t.wallets && t.wallets.length && t.wallets.length < slots.length ? t.wallets : []; // [] = all
                  const put = (next: number[]) => { const w = next.length && next.length < slots.length ? next : undefined; save(list.map((y) => (y === t ? { ...y, wallets: w } : y)), `${t.label || short(t.token)}: ${who(w)}.`); };
                  return <>
                    <button type="button" className={"btn small" + (cur.length === 0 ? " primary" : " ghost")} disabled={!!busy || cur.length === 0} onClick={() => put([])}>All</button>
                    {slots.map((x) => {
                      const on = cur.includes(x);
                      // From "All", a tap means only that wallet; after that, taps add / drop wallets (never none).
                      return <button key={x} type="button" className={"btn small" + (on ? " primary" : " ghost")} disabled={!!busy || (on && cur.length === 1)} onClick={() => put(cur.length === 0 ? [x] : toggle(cur, x))}>#{x}</button>;
                    })}
                  </>;
                })()}
              </div>
            )}
          </div>
        );
      })}
      {s.enabled && s.last_note ? <small className="muted">Now: {s.last_note}</small> : null}

      <b style={{ marginTop: 8 }}>💰 Buy and sell</b>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <small><b>Normal buy:</b> ${per} per wallet <span className="muted">(for wallets without their own amount)</span></small>
        <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt("$ a wallet spends per snipe when it has no amount of its own (paid in USDT if the wallet holds enough, else BNB):", String(per)); if (v != null && Number(v) >= 0.5) set({ snipe_usd: Number(v) }); }}>Change</button>
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
