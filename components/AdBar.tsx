"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import TokenLogo from "@/components/TokenLogo";
import { CHAINS, type ChainKey } from "@/lib/launchpad";

export type Ad = { chain: ChainKey; token: string; name: string; symbol: string; imageUrl: string | null; change24h: number | null; promotedUntil: string };

/** Paid trending tokens, one at a time. Each one drops off by itself the moment its time runs out. */
export default function AdBar({ ads }: { ads: Ad[] }) {
  const [now, setNow] = useState(() => Date.now());
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); setI((n) => n + 1); }, 6000);
    return () => clearInterval(t);
  }, []);
  const live = ads.filter((a) => Date.parse(a.promotedUntil) > now);
  if (!live.length) return null;
  const a = live[i % live.length];
  return (
    <div className="adbar" role="region" aria-label="Trending tokens (paid)">
      <span className="badge">Ad · Trending</span>
      <Link href={`/launchpad/${a.chain}/${a.token}`}>
        <TokenLogo src={a.imageUrl} symbol={a.symbol} />
        <span className="ad-name"><b>{a.name}</b> <span className="muted">${a.symbol} · {CHAINS[a.chain].name}</span></span>
        {a.change24h !== null && <span className={a.change24h >= 0 ? "up" : "down"}>{a.change24h >= 0 ? "+" : ""}{a.change24h.toFixed(1)}%</span>}
      </Link>
      {live.length > 1 && <span className="dots" aria-hidden="true">{live.map((x, n) => <i key={x.chain + x.token} data-on={n === i % live.length ? "1" : "0"} />)}</span>}
    </div>
  );
}
