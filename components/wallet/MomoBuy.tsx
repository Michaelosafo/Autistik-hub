"use client";
/**
 * Buy crypto with MoMo, right here: pick a coin and an amount in cedis, enter your MoMo number, approve the payment
 * on your phone, and the coins arrive in this wallet. A licensed on-ramp (Kotani Pay) takes the payment, checks ID if
 * needed and sends the coins; AUTISTIK never holds the cedis or the coins.
 * If that isn't switched on but the Onramper checkout is, it opens that instead.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/components/wallet/util";

const AMOUNTS = [50, 100, 200, 500, 1000];
type Opts = { ready: boolean; sandbox: boolean; coins: Record<string, { label: string; wallet: "evm" | "sol" }>; networks: string[] };
type Order = { id: string; status: "pending" | "paid" | "done" | "failed"; ghs: number; token: string; chain: string; tx_hash: string | null; crypto_amount: number | null; error: string | null };
const EXPLORER: Record<string, string> = { BSC: "https://bscscan.com/tx/", BASE: "https://basescan.org/tx/", ETHEREUM: "https://etherscan.io/tx/", ARBITRUM: "https://arbiscan.io/tx/", POLYGON: "https://polygonscan.com/tx/", SOLANA: "https://solscan.io/tx/" };

export default function MomoBuy({ evm, sol, start }: { evm: string | null; sol: string | null; start?: { coin?: string; ghs?: number } }) {
  const [opts, setOpts] = useState<Opts | null>(null);
  const [checkout, setCheckout] = useState<boolean | null>(null); // the Onramper fallback
  const [coin, setCoin] = useState(start?.coin || "usdt_bsc");
  const [ghs, setGhs] = useState(String(start?.ghs || 100));
  const [network, setNetwork] = useState("MTN");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    try { setPhone(localStorage.getItem("momo-phone") || ""); setName(localStorage.getItem("momo-name") || ""); setNetwork(localStorage.getItem("momo-net") || "MTN"); } catch {}
    fetch("/api/momo/options").then((r) => r.json()).then((o: Opts) => {
      setOpts(o);
      if (o.coins && !o.coins[coin]) setCoin(Object.keys(o.coins)[0]);
      if (!o.ready) api<{ ready: boolean }>("momo-status", {}).then((d) => setCheckout(d.ready)).catch(() => setCheckout(false));
    }).catch(() => setOpts({ ready: false, sandbox: false, coins: {}, networks: [] }));
    return () => clearInterval(timer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function follow(id: string) {
    clearInterval(timer.current);
    const tick = () => fetch("/api/momo/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) })
      .then((r) => r.json()).then((d) => { if (d.order) { setOrder(d.order); if (d.order.status === "done" || d.order.status === "failed") clearInterval(timer.current); } }).catch(() => {});
    tick();
    timer.current = setInterval(tick, 5000);
  }

  async function go() {
    setBusy(true); setMsg("");
    try { localStorage.setItem("momo-phone", phone); localStorage.setItem("momo-name", name); localStorage.setItem("momo-net", network); } catch {}
    const r = await fetch("/api/momo/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coin, ghs: Number(ghs), network, phone, name, evm, sol }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error || "Couldn't start the payment."); if (d.id) follow(d.id); return; }
    // Some networks finish on the provider's page (for example a voucher step): open it.
    if (d.redirectUrl) window.open(d.redirectUrl, "_blank");
    setOrder({ id: d.id, status: "pending", ghs: Number(ghs), token: opts?.coins[coin]?.label || "", chain: "", tx_hash: null, crypto_amount: null, error: null });
    follow(d.id);
  }

  async function openCheckout() {
    const win = window.open("", "_blank");
    try { const { url } = await api<{ url: string }>("momo-link", { coin: coin.startsWith("usdt_sol") ? "usdt_sol" : "usdt_bsc", ghs: Number(ghs), evm, sol }); if (win) win.location.href = url; }
    catch (e: any) { win?.close(); setMsg(e.message); }
  }

  if (!opts) return <div className="momo"><small className="muted">Loading…</small></div>;
  const n = Number(ghs);
  const amounts = <div className="momo-chips">{AMOUNTS.map((a) => <button key={a} type="button" className={n === a ? "on" : ""} onClick={() => setGhs(String(a))}>GH₵{a}</button>)}</div>;

  if (!opts.ready) {
    if (checkout === null) return <div className="momo"><small className="muted">Loading…</small></div>;
    if (!checkout) return <div className="momo"><b>Buy with MoMo</b><p className="muted">Coming soon: buy crypto with MTN MoMo, Telecel Cash or AirtelTigo Money, straight into this wallet.</p></div>;
    return (
      <div className="momo">
        <div className="momo-h"><b>Buy with MoMo</b><small>MTN MoMo · Telecel Cash · AirtelTigo Money</small></div>
        <label className="momo-f"><span>You pay (GH₵)</span><input inputMode="decimal" value={ghs} onChange={(e) => setGhs(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in cedis" /></label>
        {amounts}
        <button type="button" className="tx-cta convert" disabled={!(n >= 10)} onClick={openCheckout}>Pay GH₵{n || 0} with MoMo</button>
        {msg && <small className="muted">{msg}</small>}
      </div>
    );
  }

  if (order) {
    const link = order.tx_hash && EXPLORER[order.chain] ? EXPLORER[order.chain] + order.tx_hash : null;
    return (
      <div className="momo" role="status">
        <div className="momo-h"><b>Buy with MoMo</b><small>GH₵{order.ghs} · {order.token}{order.chain ? ` on ${order.chain}` : ""}</small></div>
        <ol className="momo-steps">
          <li className={order.status === "pending" ? "now" : "ok"}><span />{order.status === "pending" ? <>Check your phone and <b>approve the MoMo payment</b> with your PIN</> : "MoMo payment approved"}</li>
          <li className={order.status === "paid" ? "now" : order.status === "done" ? "ok" : ""}><span />Sending the coins to your wallet</li>
          <li className={order.status === "done" ? "ok" : ""}><span />{order.status === "done" ? <>Done{order.crypto_amount ? `: ${order.crypto_amount} ${order.token}` : ""} {link && <a href={link} target="_blank" rel="noopener noreferrer">View ↗</a>}</> : "Coins in your wallet"}</li>
        </ol>
        {order.status === "failed" && <div className="notice warn">{order.error || "The payment didn't go through. No coins were sent."}</div>}
        {order.status === "pending" && <small className="muted">No prompt? Dial *170# (MTN) and check Approvals, or check your network&apos;s pending payments.</small>}
        {(order.status === "done" || order.status === "failed") && <button type="button" className="btn" onClick={() => { setOrder(null); setMsg(""); }}>Buy again</button>}
      </div>
    );
  }

  const ok = n >= 10 && n <= 5000 && phone.replace(/\D/g, "").length >= 9 && name.trim().length >= 3;
  return (
    <div className="momo">
      <div className="momo-h"><b>Buy with MoMo</b><small>Approve on your phone, coins arrive in this wallet{opts.sandbox ? " · TEST MODE (no real money)" : ""}</small></div>
      <label className="momo-f"><span>Coin</span>
        <select value={coin} onChange={(e) => setCoin(e.target.value)}>{Object.entries(opts.coins).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </label>
      <label className="momo-f"><span>You pay (GH₵)</span>
        <input inputMode="decimal" value={ghs} onChange={(e) => setGhs(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in cedis" />
      </label>
      {amounts}
      <div className="momo-chips" role="radiogroup" aria-label="MoMo network">{opts.networks.map((w) => <button key={w} type="button" role="radio" aria-checked={network === w} className={network === w ? "on" : ""} onClick={() => setNetwork(w)}>{w}</button>)}</div>
      <label className="momo-f"><span>MoMo number</span><input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="024 123 4567" autoComplete="tel" aria-label="MoMo number" /></label>
      <label className="momo-f"><span>Name on the MoMo account</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ama Mensah" autoComplete="name" aria-label="Name on the MoMo account" /></label>
      <button type="button" className="tx-cta convert" disabled={busy || !ok} onClick={go}>{busy ? "Sending the prompt…" : `Pay GH₵${n || 0} with MoMo`}</button>
      {msg && <div className="notice warn">{msg}</div>}
      <small className="muted">Paid through Kotani Pay, a licensed partner, which may ask you to verify your ID. The rate and fees are set by them. AUTISTIK never holds your money.</small>
    </div>
  );
}
