"use client";
/**
 * Parts of the AI trader's copy trading panel: which sources it trades (Telegram only by default), callers whose
 * posts buy a set dollar amount, and the dump re-buy for new projects.
 */
import { useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
export type Caller = { id: number; platform: "tg" | "x"; who: string; usd: number };
export type Rebuy = { id: number; chain: string; token: string; symbol: string | null; sold_usd: number; low_usd: number | null; status: string; note: string | null; sold_at: string };

/** What the trader buys from: tick any mix. Telegram and X calls are bought as called; General has the safety checks. */
export function SourcePicker({ tg, x, general, busy, onAct }: { tg: boolean; x: boolean; general: boolean; busy: boolean; onAct: Act }) {
  const set = (k: "use_tg" | "use_x" | "use_general", v: boolean, label: string) => {
    if (!v && [tg, x, general].filter(Boolean).length === 1) return; // keep one on
    onAct(k, "settings", { [k]: v }, `${label} ${v ? "on" : "off"}.`);
  };
  const Box = ({ k, on, title, note }: { k: "use_tg" | "use_x" | "use_general"; on: boolean; title: string; note: string }) => (
    <label className={"aic-row" + (on ? " on" : "")}>
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => set(k, e.target.checked, title)} />
      <span className="grow"><b>{title}</b><small className="muted">{note}</small></span>
    </label>
  );
  return (
    <div className="stack" style={{ gap: 6 }}>
      <small className="muted">What it buys from (tick any)</small>
      <div className="aic-list">
        <Box k="use_tg" on={tg} title="✈️ Telegram" note="Coins called in your ticked Telegram chats." />
        <Box k="use_x" on={x} title="𝕏 X" note="Coins posted by your followed X accounts, Lists and Communities." />
        <Box k="use_general" on={general} title="🛡 General (with security checks)" note="The AI also finds coins itself (scanning and DexScreener signals). Every one is honeypot, tax, liquidity and rug-checked before buying." />
      </div>
    </div>
  );
}

export function Callers({ list, normal, busy, onAct }: { list: Caller[]; normal: string; busy: boolean; onAct: Act }) {
  const [platform, setPlatform] = useState<"tg" | "x">("tg");
  const [who, setWho] = useState("");
  const [usd, setUsd] = useState("");
  const label = (c: Caller) => (/^\d+$/.test(c.who) ? `ID ${c.who}` : `@${c.who}`);
  return (
    <div className="aic-block">
      <b>⭐ Caller sizes</b>
      <small className="muted">Everyone&apos;s calls buy the normal size ({normal}). Add the good traders here with a bigger dollar amount, so their calls buy big. Paste several @usernames or user ids at once, separated by spaces or commas.</small>
      <form className="aic-caller" onSubmit={(e) => { e.preventDefault(); if (who.trim() && Number(usd) > 0) onAct("caller", "caller", { op: "add", platform, who, usd: Number(usd) }).then(() => { setWho(""); }); }}>
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as "tg" | "x")} aria-label="Where they post">
          <option value="tg">Telegram</option>
          <option value="x">X</option>
        </select>
        <input className="input" placeholder={platform === "tg" ? "@username or user id" : "@handle"} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Callers" />
        <span className="ait-in" style={{ width: 110 }}><em>$</em><input inputMode="decimal" placeholder="50" value={usd} onChange={(e) => setUsd(e.target.value)} aria-label="Dollars per buy" /></span>
        <button type="submit" className="btn small" disabled={busy || !who.trim() || !(Number(usd) > 0)}>Add</button>
      </form>
      {list.length > 0 ? (
        <div className="aic-list">{list.map((c) => (
          <div key={c.id} className="aic-row on">
            <span className="grow"><b>{label(c)}</b><small className="muted">{c.platform === "x" ? "X" : "Telegram"} · buys ${Number(c.usd).toLocaleString("en-US")} per call</small></span>
            <button type="button" className="aic-x" aria-label={`Remove ${label(c)}`} disabled={busy} onClick={() => onAct(`cl${c.id}`, "caller", { op: "remove", id: c.id })}>✕</button>
          </div>
        ))}</div>
      ) : <small className="muted">No caller sizes yet.</small>}
      <small className="muted">To find a Telegram user id, open their profile in Telegram (some apps show the id), or forward one of their messages to @userinfobot.</small>
    </div>
  );
}

export function RebuyBox({ on, dump, tp, sl, list, busy, onAct }: { on: boolean; dump: number; tp: number; sl: number; list: Rebuy[]; busy: boolean; onAct: Act }) {
  const [d, setD] = useState(""), [t, setT] = useState("");
  return (
    <div className="aic-block">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <b>🔁 Dump re-buy (new projects)</b>
        <label className="ait-check" style={{ margin: 0 }}><input type="checkbox" checked={on} disabled={busy} onChange={(e) => onAct("rb", "settings", { rebuy_on: e.target.checked })} /> <span>On</span></label>
      </div>
      <small className="muted">After a new project (under 24 hours old when bought) sells at 2x, it&apos;s watched for 48 hours. If it dumps {dump}% below the sell price with heavy volume and buyers step back in, it&apos;s bought again (honeypot-checked) and sold on a +{tp}% bounce or −{sl}%.</small>
      <div className="aic-rules">
        <label><small className="muted">Buy back after a dump of</small>
          <span className="ait-in"><em>−</em><input inputMode="decimal" disabled={busy} value={d || String(dump)} onChange={(e) => setD(e.target.value)} onBlur={() => { if (d && Number(d) !== dump) onAct("rbd", "settings", { rebuy_dump: Number(d) }, `Re-buys after a ${Number(d)}% dump.`); setD(""); }} /><em>%</em></span></label>
        <label><small className="muted">Sell the re-buy at</small>
          <span className="ait-in"><em>+</em><input inputMode="decimal" disabled={busy} value={t || String(tp)} onChange={(e) => setT(e.target.value)} onBlur={() => { if (t && Number(t) !== tp) onAct("rbt", "settings", { rebuy_tp: Number(t) }, `Re-buys sell at +${Number(t)}%.`); setT(""); }} /><em>%</em></span></label>
      </div>
      {list.length > 0 && (
        <div className="aic-list">{list.map((r) => {
          const low = r.low_usd ? (1 - Number(r.low_usd) / Number(r.sold_usd)) * 100 : 0;
          return (
            <div key={r.id} className={"aic-row" + (r.status === "watching" ? " on" : "")}>
              <span className="grow"><b>{r.symbol || `${r.token.slice(0, 6)}…`}</b><small className="muted">{r.status === "watching" ? `Watching · lowest ${low.toFixed(0)}% below the sell` : r.status === "bought" ? "Bought back" : "Stopped watching"}{r.note ? ` · ${r.note}` : ""}</small></span>
              <a className="btn small" href={`https://dexscreener.com/${r.chain}/${r.token}`} target="_blank" rel="noopener noreferrer">Chart</a>
            </div>
          );
        })}</div>
      )}
    </div>
  );
}

export type LiveWallet = { chain: string; native: string; on: boolean; address: string | null; balance: number | null };
const CHAIN_LABEL: Record<string, string> = { bsc: "BNB Chain", ethereum: "Ethereum", robinhood: "Robinhood Chain", solana: "Solana" };

/** Live chains: switch each on or off, see its wallet address and balance, and make the Solana wallet. */
export function LiveChains({ list, live, busy, onAct }: { list: LiveWallet[]; live: boolean; busy: boolean; onAct: Act }) {
  const [copied, setCopied] = useState("");
  const on = list.filter((w) => w.on).map((w) => w.chain);
  const toggle = (chain: string, v: boolean) => onAct(`lc${chain}`, "settings", { live_chains: v ? [...on, chain] : on.filter((c) => c !== chain) }, v ? `${CHAIN_LABEL[chain]} on for live trading.` : `${CHAIN_LABEL[chain]} off for live trading.`);
  const copy = (a: string) => { navigator.clipboard?.writeText(a).then(() => { setCopied(a); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  return (
    <div className="aic-block">
      <b>⛓ Live chains</b>
      <small className="muted">{live ? "Live trading buys on the chains switched on here." : "You're in practice mode: these apply once you switch to Live."} Each chain pays with its own coin, so send that coin to the wallet: BNB on BNB Chain, ETH on Ethereum, ETH on Robinhood Chain, SOL on Solana. The same address works on BNB Chain, Ethereum and Robinhood Chain. Calls on a chain that&apos;s off (or has no money) are skipped.</small>
      <div className="aic-list">{list.map((w) => (
        <div key={w.chain} className={"aic-row aic-chain" + (w.on ? " on" : "")}>
          <input type="checkbox" checked={w.on} disabled={busy || (!w.address && !w.on)} onChange={(e) => toggle(w.chain, e.target.checked)} aria-label={`Trade live on ${CHAIN_LABEL[w.chain]}`} />
          <span className="grow">
            <b>{CHAIN_LABEL[w.chain] || w.chain}</b>
            <small className="muted">{w.address ? <>{w.balance == null ? "balance unavailable" : `${w.balance.toFixed(w.native === "SOL" ? 4 : 5)} ${w.native}`} · <button type="button" className="aic-addr" onClick={() => copy(w.address!)}>{copied === w.address ? "Copied ✓" : `${w.address.slice(0, 6)}…${w.address.slice(-4)} (copy)`}</button></> : w.chain === "solana" ? "No Solana wallet yet" : "No trading wallet yet (create it under Live wallet)"}</small>
          </span>
          {w.chain === "solana" && !w.address && <button type="button" className="btn small" disabled={busy} onClick={() => onAct("solw", "sol-wallet", {})}>Create Solana wallet</button>}
        </div>
      ))}</div>
      <SolImport has={list.some((w) => w.chain === "solana" && w.address)} busy={busy} onAct={onAct} />
      {list.some((w) => w.chain === "solana" && w.address) && (
        <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={busy}
          onClick={async () => { if (!confirm("Show the Solana wallet's private key? Anyone who sees it can take the SOL and coins in it.")) return; const r = await fetch("/api/ai-trader/sol-key-reveal", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((x) => x.json()).catch(() => null); if (r?.key) prompt("Solana private key (import into Phantom or Solflare as a private key). Keep it secret:", r.key); else alert(r?.error || "Couldn't load it."); }}>Show Solana private key</button>
      )}
    </div>
  );
}

/** Use your own Solana wallet: paste the private key Phantom / Solflare shows. */
function SolImport({ has, busy, onAct }: { has: boolean; busy: boolean; onAct: Act }) {
  const [open, setOpen] = useState(false), [key, setKey] = useState("");
  if (!open) return <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setOpen(true)}>{has ? "Use my own Solana wallet instead" : "Import my Solana wallet"}</button>;
  return (
    <div className="ait-key">
      <small>Paste the private key of a Solana wallet you own. In Phantom: Settings → Manage accounts → your account → Show private key. In Solflare: Settings → Export private key. Use a separate wallet just for the AI, never your main one.{has ? " The current Solana trading wallet must be empty first." : ""}</small>
      <input className="input" type="password" autoComplete="off" spellCheck={false} placeholder="Solana private key" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Solana private key" />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn small primary" disabled={busy || key.trim().length < 40} onClick={() => onAct("solimp", "sol-key-import", { key: key.trim() }).then(() => { setKey(""); setOpen(false); })}>Use this wallet</button>
        <button type="button" className="btn small" onClick={() => { setKey(""); setOpen(false); }}>Cancel</button>
      </div>
    </div>
  );
}
