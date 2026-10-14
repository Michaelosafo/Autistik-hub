"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TokenLogo from "@/components/TokenLogo";
import type { BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { usd } from "@/lib/market";

type Tab = "trending" | "watched" | "new";
const TABS: [Tab, string][] = [["trending", "🔥 Trending"], ["watched", "👀 Most watched"], ["new", "✨ New"]];

export default function TokenBoard({ lists }: { lists: Record<Tab, BoardToken[]> }) {
  const [tab, setTab] = useState<Tab>("trending");
  const router = useRouter();
  // Prices come from DexScreener; refresh them every minute while the page is open.
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  const list = lists[tab];

  return (
    <div className="card stack">
      <div className="row" role="tablist" aria-label="Token lists">
        {TABS.map(([id, label]) => (
          <button key={id} className="btn small toggle" type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {!list.length ? (
        <div className="empty">{tab === "watched" ? "Nobody is watching a token yet. Open a token and press Watch." : "No tokens yet. Be the first to launch!"}</div>
      ) : (
        <div role="table" aria-label={TABS.find((t) => t[0] === tab)![1]}>
          <div className="board-row head" role="row">
            <span>Token</span><span className="n">Price</span><span className="n hide-sm">24h</span><span className="n hide-sm">Market cap</span><span className="n hide-sm">Volume 24h</span><span className="n">Watch</span>
          </div>
          {list.map((t, n) => {
            const m = t.market;
            return (
              <Link key={t.chain + t.token} href={`/launchpad/${t.chain}/${t.token}`} className="board-row" role="row">
                <span className="tname">
                  <span className="muted hide-sm" style={{ width: 18, textAlign: "right", fontSize: ".8em" }}>{n + 1}</span>
                  <TokenLogo src={m?.imageUrl} symbol={t.symbol} />
                  <div><b>{t.name}</b> {tab === "trending" && t.promotedUntil && <span className="badge">Promoted</span>} {t.source === "listed" && <span className="badge listed">Listed</span>}<br /><span className="muted" style={{ fontSize: ".82em" }}>${t.symbol} · {CHAINS[t.chain].name}</span></div>
                </span>
                <span className="n">{usd(m?.priceUsd)}</span>
                <span className={"n hide-sm " + ((m?.change24h ?? 0) >= 0 ? "up" : "down")}>{m?.change24h == null ? "–" : `${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(1)}%`}</span>
                <span className="n hide-sm">{usd(m?.marketCap)}</span>
                <span className="n hide-sm">{usd(m?.volume24h)}</span>
                <span className="n">👀 {t.watchers}</span>
              </Link>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ fontSize: ".8em" }}>Prices from DexScreener, updated every minute. &quot;Promoted&quot; tokens paid to appear at the top. Tokens are made by community members, not the AUTISTIK team. Do your own research.</p>
    </div>
  );
}
