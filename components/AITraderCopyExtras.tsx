"use client";
/**
 * Parts of the AI trader's copy trading panel: which sources it trades (Telegram only by default), callers whose
 * posts buy a set dollar amount, and the dump re-buy for new projects.
 */
import { useState } from "react";

type Act = (name: string, action: string, body: unknown, done?: string) => Promise<void>;
export type Caller = { id: number; platform: "tg" | "x"; who: string; usd: number };
export type Rebuy = { id: number; chain: string; token: string; symbol: string | null; sold_usd: number; low_usd: number | null; status: string; note: string | null; sold_at: string };

const MODES = [
  { k: "telegram", name: "Telegram only", note: "Buys only coins called in your ticked Telegram chats. No scanning." },
  { k: "x", name: "X only", note: "Buys only coins posted by your followed X accounts, Lists and Communities." },
  { k: "general", name: "General", note: "Copy trades plus the AI's own scanning and DexScreener signals." },
] as const;

export function ModePicker({ mode, busy, onAct }: { mode: string; busy: boolean; onAct: Act }) {
  const cur = MODES.find((m) => m.k === mode) || MODES[0];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <small className="muted">What it trades</small>
      <div className="ait-seg aic-tabs" role="radiogroup" aria-label="What the trader trades">
        {MODES.map((m) => (
          <button key={m.k} type="button" role="radio" aria-checked={cur.k === m.k} className={cur.k === m.k ? "on" : ""} disabled={busy}
            onClick={() => cur.k !== m.k && onAct("mode", "settings", { trade_mode: m.k }, `${m.name}: ${m.note}`)}>{m.name}</button>
        ))}
      </div>
      <small className="muted">{cur.note}</small>
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
