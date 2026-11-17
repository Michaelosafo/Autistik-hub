"use client";
/**
 * Copy desk (BNB Chain only): paste wallets to copy, add one or two of your own wallets (private keys) that buy with
 * their own BNB, and set the buy size and safety exits.
 */
import { useState } from "react";

export type CopyKeys = { bnbUsd: number; keys: { slot: number; address: string | null; bnb: number | null; usd?: number | null }[] };
type W = { address: string; chain?: string; label?: string; usd?: number; on?: boolean };
type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function CopyBsc({ s, keys, cfg, busy, act, set, sniper }: {
  s: { copy_wallets?: W[]; mode: string; copy_sl_on?: boolean; copy_tp_on?: boolean; copy_mev?: boolean; copy_gwei?: number; copy_slip?: number; copy_key_usd?: Record<string, number>; snipe_usd?: number }; keys: CopyKeys | null; cfg?: { usd: number; tp: number; sl: number } | null;
  busy: string; act: Act; set: (b: any, done?: string) => Promise<void>; sniper?: boolean;
}) {
  const [addr, setAddr] = useState(""), [label, setLabel] = useState(""), [err, setErr] = useState("");
  const [keyIn, setKeyIn] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(0);
  const reveal = async (slot: number) => {
    if (!confirm(`Show wallet ${slot}'s private key? Anyone who sees it can take the money. Use it to import the wallet into Bitget, MetaMask or Trust.`)) return;
    const r = await fetch(`/api/ai-futures/copy-key-reveal?desk=${sniper ? "liq" : "copy"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slot }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || "Couldn't show it."); return; }
    const copied = await navigator.clipboard?.writeText(j.key).then(() => true, () => false);
    prompt(`Wallet ${slot} private key${copied ? " (also copied, ready to paste)" : ""}. Keep it secret:`, j.key);
  };
  const all: W[] = s.copy_wallets || [];
  const ws = all.filter((w) => isAddr(w.address) && (!w.chain || w.chain === "bsc"));
  const dropped = all.length - ws.length;
  const save = (next: W[], done?: string) => set({ copy_wallets: next }, done);
  const bnbUsd = keys?.bnbUsd || 0;
  const per = cfg?.usd ?? 20;
  const mine = (keys?.keys || []).filter((k) => k.address);

  const add = () => {
    const a = addr.trim();
    if (!isAddr(a)) { setErr("Paste a BNB Chain address (0x followed by 40 letters / numbers)."); return; }
    if (ws.some((w) => w.address.toLowerCase() === a.toLowerCase())) { setErr("You're already copying that wallet."); return; }
    setErr(""); setAddr(""); setLabel("");
    save([...ws, { address: a, chain: "bsc", label: label.trim() || undefined, on: true }], `Copying ${label.trim() || short(a)} on BNB Chain. Its next buys are copied (older ones never are).`);
  };

  return (
    <section className="card stack">
      {!sniper && <>
      <b>🟡 Wallets to copy (BNB Chain)</b>
      <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" style={{ flex: "1 1 260px", fontFamily: "monospace" }} placeholder="Paste wallet address 0x…" value={addr} onChange={(e) => { setAddr(e.target.value); setErr(""); }} aria-label="Wallet address to copy" autoComplete="off" spellCheck={false} />
        <input className="input" style={{ flex: "0 1 140px" }} placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name for this wallet" maxLength={24} />
        <button type="submit" className="btn primary" disabled={!!busy || !addr.trim()}>Copy it</button>
      </form>
      {err && <small className="aic-warn" role="alert">{err}</small>}
      {!ws.length && <small className="muted">None yet. Paste a wallet: from then on, whenever it buys a coin on BNB Chain your wallets buy it too, and when it sells they sell.</small>}
      {ws.map((w) => (
        <div key={w.address} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="chip">{w.on === false ? "⏸" : "🟢"} {w.label || short(w.address)}{w.usd ? ` · $${w.usd}` : ""}</span>
          <a className="muted" href={`https://bscscan.com/address/${w.address}`} target="_blank" rel="noreferrer"><small>BscScan</small></a>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => save(ws.map((x) => (x === w ? { ...x, on: x.on === false } : x)))}>{w.on === false ? "Resume" : "Pause"}</button>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt(`$ per buy when copying ${w.label || short(w.address)} (empty = $${per}):`, w.usd ? String(w.usd) : ""); if (v != null) save(ws.map((x) => (x === w ? { ...x, usd: Number(v) > 0 ? Number(v) : undefined } : x))); }}>Amount</button>
          <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { if (confirm("Stop copying this wallet? Coins already bought from it stay open until the stop-loss / take profit, or until you close them.")) save(ws.filter((x) => x !== w)); }}>Remove</button>
        </div>
      ))}
      {dropped > 0 && <small className="muted">{dropped} older Solana / Ethereum wallet{dropped === 1 ? " is" : "s are"} no longer copied (Copy is BNB Chain only now). Saving any change clears {dropped === 1 ? "it" : "them"}.</small>}

      </>}
      <b style={{ marginTop: 8 }}>🔑 Your wallets that buy (up to 10)</b>
      {(keys?.keys || []).some((k) => !k.address) && (
        <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => {
          const free = (keys?.keys || []).filter((k) => !k.address).length;
          if (confirm(`Create ${free} new wallet${free === 1 ? "" : "s"} now, so you have all 10? Each one needs its own money (BNB / USDT on BNB Chain) to buy.`)) act("cfill", "copy-key-new", { count: free }, `Created ${free} wallet${free === 1 ? "" : "s"}. Fund each one to use it.`);
        }}>{busy === "cfill" ? "Creating…" : `＋ Create all ${(keys?.keys || []).filter((k) => !k.address).length} remaining wallets (up to 10)`}</button>
      )}
      <small className="muted">Each wallet you add buys every copied coin with its own money (USDT / USDC on BNB Chain, else BNB), so with 3 wallets each copy is bought 3 times. Keep a little BNB in each for gas. Keys are stored encrypted on the server and never shown on this page.</small>
      {(() => { const ks = keys?.keys || [{ slot: 1, address: null, bnb: null }]; const firstFree = ks.find((k) => !k.address)?.slot; return ks.filter((k) => k.address || k.slot === firstFree); })().map((k) => (
        <div key={k.slot} className="stack" style={{ gap: 4, padding: "8px 10px", border: "1px solid var(--line, rgba(127,127,127,.25))", borderRadius: 12 }}>
          <small><b>Wallet {k.slot}</b>{!k.address && mine.length ? <span className="muted"> (add another, optional)</span> : null}</small>
          {k.address ? (
            <>
              <code style={{ wordBreak: "break-all" }}>{k.address}</code>
              {(() => { const b = Number(k.bnb || 0), u = Number(k.usd || 0), tot = b * bnbUsd + u; return (
                <small className="muted">{k.bnb == null ? "–" : `${b.toFixed(4)} BNB`}{bnbUsd ? ` (≈ $${(b * bnbUsd).toFixed(2)})` : ""} · ${u.toFixed(2)} USDT/USDC · <b>≈ ${tot.toFixed(2)} in all</b>{b < 0.0006 ? " · needs ~0.0006 BNB for gas" : tot < per ? ` · less than a $${per} buy: it buys with what it has` : ""}</small>
              ); })()}
              {(() => {
                const amounts = s.copy_key_usd || {}, own = Number(amounts[String(k.slot)] || 0), normal = Number(s.snipe_usd || per);
                return (
                  <div className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <small>💵 <b>Buys: ${own > 0 ? own : normal}</b> <span className="muted">{own > 0 ? "(this wallet's own amount)" : "(the normal amount, same as the others)"}</span></small>
                    <button type="button" className="btn small" disabled={!!busy} onClick={() => {
                      const v = prompt(`$ wallet ${k.slot} spends on each buy. Leave empty to use the normal amount ($${normal}), the same as the others:`, own > 0 ? String(own) : "");
                      if (v == null) return;
                      const next = { ...amounts };
                      if (Number(v) > 0) next[String(k.slot)] = Number(v); else delete next[String(k.slot)];
                      set({ copy_key_usd: next }, Number(v) > 0 ? `Wallet ${k.slot} now buys $${Number(v)} each time.` : `Wallet ${k.slot} buys the normal amount ($${normal}).`);
                    }}>Set amount</button>
                  </div>
                );
              })()}
              <small className="muted">To fund it: send USDT, USDC or BNB on <b>BNB Chain (BEP20)</b> to the address above, plus a little BNB (~0.001) for gas. It buys with USDT / USDC first, else BNB, and sells back into the same.</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="btn small" onClick={() => { navigator.clipboard?.writeText(k.address!).then(() => setCopied(k.slot), () => {}); setTimeout(() => setCopied(0), 1500); }}>{copied === k.slot ? "Copied ✓" : "Copy address"}</button>
                <a className="btn small ghost" href={`https://bscscan.com/address/${k.address}`} target="_blank" rel="noreferrer">BscScan</a>
                <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => reveal(k.slot)}>Show private key</button>
                <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { if (confirm(`Remove wallet ${k.slot} from Copy? The wallet and its money stay yours; Copy just stops buying with it.`)) act(`ck${k.slot}`, "copy-key-remove", { slot: k.slot }); }}>Remove</button>
              </div>
            </>
          ) : (
            <>
            <button type="button" className="btn primary" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={() => act(`cn${k.slot}`, "copy-key-new", { slot: k.slot })}>{busy === `cn${k.slot}` ? "Creating…" : "＋ Create new wallet"}</button>
            <small className="muted">Makes a fresh BNB Chain wallet just for Copy; you fund it with BNB. Or paste the private key of a wallet you already have:</small>
            <form className="row" style={{ gap: 6, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); const v = (keyIn[k.slot] || "").trim(); if (!v) return; setKeyIn({ ...keyIn, [k.slot]: "" }); act(`ck${k.slot}`, "copy-key-set", { slot: k.slot, key: v }); }}>
              <input className="input" type="password" style={{ flex: "1 1 260px", fontFamily: "monospace" }} placeholder="Paste private key" value={keyIn[k.slot] || ""} onChange={(e) => setKeyIn({ ...keyIn, [k.slot]: e.target.value })} aria-label={`Private key for wallet ${k.slot}`} autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn small" disabled={!!busy || !(keyIn[k.slot] || "").trim()}>Add wallet {k.slot}</button>
            </form>
            </>
          )}
        </div>
      ))}
      {s.mode !== "live" && <small className="muted">Practice mode: buys are pretend (real prices). Switch to Live (top of the page) once {mine.length ? "your wallet holds BNB" : "you've created or added a wallet and sent it BNB"}.</small>}

      <b style={{ marginTop: 8 }}>⚡ Speed and bot protection</b>
      <small className="muted">{sniper ? "Gas speed decides who lands first in the block when liquidity arrives: Turbo or Max for hot launches." : "Copy watches the wallets live: their trade is seen the moment its block lands (under a second), and your buy is sent straight away."}</small>
      <label className="ait-check" style={{ margin: 0 }}>
        <input type="checkbox" checked={s.copy_mev !== false} disabled={!!busy} onChange={(e) => set({ copy_mev: e.target.checked }, e.target.checked ? "MEV protection on: buys and sells go through PancakeSwap MEV Guard, hidden from sandwich bots." : "MEV protection off: trades go to the public mempool.")} />
        <span>🛡 MEV bot protection <small className="muted">(sends through PancakeSwap MEV Guard, a private route: sandwich bots can&apos;t see or front-run your trade)</small></span>
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <small><b>Gas speed:</b></small>
        {([["Normal", 0.1], ["Fast", 0.3], ["Turbo", 1], ["Max", 3]] as const).map(([l, g]) => {
          const on = Math.abs(Number(s.copy_gwei ?? 0.3) - g) < 1e-9;
          return <button key={l} type="button" className={"btn small" + (on ? " primary" : " ghost")} disabled={!!busy || on} onClick={() => set({ copy_gwei: g }, `Gas speed ${l} (${g} gwei, about $${(g * 250_000 * 1e-9 * (bnbUsd || 600)).toFixed(2)} a swap).`)}>{l}</button>;
        })}
        <small className="muted">{Number(s.copy_gwei ?? 0.3)} gwei ≈ ${(Number(s.copy_gwei ?? 0.3) * 250_000 * 1e-9 * (bnbUsd || 600)).toFixed(2)} a swap. Higher lands first in the block.</small>
      </div>
      {!sniper && <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <small><b>Max slippage:</b> {Number(s.copy_slip ?? 12)}%</small>
        {[5, 8, 12, 15].map((v) => <button key={v} type="button" className={"btn small" + (Number(s.copy_slip ?? 12) === v ? " primary" : " ghost")} disabled={!!busy || Number(s.copy_slip ?? 12) === v} onClick={() => set({ copy_slip: v }, `Max slippage ${v}%.`)}>{v}%</button>)}
        <small className="muted">Higher fills on fast-moving coins; with MEV protection on, bots can&apos;t use it against you.</small>
      </div>}

      {!sniper && <>
      <b style={{ marginTop: 8 }}>💵 Each buy</b>
      {([["copy_sl_on", "Automatic stop-loss", s.copy_sl_on !== false, `sells by itself at -${cfg?.sl ?? 50}%`], ["copy_tp_on", "Automatic take profit", s.copy_tp_on !== false, `sells by itself at +${cfg?.tp ?? 100}%`]] as const).map(([k, l, on, hint]) => (
        <label key={k} className="ait-check" style={{ margin: 0 }}>
          <input type="checkbox" checked={on} disabled={!!busy} onChange={(e) => set({ [k]: e.target.checked }, e.target.checked ? `${l} on: ${hint}. Applied to open trades too.` : `${l} off: you decide when to sell (Sell buttons on each trade). Applied to open trades too.`)} />
          <span>{l} <small className="muted">{on ? `(${hint})` : "(off: you sell yourself)"}</small></span>
        </label>
      ))}
      {([["snipe_usd", "Buy", "$ per coin, per wallet", cfg?.usd], ...(s.copy_tp_on !== false ? [["snipe_tp", "Take profit at", "% up", cfg?.tp]] : []), ...(s.copy_sl_on !== false ? [["snipe_sl", "Stop-loss at", "% down", cfg?.sl]] : [])] as [string, string, string, number | undefined][]).map(([k, l, unit, v]) => (
        <div key={k} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <small><b>{l}:</b> {String(v ?? "")} {unit}{k === "snipe_usd" && bnbUsd && v ? <span className="muted"> (≈ {(Number(v) / bnbUsd).toFixed(4)} BNB)</span> : null}</small>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => { const x = prompt(`${l} (${unit}):`, String(v ?? "")); if (x != null && isFinite(Number(x)) && Number(x) > 0) set({ [k]: Number(x) }); }}>Change</button>
        </div>
      ))}
      </>}
    </section>
  );
}

export type CopyPos = { id: number; coin: string; why: string | null; entry: number; price?: number | null; last: number | null; upnl?: number | null; stop: number; target: number; notional_usd: number; mode: string; venue: string; opened_at: string; copy_slot?: number | null; status: string };
const money = (x: number | null | undefined) => (x == null || !isFinite(x) ? "–" : `${x < 0 ? "-" : ""}$${Math.abs(x).toFixed(2)}`);
const price = (x: number | null | undefined) => (x == null || !isFinite(x) || x <= 0 ? "–" : `$${x >= 1 ? x.toFixed(4) : x.toPrecision(4)}`);
const since = (iso: string) => { const t = (Date.now() - Date.parse(iso)) / 1000; return t < 60 ? "just now" : t < 3600 ? `${Math.floor(t / 60)}m ago` : t < 86400 ? `${Math.floor(t / 3600)}h ago` : `${Math.floor(t / 86400)}d ago`; };

/** Every open copy trade, with Sell and your own stop-loss / take profit. Shown at the top as soon as something is bought. */
export function CopyTrades({ list, busy, act }: { list: CopyPos[]; busy: string; act: Act }) {
  const open = list.filter((p) => p.venue === "copy");
  const ask = (label: string, now: number, cur: number, below: boolean) => {
    const v = prompt(`${label}: type a price, or a % from now (e.g. ${below ? "10%" : "50%"}). Type 0 for none. Now ${price(now)}, current ${cur > 0 ? price(cur) : "none"}.`, cur > 0 ? String(+cur.toPrecision(6)) : "");
    if (v == null || !v.trim()) return null;
    const t = v.trim();
    if (t === "0") return 0;
    const pc = /%$/.test(t) ? Number(t.slice(0, -1)) : NaN;
    const x = isFinite(pc) ? now * (below ? 1 - pc / 100 : 1 + pc / 100) : Number(t);
    return isFinite(x) && x >= 0 ? x : null;
  };
  return (
    <section className="card stack">
      <b>📈 Your copy trades {open.length ? <small className="muted">({open.length} open)</small> : null}</b>
      {!open.length && <small className="muted">Nothing bought yet. When a wallet you copy buys, the trade shows here with Sell and stop-loss buttons.</small>}
      {open.map((p) => {
        const now = Number(p.price || p.last || p.entry);
        const pct = p.entry ? (now / p.entry - 1) * 100 : 0;
        const pnl = p.upnl ?? p.notional_usd * (pct / 100);
        const name = p.why?.split(":")[0] || p.coin.slice(4, 12);
        const token = p.coin.replace(/^bsc:/, "");
        const b = (k: string) => busy === `${k}${p.id}`;
        return (
          <div key={p.id} className="stack" style={{ gap: 6, padding: "10px 12px", borderRadius: 14, border: "1px solid var(--line, rgba(127,127,127,.25))" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <b>{name}{p.copy_slot ? <small className="muted"> · wallet {p.copy_slot}</small> : null}{p.mode !== "live" ? <small className="muted"> · practice</small> : null}</b>
              <b className={pnl >= 0 ? "up" : "down"}>{pnl >= 0 ? "▲" : "▼"} {money(pnl)} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</b>
            </div>
            <small className="muted">Bought {money(p.notional_usd)} at {price(p.entry)} · now {price(now)} · {since(p.opened_at)} · <a href={`https://dexscreener.com/bsc/${token}`} target="_blank" rel="noreferrer">chart</a></small>
            <small>🛑 Stop-loss: <b>{p.stop > 0 ? `${price(p.stop)} (${((p.stop / now - 1) * 100).toFixed(1)}%)` : "off"}</b> · 🎯 Take profit: <b>{p.target > 0 ? `${price(p.target)} (+${((p.target / now - 1) * 100).toFixed(1)}%)` : "off"}</b></small>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn small primary" disabled={!!busy} onClick={() => { if (confirm(`Sell all of ${name} now?`)) act(`sa${p.id}`, "copy-sell", { id: p.id, frac: 1 }); }}>{b("sa") ? "Selling…" : "Sell all"}</button>
              <button type="button" className="btn small" disabled={!!busy} onClick={() => { if (confirm(`Sell half of ${name} now?`)) act(`sh${p.id}`, "copy-sell", { id: p.id, frac: 0.5 }); }}>{b("sh") ? "Selling…" : "Sell 50%"}</button>
              <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { const x = ask(`Stop-loss for ${name} (sells if the price falls to it)`, now, p.stop, true); if (x != null) act(`ss${p.id}`, "copy-exits", { id: p.id, stop: x }); }}>{b("ss") ? "Saving…" : p.stop > 0 ? "Change stop-loss" : "Set stop-loss"}</button>
              <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { const x = ask(`Take profit for ${name} (sells if the price rises to it)`, now, p.target, false); if (x != null) act(`st${p.id}`, "copy-exits", { id: p.id, target: x }); }}>{b("st") ? "Saving…" : p.target > 0 ? "Change take profit" : "Set take profit"}</button>
              {p.stop > 0 && <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => act(`so${p.id}`, "copy-exits", { id: p.id, stop: 0 }, `${name}: stop-loss off.`)}>Stop-loss off</button>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
