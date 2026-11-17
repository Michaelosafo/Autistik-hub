"use client";
/**
 * Copy desk (BNB Chain only): paste wallets to copy, add one or two of your own wallets (private keys) that buy with
 * their own BNB, and set the buy size and safety exits.
 */
import { useState } from "react";

export type CopyKeys = { bnbUsd: number; keys: { slot: number; address: string | null; bnb: number | null }[] };
type W = { address: string; chain?: string; label?: string; usd?: number; on?: boolean };
type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function CopyBsc({ s, keys, cfg, busy, act, set }: {
  s: { copy_wallets?: W[]; mode: string }; keys: CopyKeys | null; cfg?: { usd: number; tp: number; sl: number } | null;
  busy: string; act: Act; set: (b: any, done?: string) => Promise<void>;
}) {
  const [addr, setAddr] = useState(""), [label, setLabel] = useState(""), [err, setErr] = useState("");
  const [keyIn, setKeyIn] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState(0);
  const reveal = async (slot: number) => {
    if (!confirm(`Show wallet ${slot}'s private key? Anyone who sees it can take the money. Use it to import the wallet into Bitget, MetaMask or Trust.`)) return;
    const r = await fetch("/api/ai-futures/copy-key-reveal?desk=copy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slot }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || "Couldn't show it."); return; }
    prompt(`Wallet ${slot} private key (keep it secret):`, j.key);
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

      <b style={{ marginTop: 8 }}>🔑 Your wallets that buy (up to 5)</b>
      <small className="muted">Each wallet you add buys every copied coin with its own BNB, so with 3 wallets each copy is bought 3 times. Keep some extra BNB in each for gas. Keys are stored encrypted on the server and never shown on this page.</small>
      {(() => { const ks = keys?.keys || [{ slot: 1, address: null, bnb: null }]; const firstFree = ks.find((k) => !k.address)?.slot; return ks.filter((k) => k.address || k.slot === firstFree); })().map((k) => (
        <div key={k.slot} className="stack" style={{ gap: 4, padding: "8px 10px", border: "1px solid var(--line, rgba(127,127,127,.25))", borderRadius: 12 }}>
          <small><b>Wallet {k.slot}</b>{!k.address && mine.length ? <span className="muted"> (add another, optional)</span> : null}</small>
          {k.address ? (
            <>
              <code style={{ wordBreak: "break-all" }}>{k.address}</code>
              <small className="muted">{k.bnb == null ? "–" : `${k.bnb.toFixed(4)} BNB`}{k.bnb != null && bnbUsd ? ` (≈ $${(k.bnb * bnbUsd).toFixed(2)})` : ""}{k.bnb != null && bnbUsd && k.bnb * bnbUsd < per ? ` · not enough for a $${per} buy, send BNB to it` : ""}</small>
              <small className="muted">To fund it: send BNB on <b>BNB Chain (BEP20)</b> to the address above.</small>
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

      <b style={{ marginTop: 8 }}>💵 Each buy</b>
      {([["snipe_usd", "Buy", "$ per coin, per wallet", cfg?.usd], ["snipe_tp", "Safety take profit at", "% up", cfg?.tp], ["snipe_sl", "Safety stop-loss at", "% down", cfg?.sl]] as const).map(([k, l, unit, v]) => (
        <div key={k} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <small><b>{l}:</b> {String(v ?? "")} {unit}{k === "snipe_usd" && bnbUsd && v ? <span className="muted"> (≈ {(Number(v) / bnbUsd).toFixed(4)} BNB)</span> : null}</small>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => { const x = prompt(`${l} (${unit}):`, String(v ?? "")); if (x != null && isFinite(Number(x)) && Number(x) > 0) set({ [k]: Number(x) }); }}>Change</button>
        </div>
      ))}
    </section>
  );
}
