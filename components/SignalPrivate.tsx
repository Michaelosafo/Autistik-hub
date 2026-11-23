"use client";

/**
 * Signal · Private (owner only): a two-step route through Monero, deposit-address style like an exchange.
 *  1. In: send a coin to a deposit address → XMR lands in YOUR Monero wallet (Cake, Feather, Monero GUI).
 *  2. Out: later, send XMR from that wallet → the coin lands in a fresh wallet, paid from ChangeNOW's wallet.
 * Holding the XMR in your own wallet between the two steps is what breaks the on-chain link.
 */
import { useEffect, useState } from "react";
import { COINS, XMR, okAddress, type Coin } from "@/lib/changenow";

type Swap = { id: string; dir: "in" | "out"; from: string; to: string; amount: string; payinAddress: string; payinExtraId: string | null; toAmount: number; address: string; at: number; status?: string; payoutHash?: string | null };
const KEY = "signal-private-swaps";
const DONE = new Set(["finished", "failed", "refunded", "expired"]);
const STEP: Record<string, string> = {
  new: "Waiting for your deposit", waiting: "Waiting for your deposit", confirming: "Deposit seen, confirming",
  exchanging: "Swapping", sending: "Sending to your wallet", finished: "Done", failed: "Failed (contact ChangeNOW support with the swap id)",
  refunded: "Refunded", verifying: "ChangeNOW is checking this swap (they may email or ask for details)", expired: "Expired: nothing was sent",
};
const coin = (k: string): Coin => (k === XMR.key ? XMR : COINS.find((c) => c.key === k)!);
const SCAN: Record<string, string> = { bsc: "https://bscscan.com/tx/", eth: "https://etherscan.io/tx/", sol: "https://solscan.io/tx/", trx: "https://tronscan.org/#/transaction/", btc: "https://mempool.space/tx/" };

async function api<T = any>(action: string, body: object = {}): Promise<T> {
  const r = await fetch("/api/signal/private", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
const load = (): Swap[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const save = (s: Swap[]) => { try { localStorage.setItem(KEY, JSON.stringify(s.slice(0, 20))); } catch { /* private mode */ } };
const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 });

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let on = true; import("qrcode").then((m: any) => (m.default || m).toDataURL(text, { margin: 1, width: 220 })).then((u: string) => { if (on) setSrc(u); }).catch(() => {}); return () => { on = false; }; }, [text]);
  return src ? <img src={src} alt="Deposit address QR code" width={220} height={220} style={{ borderRadius: 8, background: "#fff", alignSelf: "center" }} /> : null;
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy:", text); } setOk(true); setTimeout(() => setOk(false), 1500); }}>{ok ? "Copied" : "Copy"}</button>;
}

function Deposit({ s, onStatus }: { s: Swap; onStatus: (id: string, status: string, payoutHash: string | null) => void }) {
  const f = coin(s.from), t = coin(s.to);
  useEffect(() => {
    if (DONE.has(s.status || "")) return;
    let on = true;
    const tick = async () => { const d = await api<{ status: string; payoutHash: string | null }>("status", { id: s.id }).catch(() => null); if (on && d) onStatus(s.id, d.status, d.payoutHash); };
    tick(); const iv = setInterval(tick, 15000);
    return () => { on = false; clearInterval(iv); };
  }, [s.id, s.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = s.status || "new";
  return (
    <div className="card stack">
      <b>Send exactly {s.amount} {f.ticker.toUpperCase()} on {f.label.split(" · ")[1]}</b>
      {(st === "new" || st === "waiting") && <Qr text={s.payinAddress} />}
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code style={{ wordBreak: "break-all", flex: 1 }}>{s.payinAddress}</code><Copy text={s.payinAddress} />
      </div>
      {s.payinExtraId && <div className="row" style={{ gap: 8 }}><span className="muted">Memo / tag (required):</span><code>{s.payinExtraId}</code><Copy text={s.payinExtraId} /></div>}
      <small className="muted">Only send {f.label} to this address. You'll get about {fmt(s.toAmount)} {t.ticker.toUpperCase()} at {short(s.address)}.</small>
      <div className={st === "failed" || st === "verifying" ? "notice warn" : "notice"}>
        {STEP[st] || st}
        {s.payoutHash && SCAN[t.network] && <div><a href={SCAN[t.network] + s.payoutHash} target="_blank" rel="noopener noreferrer">Payout ↗</a></div>}
        {s.payoutHash && t.kind === "xmr" && <div className="muted">Payout tx: <code>{short(s.payoutHash)}</code> (check it in your Monero wallet)</div>}
      </div>
      <small className="muted">Swap id {s.id}</small>
    </div>
  );
}

export default function SignalPrivate() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [dir, setDir] = useState<"in" | "out">("in");
  const [other, setOther] = useState("usdt-bsc");
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const [refund, setRefund] = useState("");
  const [quote, setQuote] = useState<{ toAmount: number; minAmount: number; warning: string | null } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [swaps, setSwaps] = useState<Swap[]>([]);
  useEffect(() => { setSwaps(load()); api<{ ready: boolean }>("ready").then((d) => setReady(d.ready)).catch(() => setReady(false)); }, []);

  const from = dir === "in" ? coin(other) : XMR, to = dir === "in" ? XMR : coin(other);
  useEffect(() => { setQuote(null); setErr(""); }, [dir, other, amount]);
  useEffect(() => { setAddress(""); setRefund(""); }, [dir, other]);

  const update = (id: string, status: string, payoutHash: string | null) => setSwaps((list) => { const n = list.map((x) => (x.id === id ? { ...x, status, payoutHash } : x)); save(n); return n; });

  async function getQuote() {
    setErr(""); setBusy("Getting a price…");
    try { setQuote(await api("quote", { from: from.key, to: to.key, amount })); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }
  async function create() {
    setErr("");
    if (!okAddress(to, address)) { setErr(`That isn't a ${to.label.split(" · ")[1]} address.`); return; }
    if (refund && !okAddress(from, refund)) { setErr(`The refund address isn't a ${from.label.split(" · ")[1]} address.`); return; }
    setBusy("Getting your deposit address…");
    try {
      const d = await api<{ id: string; payinAddress: string; payinExtraId: string | null; toAmount: number }>("create", { from: from.key, to: to.key, amount, address, refund });
      const s: Swap = { ...d, dir, from: from.key, to: to.key, amount, address, at: Date.now(), status: "new", toAmount: d.toAmount || quote?.toAmount || 0 };
      setSwaps((list) => { const n = [s, ...list]; save(n); return n; });
      setQuote(null); setAmount("");
    } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }

  const live = swaps.filter((s) => !DONE.has(s.status || "") && Date.now() - s.at < 3 * 864e5);
  const past = swaps.filter((s) => !live.includes(s));
  const low = quote && quote.minAmount > 0 && Number(amount) < quote.minAmount;

  return (
    <div className="stack">
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Two steps through Monero. <b>In:</b> send a coin, get XMR in your own Monero wallet. <b>Out:</b> later, send that XMR and get a coin in a fresh wallet. Wait a while between steps, use different amounts, and never send Out to a wallet you used In from.
        </p>
        {ready === false && <div className="notice warn">Add <code>CHANGENOW_API_KEY</code> in Vercel (free from ChangeNOW's partner page), then redeploy.</div>}
        <div className="row" style={{ gap: 8 }} role="radiogroup" aria-label="Direction">
          <button type="button" role="radio" aria-checked={dir === "in"} className={dir === "in" ? "btn small primary" : "btn small"} onClick={() => setDir("in")} disabled={!!busy}>1 · In (coin → XMR)</button>
          <button type="button" role="radio" aria-checked={dir === "out"} className={dir === "out" ? "btn small primary" : "btn small"} onClick={() => setDir("out")} disabled={!!busy}>2 · Out (XMR → coin)</button>
        </div>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">{dir === "in" ? "You send" : "You receive"}</span>
          <select value={other} onChange={(e) => setOther(e.target.value)} disabled={!!busy}>
            {COINS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Amount of {from.ticker.toUpperCase()} you send</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">{dir === "in" ? "Your Monero (XMR) address" : `Fresh ${to.label} address to receive at`}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder={dir === "in" ? "4… or 8…" : to.kind === "evm" ? "0x…" : to.kind === "trx" ? "T…" : "Address"} />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Refund address if it fails ({from.label}, optional)</span>
          <input value={refund} onChange={(e) => setRefund(e.target.value.trim())} placeholder="Optional" />
        </label>
        {!quote
          ? <button className="btn primary" disabled={!!busy || !ready || !amount} onClick={getQuote}>Get price</button>
          : <>
              <div className={low ? "notice warn" : "notice"}>
                You get about <b>{fmt(quote.toAmount)} {to.ticker.toUpperCase()}</b>{quote.minAmount ? ` · minimum ${fmt(quote.minAmount)} ${from.ticker.toUpperCase()}` : ""}
                {quote.warning && <div>{quote.warning}</div>}
              </div>
              <button className="btn primary" disabled={!!busy || !!low || !address} onClick={create}>Get deposit address</button>
            </>}
        {busy && <div className="notice">{busy}</div>}
        {err && <div className="notice warn">{err}</div>}
      </div>

      {live.map((s) => <Deposit key={s.id} s={s} onStatus={update} />)}

      {past.length > 0 && (
        <div className="card stack">
          <b>Earlier</b>
          {past.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <span>{s.amount} {coin(s.from).ticker.toUpperCase()} → {coin(s.to).ticker.toUpperCase()}</span>
              <span className="muted">{STEP[s.status || ""]?.split(" (")[0] || s.status} · {new Date(s.at).toLocaleDateString()}</span>
            </div>
          ))}
          <button className="btn small" onClick={() => { const n = swaps.filter((s) => live.includes(s)); setSwaps(n); save(n); }}>Clear history</button>
        </div>
      )}
    </div>
  );
}
