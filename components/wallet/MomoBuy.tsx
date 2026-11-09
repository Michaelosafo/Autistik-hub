"use client";
/**
 * Buy crypto with MoMo. Pick a coin and how many cedis, then pay with MTN MoMo, Telecel Cash or AirtelTigo Money on
 * Onramper's secure checkout (licensed partners such as Yellow Card). The coins go straight to this wallet.
 * AUTISTIK never holds the cedis or the coins.
 */
import { useEffect, useState } from "react";
import { api } from "@/components/wallet/util";

const AMOUNTS = [50, 100, 200, 500, 1000];

export default function MomoBuy({ evm, sol, start }: { evm: string | null; sol: string | null; start?: { coin?: string; ghs?: number } }) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [coins, setCoins] = useState<Record<string, string>>({});
  const [coin, setCoin] = useState(start?.coin || "usdt_bsc");
  const [ghs, setGhs] = useState(String(start?.ghs || 100));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { api<{ ready: boolean; coins: Record<string, string> }>("momo-status", {}).then((d) => { setReady(d.ready); setCoins(d.coins); }).catch(() => setReady(false)); }, []);

  async function go() {
    setBusy(true); setMsg("");
    // Open the window first (inside the tap), so phones don't block it as a pop-up.
    const win = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("momo-link", { coin, ghs: Number(ghs), evm, sol });
      if (win) win.location.href = url; else window.location.href = url;
      setMsg("Checkout opened. After you pay, the coins arrive in this wallet, usually within minutes.");
    } catch (e: any) { win?.close(); setMsg(e.message || "Couldn't open the checkout."); }
    setBusy(false);
  }

  if (ready === null) return <div className="momo"><small className="muted">Loading…</small></div>;
  if (!ready) return <div className="momo"><b>Buy with MoMo</b><p className="muted">Coming soon: buy crypto with MTN MoMo, Telecel Cash or AirtelTigo Money, straight into this wallet.</p></div>;
  const n = Number(ghs);
  return (
    <div className="momo">
      <div className="momo-h"><b>Buy with MoMo</b><small>MTN MoMo · Telecel Cash · AirtelTigo Money</small></div>
      <label className="momo-f"><span>Coin</span>
        <select value={coin} onChange={(e) => setCoin(e.target.value)}>{Object.entries(coins).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </label>
      <label className="momo-f"><span>You pay (GH₵)</span>
        <input inputMode="decimal" value={ghs} onChange={(e) => setGhs(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Amount in cedis" />
      </label>
      <div className="momo-chips">{AMOUNTS.map((a) => <button key={a} type="button" className={n === a ? "on" : ""} onClick={() => setGhs(String(a))}>GH₵{a}</button>)}</div>
      <button type="button" className="tx-cta convert" disabled={busy || !(n >= 10)} onClick={go}>{busy ? "Opening…" : `Pay GH₵${n || 0} with MoMo`}</button>
      {msg && <small className="muted" role="status">{msg}</small>}
      <small className="muted">Paid through Onramper&apos;s licensed partners, who may ask for your ID the first time. Their fees and rate are shown before you pay. AUTISTIK never holds your money.</small>
    </div>
  );
}
