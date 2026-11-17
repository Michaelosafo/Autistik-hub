"use client";
/**
 * Lobby: connect your wallet, add BNB to the Lobby wallet, paste a token, and it buys the moment liquidity lands on
 * PancakeSwap, then sells at the X you picked. While this page is open it keeps the watcher running; when it's closed
 * the minute job does. See lib/lobby.ts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, parseEther } from "viem";
import { bsc } from "viem/chains";
import { pickWallet } from "@/lib/connect";

type Snipe = {
  id: number; token: string; symbol: string | null; name: string | null; status: string; buy_bnb: number; take_x: number; stop_pct: number | null;
  max_slip: number; speed: string; slip_used: number | null; gas_gwei: number | null; last_x: number | null; peak_x: number | null;
  out_bnb: number | null; buy_tx: string | null; sell_tx: string | null; note: string | null; sell_tax: number | null; buy_tax: number | null;
  honeypot: boolean | null; log: { at: string; m: string }[]; created_at: string;
};
type Status = { address: string | null; bnb: number | null; bnbUsd: number; snipes: Snipe[]; gasKeep: number };

const XS = [1.5, 2, 3, 5, 10, 20];
const SPEEDS: [string, string][] = [["fast", "Fast · 1 gwei"], ["faster", "Faster · 3 gwei"], ["fastest", "Fastest · 10 gwei"]];
const LIVE = ["watching", "buying", "holding", "selling"];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const COLOR: Record<string, string> = { watching: "#3b82f6", buying: "#eab308", holding: "#10b981", selling: "#eab308", sold: "#a855f7", failed: "#ef4444", cancelled: "#6b7280" };

async function api(path: string, body?: unknown) {
  const r = await fetch(`/api/lobby/${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

export default function Lobby() {
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [me, setMe] = useState<string | null>(null);
  const [fund, setFund] = useState("0.1");
  const [token, setToken] = useState("");
  const [buy, setBuy] = useState("0.05");
  const [x, setX] = useState(2);
  const [customX, setCustomX] = useState("");
  const [stop, setStop] = useState("");
  const [speed, setSpeed] = useState("faster");
  const [maxSlip, setMaxSlip] = useState("25");
  const [minLiq, setMinLiq] = useState("0.5");
  const [maxTax, setMaxTax] = useState("30");
  const [more, setMore] = useState(false);
  const watching = useRef(false);

  const load = useCallback(() => api("status").then(setSt).catch((e) => setMsg(e.message)), []);
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [load]);

  // Keep the watcher running while this page is open and something is waiting or held.
  const active = !!st?.snipes.some((s) => LIVE.includes(s.status));
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const tick = async () => {
      if (stop || watching.current) return;
      watching.current = true;
      try { await api("watch", {}); } catch { /* the minute job keeps going */ } finally { watching.current = false; }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [active]);

  async function act(label: string, f: () => Promise<any>) {
    setBusy(label); setMsg("");
    try { const r = await f(); if (r?.note) setMsg(r.note); await load(); }
    catch (e: any) { const m = String(e?.shortMessage || e?.message || e); setMsg(/rejected|denied|cancel/i.test(m) ? "You cancelled in your wallet." : m); }
    finally { setBusy(""); }
  }

  async function connect() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const w = createWalletClient({ chain: bsc, transport: custom(eth) }) as any;
    const [acc] = await w.requestAddresses();
    try { await w.switchChain({ id: 56 }); } catch { await w.addChain({ chain: bsc }); await w.switchChain({ id: 56 }); }
    setMe(acc);
    return { w, acc };
  }

  const addFunds = () => act("fund", async () => {
    if (!st?.address) throw new Error("Create the Lobby wallet first.");
    const v = Number(fund);
    if (!(v > 0)) throw new Error("Type how much BNB to add.");
    const { w, acc } = await connect();
    setMsg("Confirm in your wallet…");
    const hash = await w.sendTransaction({ account: acc, chain: bsc, to: st.address, value: parseEther(String(v)) });
    return { note: `Sent ${v} BNB (tx ${hash.slice(0, 10)}…). It shows here in a few seconds.` };
  });

  const withdraw = (all: boolean) => act("withdraw", async () => {
    const to = me || (await connect()).acc;
    return api("withdraw", { to, amount: all ? "max" : Number(fund) });
  });

  const snipe = () => act("snipe", () => api("snipe", {
    token: token.trim(), buy_bnb: Number(buy), take_x: Number(customX) || x, stop_pct: stop ? Number(stop) : null,
    speed, max_slip: Number(maxSlip), min_liq_bnb: Number(minLiq), max_sell_tax: Number(maxTax),
  }).then((r) => { setToken(""); return r; }));

  const usd = (bnb: number | null | undefined) => (bnb != null && st?.bnbUsd ? ` ≈ $${(bnb * st.bnbUsd).toFixed(2)}` : "");
  const target = Number(customX) || x;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">Admin · live BNB Chain · high risk</div>
        <h1>Lobby</h1>
        <p className="muted">Paste a token. The Lobby watches its PancakeSwap pool several times a second, buys the moment liquidity is added, then sells everything at the X you pick.</p>
      </div>
      {msg && <div className="notice">{msg}</div>}

      <div className="grid2">
        <div className="card stack">
          <h2>Lobby wallet</h2>
          {!st ? <p className="muted">Loading…</p> : !st.address ? (
            <>
              <p className="muted">The Lobby buys from its own wallet so it can act in a split second without asking you to confirm. Fund it with only what you're ready to risk.</p>
              <button className="btn primary" disabled={!!busy} onClick={() => act("wallet", () => api("wallet", {}))}>Create Lobby wallet</button>
            </>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="mono">{short(st.address)}</span>
                <button className="btn small" onClick={() => navigator.clipboard.writeText(st.address!).then(() => setMsg("Address copied."))}>Copy</button>
              </div>
              <div><b style={{ fontSize: "1.6em" }}>{st.bnb == null ? "…" : st.bnb.toFixed(4)} BNB</b><span className="muted">{usd(st.bnb)}</span></div>
              <div className="row">
                <span className="muted">Your wallet:</span>
                {me ? <span className="mono">{short(me)}</span> : <button className="btn small" disabled={!!busy} onClick={() => act("connect", async () => { await connect(); return { note: "Wallet connected." }; })}>Connect wallet</button>}
              </div>
              <label className="field"><span>Amount (BNB)</span><input type="text" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} /></label>
              <div className="row">
                <button className="btn primary" disabled={!!busy} onClick={addFunds}>{busy === "fund" ? "Sending…" : "Add funds"}</button>
                <button className="btn" disabled={!!busy} onClick={() => withdraw(false)}>Withdraw</button>
                <button className="btn small" disabled={!!busy} onClick={() => withdraw(true)}>Withdraw all</button>
              </div>
              <p className="muted" style={{ fontSize: ".85em" }}>Keep about {st.gasKeep} BNB extra for gas. Withdrawals go to your connected wallet.</p>
              <button className="btn small" disabled={!!busy} onClick={() => { if (confirm("Show the Lobby wallet's private key? Anyone who sees it can take the funds.")) act("key", async () => { const r = await api("key-reveal", {}); prompt("Lobby private key (keep it secret):", r.key); return {}; }); }}>Show private key</button>
            </>
          )}
        </div>

        <div className="card stack">
          <h2>Snipe a token</h2>
          <label className="field"><span>Token address (BNB Chain)</span><input type="text" className="mono" placeholder="0x…" spellCheck={false} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
          <label className="field"><span>Buy with (BNB)</span><input type="text" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} /></label>
          <div className="field">
            <span>Sell everything at</span>
            <div className="row" style={{ gap: 6 }}>
              {XS.map((v) => <button key={v} type="button" className={`btn small${!customX && x === v ? " primary" : ""}`} onClick={() => { setX(v); setCustomX(""); }}>{v}x</button>)}
              <input type="text" inputMode="decimal" placeholder="Other x" value={customX} onChange={(e) => setCustomX(e.target.value)} style={{ width: 90 }} />
            </div>
            <small className="muted">Sells when it's worth {target}x what you put in{Number(buy) > 0 ? ` (about ${(Number(buy) * target).toFixed(3)} BNB)` : ""}.</small>
          </div>
          <div className="field">
            <span>Speed</span>
            <div className="row" style={{ gap: 6 }}>{SPEEDS.map(([k, l]) => <button key={k} type="button" className={`btn small${speed === k ? " primary" : ""}`} onClick={() => setSpeed(k)}>{l}</button>)}</div>
            <small className="muted">Higher gas puts the buy ahead of slower ones in the block. Fastest costs about 0.006 BNB per buy.</small>
          </div>
          <button type="button" className="btn small" onClick={() => setMore(!more)}>{more ? "Hide" : "More"} options</button>
          {more && (
            <div className="grid2" style={{ gap: 10 }}>
              <label className="field"><span>Stop-loss % (optional)</span><input type="text" inputMode="decimal" placeholder="e.g. 50" value={stop} onChange={(e) => setStop(e.target.value)} /></label>
              <label className="field"><span>Max slippage %</span><input type="text" inputMode="decimal" value={maxSlip} onChange={(e) => setMaxSlip(e.target.value)} /></label>
              <label className="field"><span>Min liquidity (BNB)</span><input type="text" inputMode="decimal" value={minLiq} onChange={(e) => setMinLiq(e.target.value)} /></label>
              <label className="field"><span>Max sell tax %</span><input type="text" inputMode="decimal" value={maxTax} onChange={(e) => setMaxTax(e.target.value)} /></label>
              <small className="muted" style={{ gridColumn: "1/-1" }}>Slippage is set automatically for each buy from the pool size, as low as will still go through, never above your max. Min liquidity skips bait pools. If the token turns out to be a honeypot or its sell tax is over your max, it sells straight away.</small>
            </div>
          )}
          <button className="btn primary" disabled={!!busy || !st?.address} onClick={snipe}>{busy === "snipe" ? "Starting…" : "🎯 Start sniping"}</button>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h2>Snipes</h2>{active && <span className="badge v">● Watching live</span>}</div>
        {!st?.snipes.length ? <p className="muted">Nothing yet. Paste a token above.</p> : st.snipes.map((s) => <Row key={s.id} s={s} busy={!!busy} act={act} usd={usd} />)}
      </div>
      <p className="muted" style={{ fontSize: ".84em" }}>No sniper can promise to be first: other bots bid for the same block. Most new tokens go to zero. Nothing here is financial advice.</p>
    </div>
  );
}

function Row({ s, busy, act, usd }: { s: Snipe; busy: boolean; act: (l: string, f: () => Promise<any>) => void; usd: (b: number | null) => string }) {
  const [open, setOpen] = useState(false);
  const pnl = s.status === "sold" && s.out_bnb != null ? s.out_bnb - s.buy_bnb : null;
  return (
    <div className="card stack" style={{ padding: 14, gap: 8, borderLeft: `4px solid ${COLOR[s.status] || "#6b7280"}` }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <b>{s.symbol || short(s.token)}</b> <span className="badge" style={{ background: COLOR[s.status], color: "#fff" }}>{s.status}</span>
          <div className="muted mono" style={{ fontSize: ".8em" }}><a href={`https://bscscan.com/token/${s.token}`} target="_blank" rel="noopener">{short(s.token)}</a> · {s.buy_bnb} BNB · sell at {s.take_x}x{s.stop_pct ? ` · stop -${s.stop_pct}%` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {s.status === "holding" && s.last_x != null && <b style={{ color: s.last_x >= 1 ? "#10b981" : "#ef4444", fontSize: "1.3em" }}>{s.last_x.toFixed(2)}x</b>}
          {pnl != null && <b style={{ color: pnl >= 0 ? "#10b981" : "#ef4444" }}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} BNB{usd(pnl)}</b>}
          {s.status === "holding" && s.peak_x != null && <div className="muted" style={{ fontSize: ".8em" }}>high {s.peak_x.toFixed(2)}x</div>}
        </div>
      </div>
      {s.note && <div className="muted" style={{ fontSize: ".9em" }}>{s.note}</div>}
      <div className="row" style={{ gap: 6, fontSize: ".82em" }}>
        {s.slip_used != null && <span className="badge">slippage {s.slip_used}%</span>}
        {s.gas_gwei != null && <span className="badge">{s.gas_gwei.toFixed(1)} gwei</span>}
        {s.buy_tax != null && <span className="badge">buy tax {s.buy_tax}%</span>}
        {s.sell_tax != null && <span className="badge">sell tax {s.sell_tax}%</span>}
        {s.honeypot && <span className="badge" style={{ background: "#ef4444", color: "#fff" }}>honeypot</span>}
        {s.buy_tx && <a href={`https://bscscan.com/tx/${s.buy_tx}`} target="_blank" rel="noopener">buy tx</a>}
        {s.sell_tx && <a href={`https://bscscan.com/tx/${s.sell_tx}`} target="_blank" rel="noopener">sell tx</a>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {s.status === "watching" && <button className="btn small" disabled={busy} onClick={() => act("cancel", () => api("cancel", { id: s.id }))}>Cancel</button>}
        {s.status === "holding" && <button className="btn small danger" disabled={busy} onClick={() => { if (confirm(`Sell all ${s.symbol || "tokens"} now?`)) act("sell", () => api("sell", { id: s.id })); }}>Sell now</button>}
        {(s.status === "watching" || s.status === "holding") && <button className="btn small" disabled={busy} onClick={() => {
          const v = prompt("Sell at what x? (e.g. 3)", String(s.take_x)); if (!v) return;
          const sl = prompt("Stop-loss % (leave empty for none)", s.stop_pct ? String(s.stop_pct) : "");
          act("target", () => api("target", { id: s.id, take_x: Number(v), stop_pct: sl ? Number(sl) : null }));
        }}>Change x</button>}
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? "Hide" : "Log"}</button>
      </div>
      {open && <ol className="muted" style={{ fontSize: ".82em", margin: 0, paddingLeft: 18 }}>{s.log.slice().reverse().map((l, i) => <li key={i}><span className="mono">{new Date(l.at).toLocaleTimeString()}</span> {l.m}</li>)}</ol>}
    </div>
  );
}
