import Link from "next/link";
import TokenLogo from "@/components/TokenLogo";
import type { BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { usd } from "@/lib/market";

/** A short "Trending on AUTISTIK" list: paid slots first, then the busiest tokens. */
export default function TrendingNow({ list, limit = 8 }: { list: BoardToken[]; limit?: number }) {
  const top = list.slice(0, limit);
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>🔥 Trending on AUTISTIK</h3>
        <Link className="btn small" href="/launchpad">See all tokens</Link>
      </div>
      {!top.length ? (
        <div className="empty">No tokens yet. Launch the first one, or pay to list yours.</div>
      ) : (
        <div role="table" aria-label="Trending tokens">
          {top.map((t, n) => {
            const m = t.market;
            return (
              <Link key={t.chain + t.token} href={`/launchpad/${t.chain}/${t.token}`} className="board-row compact" role="row">
                <span className="tname">
                  <span className="muted" style={{ width: 18, textAlign: "right", fontSize: ".8em" }}>{n + 1}</span>
                  <TokenLogo src={m?.imageUrl} symbol={t.symbol} />
                  <div>
                    <b>{t.name}</b>{" "}
                    {t.promotedUntil && <span className="badge">Promoted</span>}{" "}
                    {t.source === "listed" && <span className="badge listed">Listed</span>}
                    <br /><span className="muted" style={{ fontSize: ".82em" }}>${t.symbol} · {CHAINS[t.chain].name}</span>
                  </div>
                </span>
                <span className="n">{usd(m?.priceUsd)}</span>
                <span className={"n " + ((m?.change24h ?? 0) >= 0 ? "up" : "down")}>{m?.change24h == null ? "–" : `${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(1)}%`}</span>
              </Link>
            );
          })}
        </div>
      )}
      <p className="muted" style={{ fontSize: ".8em" }}>&quot;Listed&quot; tokens launched somewhere else and paid to appear here. Do your own research.</p>
    </div>
  );
}
