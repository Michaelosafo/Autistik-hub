"use client";
/**
 * Parts of the AI trader's copy trading panel: which sources it trades (Telegram only by default), callers whose
 * posts buy a set dollar amount, and the dump re-buy for new projects.
 */
import { useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
export type Caller = { id: number; platform: "tg" | "x"; who: string; usd: number; chat: string; chat_title: string | null };
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

/** A Telegram chat's id in one form ("c:123:hash" / "g:123" from the account login, -100123 / -123 from the bot). */
const chatKey = (ref: string) => (/^[cgu]:/.test(ref) ? ref.split(":")[1] || "" : ref.replace(/^-100/, "").replace(/^-/, ""));

export function Callers({ list, normal, groups, channels, busy, onAct }: { list: Caller[]; normal: string; groups: { ref: string; title: string }[]; channels: string[]; busy: boolean; onAct: Act }) {
  const [platform, setPlatform] = useState<"tg" | "x">("tg");
  const [chat, setChat] = useState("");
  const [who, setWho] = useState("");
  const [usd, setUsd] = useState("");
  const label = (c: Caller) => (/^\d+$/.test(c.who) ? `ID ${c.who}` : `@${c.who}`);
  const opts = groups.map((g) => ({ key: chatKey(g.ref), title: g.title })).filter((g, i, a) => g.key && a.findIndex((x) => x.key === g.key) === i);
  const byGroup = new Map<string, Caller[]>();
  for (const c of list) byGroup.set(c.platform === "x" ? "x" : c.chat || "", [...(byGroup.get(c.platform === "x" ? "x" : c.chat || "") || []), c]);
  const groupName = (k: string) => (k === "x" ? "X (any account)" : k === "" ? "All Telegram groups" : opts.find((o) => o.key === k)?.title || list.find((c) => c.chat === k)?.chat_title || `Group ${k}`);
  const strict = opts.filter((o) => byGroup.has(o.key));
  return (
    <div className="aic-block">
      <b>⭐ Callers</b>
      <small className="muted"><b>Channels always buy every call.</b> For group chats, pick a group and add the good callers there: <b>a group with callers picked buys only their calls</b>; a group with nobody picked buys every call. Each caller has their own dollar amount per call (normal size is {normal}).</small>
      <form className="aic-caller" onSubmit={(e) => { e.preventDefault(); if (who.trim() && Number(usd) > 0) { const t = opts.find((o) => o.key === chat)?.title; onAct("caller", "caller", { op: "add", platform, who, usd: Number(usd), chat: platform === "tg" ? chat : "", chatTitle: t }).then(() => setWho("")); } }}>
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as "tg" | "x")} aria-label="Where they post">
          <option value="tg">Telegram</option>
          <option value="x">X</option>
        </select>
        {platform === "tg" && (
          <select className="input" value={chat} onChange={(e) => setChat(e.target.value)} aria-label="Which group">
            <option value="">All groups (size only)</option>
            {opts.map((o) => <option key={o.key} value={o.key}>Only in: {o.title}</option>)}
          </select>
        )}
        <input className="input" placeholder={platform === "tg" ? "@username or user id (several ok)" : "@handle"} value={who} onChange={(e) => setWho(e.target.value)} aria-label="Callers" />
        <span className="ait-in" style={{ width: 110 }}><em>$</em><input inputMode="decimal" placeholder="50" value={usd} onChange={(e) => setUsd(e.target.value)} aria-label="Dollars per buy" /></span>
        <button type="submit" className="btn small" disabled={busy || !who.trim() || !(Number(usd) > 0)}>Add</button>
      </form>
      {platform === "tg" && !chat && <small className="muted">&ldquo;All groups&rdquo; only sets their size wherever they post; it doesn&apos;t limit any group. To make a group buy only certain people, pick that group.</small>}
      {list.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>{[...byGroup.entries()].map(([k, cs]) => (
          <div key={k} className="stack" style={{ gap: 6 }}>
            <small><b>{groupName(k)}</b>{k !== "" && k !== "x" ? " · only these callers are bought here" : ""}</small>
            <div className="aic-list">{cs.map((c) => (
              <div key={c.id} className="aic-row on">
                <span className="grow"><b>{label(c)}</b><small className="muted">buys ${Number(c.usd).toLocaleString("en-US")} per call</small></span>
                <button type="button" className="aic-x" aria-label={`Remove ${label(c)}`} disabled={busy} onClick={() => onAct(`cl${c.id}`, "caller", { op: "remove", id: c.id })}>✕</button>
              </div>
            ))}</div>
          </div>
        ))}</div>
      ) : <small className="muted">No callers yet: every call in your ticked groups is bought.</small>}
      {opts.length > 0 && (
        <small className="muted">{strict.length ? `Only picked callers: ${strict.map((o) => o.title).join(", ")}. ` : ""}{opts.filter((o) => !byGroup.has(o.key)).length ? `Every call (no callers picked yet): ${opts.filter((o) => !byGroup.has(o.key)).map((o) => o.title).join(", ")}.` : ""}</small>
      )}
      {channels.length > 0 && <small className="muted">Channels, every call bought: {channels.join(", ")}.</small>}
      <small className="muted">To find a Telegram user id, forward one of their messages to @userinfobot.</small>
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
const CHAIN_LABEL: Record<string, string> = { bsc: "BNB Chain", ethereum: "Ethereum", robinhood: "Robinhood Chain", elysium: "Elysium", solana: "Solana" };

/** Live chains: switch each on or off, see its wallet address and balance, and make the Solana wallet. */
export function LiveChains({ list, live, relay, busy, onAct }: { list: LiveWallet[]; live: boolean; relay: boolean; busy: boolean; onAct: Act }) {
  const [copied, setCopied] = useState("");
  const on = list.filter((w) => w.on).map((w) => w.chain);
  const toggle = (chain: string, v: boolean) => onAct(`lc${chain}`, "settings", { live_chains: v ? [...on, chain] : on.filter((c) => c !== chain) }, v ? `${CHAIN_LABEL[chain]} on for live trading.` : `${CHAIN_LABEL[chain]} off for live trading.`);
  const copy = (a: string) => { navigator.clipboard?.writeText(a).then(() => { setCopied(a); setTimeout(() => setCopied(""), 1500); }).catch(() => {}); };
  return (
    <div className="aic-block">
      <b>⛓ Live chains</b>
      <small className="muted">{live ? "Live trading buys on the chains switched on here." : "You're in practice mode: these apply once you switch to Live."} Each chain pays with its own coin, so the wallet needs that coin there: BNB on BNB Chain, ETH on Ethereum, ETH on Robinhood Chain, HYPE on Elysium, SOL on Solana. The same address works on BNB Chain, Ethereum, Robinhood Chain and Elysium. Use Move funds below to bridge between them. Calls on a chain that&apos;s off (or has no money) are skipped.</small>
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
      <MoveFunds list={list} relay={relay} busy={busy} onAct={onAct} />
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

/** Bridge the trader's own money between its chains through Relay (low fees, usually seconds). */
function MoveFunds({ list, relay, busy, onAct }: { list: LiveWallet[]; relay: boolean; busy: boolean; onAct: Act }) {
  const evm = list.filter((w) => w.chain !== "solana" && w.address);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(evm[0]?.chain || "bsc");
  const [to, setTo] = useState("elysium");
  const [amount, setAmount] = useState("");
  const [q, setQ] = useState<{ receive: number | null; receiveSymbol: string; feeUsd: number; seconds: number | null } | null>(null);
  const [state, setState] = useState("");
  const [working, setWorking] = useState(false);
  const fw = list.find((w) => w.chain === from);
  const call = async (action: string, body: unknown) => {
    const r = await fetch(`/api/ai-trader/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Something went wrong.");
    return d;
  };
  const getQuote = async () => { setWorking(true); setState(""); setQ(null); try { setQ(await call("relay-quote", { from, to, amount: Number(amount) })); } catch (e) { setState((e as Error).message); } setWorking(false); };
  const move = async () => {
    if (!confirm(`Move ${amount} ${fw?.native} from ${CHAIN_LABEL[from]} to ${CHAIN_LABEL[to]} through Relay?`)) return;
    setWorking(true); setState("Sending…");
    try {
      const r = await call("relay-move", { from, to, amount: Number(amount) });
      setState(r.note || "Sent."); setQ(null); setAmount("");
      if (r.requestId) for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const st = await call("relay-status", { requestId: r.requestId }).catch(() => null);
        if (st?.status === "success") { setState(`✅ Arrived on ${CHAIN_LABEL[to]}.`); break; }
        if (st?.status === "refund") { setState("Relay couldn't complete it and refunded the money to the wallet."); break; }
        if (st?.status) setState(`Moving… (${st.status})`);
      }
      await onAct("refresh", "settings", {}, "");
    } catch (e) { setState((e as Error).message); }
    setWorking(false);
  };
  if (!evm.length) return null;
  if (!open) return <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setOpen(true)}>⇄ Move funds between chains (Relay)</button>;
  return (
    <div className="ait-key">
      <b>⇄ Move funds (Relay bridge)</b>
      {!relay && <small className="aic-warn">Needs a free Relay API key: create one at relay.link (Developers → API keys) and add it in Vercel as <code>RELAY_API_KEY</code>, then redeploy.</small>}
      <small className="muted">Bridges the trader&apos;s own coin to another of its chains, arriving in the same trader&apos;s wallet there, usually within seconds. Example: BNB on BNB Chain → HYPE on Elysium.</small>
      <div className="aic-caller">
        <select className="input" value={from} onChange={(e) => { setFrom(e.target.value); setQ(null); }} aria-label="From chain">
          {evm.map((w) => <option key={w.chain} value={w.chain}>From {CHAIN_LABEL[w.chain]} ({w.balance == null ? "?" : w.balance.toFixed(4)} {w.native})</option>)}
        </select>
        <select className="input" value={to} onChange={(e) => { setTo(e.target.value); setQ(null); }} aria-label="To chain">
          {list.filter((w) => w.chain !== from).map((w) => <option key={w.chain} value={w.chain}>To {CHAIN_LABEL[w.chain]} ({w.native})</option>)}
        </select>
        <span className="ait-in" style={{ width: 150 }}><input inputMode="decimal" placeholder="0.05" value={amount} onChange={(e) => { setAmount(e.target.value); setQ(null); }} aria-label="Amount to move" /><em>{fw?.native}</em></span>
        <button type="button" className="btn small" disabled={working || busy || !relay || !(Number(amount) > 0)} onClick={getQuote}>{working && !q ? "Getting a price…" : "Get price"}</button>
      </div>
      {q && (
        <div className="aic-sent">
          <b>You get about {q.receive ?? "?"} {q.receiveSymbol} on {CHAIN_LABEL[to]}</b>
          <small className="muted">Relay fee about ${q.feeUsd}{q.seconds ? ` · about ${q.seconds}s` : ""}</small>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn small primary" disabled={working} onClick={move}>{working ? "Moving…" : "Move it"}</button>
            <button type="button" className="btn small" onClick={() => setQ(null)}>Cancel</button>
          </div>
        </div>
      )}
      {state && <small className="aic-note" role="status">{state}</small>}
      <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setOpen(false); setQ(null); setState(""); }}>Close</button>
    </div>
  );
}
