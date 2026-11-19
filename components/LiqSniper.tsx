"use client";
/**
 * Sniper: paste a token address. The chain is detected (Solana mint, or which EVM chain has the contract).
 * The buy is in that chain's coin, from each wallet's address on that chain.
 */
import { useEffect, useState } from "react";

type Target = { token: string; chain?: string; pay?: string; amount?: number; prio?: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[]; fired?: number[]; first_at?: string };
type S = { liq_targets?: Target[]; liq_x?: number; liq_sell_pct?: number; liq_slip?: number; liq_tp_on?: boolean; snipe_usd?: number; copy_key_usd?: Record<string, number>; enabled: boolean; mode: string; last_note?: string | null };
type Hit = { id: string; name: string; symbol: string; hasCode: boolean; hasPool: boolean; liquidityUsd: number };
type Ready = { slot: number; address: string | null; balance: number | null; unit: string; need: number; ok: boolean; reason: string };
const short = (a: string) => a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 4)}…${a.slice(-4)}`;
const EXPL: Record<string, string> = { bsc: "https://bscscan.com/token/", ethereum: "https://etherscan.io/token/", base: "https://basescan.org/token/", arbitrum: "https://arbiscan.io/token/", solana: "https://solscan.io/token/" };

async function ask<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/ai-futures/${action}?desk=liq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

export default function LiqSniper({ s, busy, set, slots }: { s: S; busy: string; set: (b: any, done?: string) => Promise<void>; slots: number[] }) {
  const [ca, setCa] = useState(""), [label, setLabel] = useState(""), [amt, setAmt] = useState(""), [err, setErr] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [chain, setChain] = useState("");
  const [pay, setPay] = useState<"native" | "usdt" | "usdc">("native");
  const [prio, setPrio] = useState<"low" | "med" | "high" | "max">("high");
  const [ready, setReady] = useState<Ready[]>([]);
  const [making, setMaking] = useState(0);
  const [checking, setChecking] = useState(false);
  const [noFundsOpen, setNoFundsOpen] = useState(false);
  const [reload, setReload] = useState(0);
  // Wallets picked for the token being added (empty = all).
  // Wallets for the token being added: null = not chosen yet (required when you have more than one), "all", or a list.
  const [pick, setPick] = useState<number[] | "all" | null>(null);
  const pickList = Array.isArray(pick) ? pick : [];
  const [editing, setEditing] = useState<string | null>(null);
  const who = (w?: number[]) => (w && w.length && w.length < slots.length ? `wallet ${w.map((x) => `#${x}`).join(" + ")}` : "all wallets");
  const toggle = (list: number[], x: number) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x].sort((a, b) => a - b));
  const list = s.liq_targets || [];
  const save = (next: Target[], done?: string) => set({ liq_targets: next }, done);
  const per = Number(s.snipe_usd || 5), x = Number(s.liq_x || 2), pct = Number(s.liq_sell_pct || 100), slip = Number(s.liq_slip || 20), tp = s.liq_tp_on !== false;
  // Each wallet's own $ per snipe (the same amounts as on the wallet cards below); none = the normal amount.
  const typed = Number(amt) > 0 ? Number(amt) : 0;
  const hit = hits.find((h) => h.id === chain) || hits[0];
  const unit = pay === "native" ? (hit?.symbol || "BNB") : pay.toUpperCase();
  const pays = (id: string) => id === "base" ? ["native", "usdc"] as const : ["native", "usdt", "usdc"] as const;

  useEffect(() => {
    const raw = ca.trim();
    if (raw.length < 32) { setHits([]); setChain(""); setChecking(false); setReady([]); return; }
    setChecking(true);
    const t = setTimeout(() => {
      ask<{ hits: Hit[]; suggested: string | null }>("sniper-detect", { token: raw }).then((d) => {
        const next = d.hits || [];
        setHits(next);
        setChain((cur) => {
          if (cur && next.some((h) => h.id === cur)) return cur;
          const suggested = d.suggested || "";
          if (suggested !== cur) { setPay("native"); setPick(null); }
          return suggested;
        });
      }).catch(() => { setHits([]); setChain(""); }).finally(() => setChecking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [ca]);

  useEffect(() => {
    if (!chain) { setReady([]); return; }
    let gone = false;
    ask<{ wallets: Ready[] }>("sniper-ready", { chain, pay, amount: typed, slots }).then((d) => {
      if (gone) return;
      const wallets = d.wallets || [];
      setReady(wallets);
      const funded = wallets.filter((w) => w.address && (typed > 0 ? w.ok : (w.balance || 0) > 0)).map((w) => w.slot);
      setPick((cur) => {
        if (funded.length === 1) return funded;
        if (Array.isArray(cur)) { const keep = cur.filter((s) => funded.includes(s)); return keep.length ? keep : null; }
        return null;
      });
    }).catch(() => {});
    return () => { gone = true; };
  }, [chain, pay, typed, slots.join(","), reload]);

  const add = () => {
    const m = ca.trim().match(/0x[0-9a-fA-F]{40}/);
    const sol = !m && ca.trim().match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
    const a = m ? m[0] : sol ? sol[0] : "";
    if (!a || !chain) { setErr("Paste a token address. We'll detect the chain (a Solana mint, or an 0x contract)."); return; }
    const dup = (t: string) => t.startsWith("0x") ? t.toLowerCase() === a.toLowerCase() : t === a;
    if (list.some((t) => dup(t.token))) { setErr("That token is already on the list."); return; }
    if (pickList.length === 0) { setErr("Tick the wallets that should buy it."); return; }
    if (!(typed > 0)) { setErr(`Type how much ${unit} each wallet spends.`); return; }
    setErr(""); setCa(""); setLabel(""); setAmt(""); setHits([]); setChain("");
    const w = [...pickList];
    setPick(null);
    const where = hit?.name || chain;
    save([...list, { token: a, chain, pay, amount: typed, prio: chain === "solana" ? prio : undefined, label: label.trim() || undefined, on: true, state: "waiting", added: new Date().toISOString(), wallets: w }],
      `Waiting on ${where} for ${label.trim() || short(a)} with ${who(w)}. Each wallet spends ${typed} ${unit}${s.enabled ? "" : " (press ▶ START)"}.`);
  };

  const funded = ready.filter((w) => w.address && (typed > 0 ? w.ok : (w.balance || 0) > 0));
  const broke = ready.filter((w) => w.address && !funded.some((f) => f.slot === w.slot));
  const missing = ready.filter((w) => !w.address);

  async function makeSol(slot: number) {
    setMaking(slot); setErr("");
    try { await ask("sniper-sol-create", { slot }); setReload((n) => n + 1); }
    catch (e) { setErr((e as Error).message); }
    finally { setMaking(0); }
  }

  return (
    <section className="card stack">
      <b>🎯 Tokens to snipe</b>
      <small className="muted">Paste a token address. The chain is detected on its own, and the wallets below switch to that chain.</small>
      <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" style={{ fontFamily: "monospace" }} placeholder="Paste a token address (0x… or a Solana mint)" value={ca} onChange={(e) => { setCa(e.target.value); setErr(""); }} aria-label="Token address" autoComplete="off" spellCheck={false} />
        {(checking || hit) && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {checking && !hit && <span className="chip">Checking chain…</span>}
            {hit && <span className="chip" style={{ fontWeight: 700 }}>{hit.name}{hit.hasPool ? " · pool" : hit.hasCode ? " · contract" : ""}</span>}
            {hits.length > 1 && hits.map((h) => (
              <button key={h.id} type="button" className={"btn small" + (chain === h.id ? " primary" : " ghost")} onClick={() => { setChain(h.id); setPay("native"); setPick(null); }}>{h.name}</button>
            ))}
          </div>
        )}
        {!checking && ca.trim().length >= 32 && hits.length === 0 && <small className="aic-warn">No contract found on BNB Chain, Ethereum, Base, Arbitrum, or Solana.</small>}
        {hit && (
          <>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <small><b>Pay with:</b></small>
              {pays(chain).map((p) => <button key={p} type="button" className={"btn small" + (pay === p ? " primary" : " ghost")} onClick={() => setPay(p)}>{p === "native" ? hit.symbol : p.toUpperCase()}</button>)}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" style={{ flex: "1 1 120px" }} placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} aria-label="Name" />
              <input className="input" style={{ flex: "0 1 140px" }} inputMode="decimal" placeholder={unit} value={amt} onChange={(e) => setAmt(e.target.value)} aria-label={`Amount in ${unit}`} />
              <small><b>{unit}</b> each</small>
            </div>
            {chain === "solana" && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Priority fee:</b></small>
                {(["low", "med", "high", "max"] as const).map((p) => <button key={p} type="button" className={"btn small" + (prio === p ? " primary" : " ghost")} onClick={() => setPrio(p)}>{p}</button>)}
              </div>
            )}
            <div className="stack" style={{ gap: 4 }}>
              <small><b>Wallets on {hit.name}</b></small>
              {funded.length === 0 && broke.length === 0 && missing.length === 0 && <small className="muted">Reading balances…</small>}
              {funded.map((w) => (
                <button key={w.slot} type="button" className={"btn small" + (pickList.includes(w.slot) ? " primary" : " ghost")} style={{ justifyContent: "flex-start" }} onClick={() => { const next = toggle(pickList, w.slot); setPick(next.length ? next : null); }} aria-pressed={pickList.includes(w.slot)}>
                  #{w.slot} · {(w.balance ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })} {w.unit}{w.address ? ` · ${short(w.address)}` : ""}
                </button>
              ))}
              {funded.length > 1 && <button type="button" className="btn small ghost" onClick={() => setPick(pickList.length === funded.length ? null : funded.map((w) => w.slot))}>{pickList.length === funded.length ? "Clear" : "Tick all with funds"}</button>}
              {(broke.length > 0 || missing.length > 0) && (
                <div>
                  <button type="button" className="btn small ghost" onClick={() => setNoFundsOpen((v) => !v)}>{noFundsOpen ? "Hide" : "No funds"} ({broke.length + missing.length})</button>
                  {noFundsOpen && (
                    <div className="stack" style={{ gap: 4, opacity: 0.7, marginTop: 4 }}>
                      {broke.map((w) => <small key={w.slot}>#{w.slot} · {(w.balance ?? 0).toLocaleString("en-US", { maximumFractionDigits: 4 })} {w.unit} · {w.reason}</small>)}
                      {missing.map((w) => (
                        <div key={w.slot} className="row" style={{ gap: 6, alignItems: "center" }}>
                          <small>#{w.slot} · {w.reason}</small>
                          {chain === "solana" && <button type="button" className="btn small" disabled={!!busy || making === w.slot} onClick={() => makeSol(w.slot)}>{making === w.slot ? "Creating…" : "Add Solana address"}</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button type="submit" className="btn primary" disabled={!!busy || !chain || pickList.length === 0 || !(typed > 0)}>{pickList.length ? `Snipe with ${pickList.map((x) => `#${x}`).join(" + ")} · ${typed || "…"} ${unit}` : "Tick a wallet with funds"}</button>
          </>
        )}
      </form>
      {err && <small className="aic-warn" role="alert">{err}</small>}
      {!list.length && <small className="muted">No tokens yet.</small>}
      {list.map((t) => {
        const st = t.state || "waiting";
        // Some picked wallets already bought, the rest are still trying.
        const part = st === "waiting" && (t.fired || []).length ? ` · ✅ ${t.fired!.map((x) => `#${x}`).join(" + ")} bought, rest trying` : "";
        return (
          <div key={t.token} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="chip">{st === "done" ? "✅ Bought" : st === "failed" ? "⚠ Stopped" : t.on === false ? "⏸ Paused" : s.enabled ? "⏳ Waiting" : "⏹ Stopped"} · {t.chain === "solana" ? "Solana" : t.chain === "ethereum" ? "Ethereum" : t.chain === "base" ? "Base" : t.chain === "arbitrum" ? "Arbitrum" : "BNB Chain"} · {t.label || short(t.token)}{t.amount ? ` · ${t.amount} ${t.pay === "usdt" ? "USDT" : t.pay === "usdc" ? "USDC" : t.chain === "solana" ? "SOL" : t.chain === "bsc" || !t.chain ? "BNB" : "ETH"}` : t.usd ? ` · $${t.usd}` : ""} · {who(t.wallets)}{part}</span>
            {slots.length > 1 && <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => setEditing(editing === t.token ? null : t.token)}>Wallets</button>}
            <a className="muted" href={`${EXPL[t.chain || "bsc"] || EXPL.bsc}${t.token}`} target="_blank" rel="noreferrer"><small>Explorer</small></a>
            {st === "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => save(list.map((x) => (x === t ? { ...x, on: x.on === false } : x)))}>{t.on === false ? "Resume" : "Pause"}</button>}
            {st !== "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => { if (confirm(`Arm ${t.label || short(t.token)} again? It will buy again if it can be bought.`)) save(list.map((x) => (x === t ? { ...x, state: "waiting", on: true, fired: undefined, first_at: undefined } : x))); }}>Arm again</button>}
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
