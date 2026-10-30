"use client";
/**
 * Dev wallets you checked in the Scanner, kept in this browser so you can go back to them in one tap.
 * <RememberDev> saves one when its page opens; <RecentDevs> lists them under "Check dev".
 */
import Link from "next/link";
import { useEffect, useState } from "react";

type Dev = { chain: string; wallet: string; score: number | null; label: string | null; at: number };
const KEY = "scanner-recent-devs";
const read = (): Dev[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

export function RememberDev({ chain, wallet, score, label }: { chain: string; wallet: string; score: number | null; label: string | null }) {
  useEffect(() => {
    try {
      const rest = read().filter((d) => !(d.chain === chain && d.wallet.toLowerCase() === wallet.toLowerCase()));
      localStorage.setItem(KEY, JSON.stringify([{ chain, wallet, score, label, at: Date.now() }, ...rest].slice(0, 12)));
    } catch {}
  }, [chain, wallet, score, label]);
  return null;
}

export default function RecentDevs({ names }: { names: Record<string, string> }) {
  const [list, setList] = useState<Dev[]>([]);
  useEffect(() => setList(read()), []);
  if (!list.length) return null;
  return (
    <div className="recent-devs">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <small>Recently checked devs</small>
        <button type="button" className="linkish" onClick={() => { try { localStorage.removeItem(KEY); } catch {} setList([]); }}>Clear</button>
      </div>
      {list.map((d) => (
        <Link key={d.chain + d.wallet} href={`/analytics/dev/${d.chain}/${d.wallet}`} className="recent-dev">
          <b className="mono">{short(d.wallet)}</b>
          <small>{names[d.chain] || d.chain}{d.label ? ` · ${d.label}` : ""}</small>
          {d.score != null && <span className="recent-dev-score">{d.score}</span>}
        </Link>
      ))}
    </div>
  );
}
