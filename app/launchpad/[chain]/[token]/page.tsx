import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import AdBar from "@/components/AdBar";
import TrendingPay from "@/components/TrendingPay";
import TokenLogo from "@/components/TokenLogo";
import UnlockButton from "@/components/UnlockButton";
import WatchButton from "@/components/WatchButton";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { CHAINS, LOCKS, dexscreenerUrl, isLock, isLive, type ChainKey } from "@/lib/launchpad";
import { getMarkets, usd } from "@/lib/market";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TokenPage({ params }: { params: { chain: string; token: string } }) {
  const c = CHAINS[params.chain as ChainKey];
  if (!c || !isAddress(params.token)) notFound();
  const token = getAddress(params.token);
  const sb = supabaseServer();
  const [{ data: launch }, { data: { user } }, board] = await Promise.all([
    sb.from("launches").select("*").eq("chain", c.key).eq("token", token).maybeSingle(),
    sb.auth.getUser(),
    getBoard(60),
  ]);
  if (!launch) notFound();

  const now = new Date().toISOString();
  const [markets, { data: count }, { data: mine }, { data: promo }] = await Promise.all([
    getMarkets([{ chain: c.key, token }]),
    sb.from("launch_watch_counts").select("watchers").eq("chain", c.key).eq("token", token).maybeSingle(),
    user ? sb.from("launch_watchers").select("token").eq("chain", c.key).eq("token", token).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("launch_promotions").select("ends_at").eq("chain", c.key).eq("token", token).gt("ends_at", now).order("ends_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const m = markets[token.toLowerCase()];
  const promotedUntil = promo?.ends_at ?? null;
  const swap = c.swapUrl(token);
  const listed = launch.source === "listed";
  const lock = isLock(launch.lp_lock) ? launch.lp_lock : "burn";
  const lockNote = listed ? "" : lock === "burn" ? "🔥 burned forever" : launch.lp_unlock_at && Date.parse(launch.lp_unlock_at) > Date.now() ? `🔒 locked until ${new Date(launch.lp_unlock_at).toLocaleDateString()}` : "🔓 lock ended";

  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board)).filter((a) => a.token !== token)} />
      <Link href="/launchpad" className="muted" style={{ fontSize: ".9em" }}>← All tokens</Link>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row" style={{ gap: 14 }}>
          <TokenLogo src={m?.imageUrl} symbol={launch.symbol} big />
          <div className="page-head" style={{ gap: 2 }}>
            <div className="label">{c.name} · {c.dex}{promotedUntil && <> · <span className="badge">Promoted</span></>}</div>
            <h1 style={{ margin: 0 }}>{launch.name} <span className="muted">${launch.symbol}</span></h1>
          </div>
        </div>
        <WatchButton uid={user?.id ?? null} chain={c.key} token={token} watching={!!mine} count={count?.watchers ?? 0} />
      </div>

      <div className="stats">
        <div><span className="label">Price</span><b>{usd(m?.priceUsd)}</b></div>
        <div><span className="label">24h</span><b className={(m?.change24h ?? 0) >= 0 ? "up" : "down"}>{m?.change24h == null ? "–" : `${m.change24h >= 0 ? "+" : ""}${m.change24h.toFixed(1)}%`}</b></div>
        <div><span className="label">Market cap</span><b>{usd(m?.marketCap)}</b></div>
        <div><span className="label">Liquidity</span><b>{usd(m?.liquidityUsd)}</b> <span className="muted" style={{ fontSize: ".75em" }}>{lockNote}</span></div>
        <div><span className="label">Volume 24h</span><b>{usd(m?.volume24h)}</b></div>
        <div><span className="label">Trades 24h</span><b>{m ? m.txns24h.toLocaleString("en-US") : "–"}</b></div>
      </div>

      <div className="kai lp">
        <div className="stack">
          {c.dexscreener ? (
            <iframe className="chart" title={`${launch.symbol} price chart`} src={`https://dexscreener.com/${c.dexscreener}/${launch.pair}?embed=1&theme=dark&trades=0&info=0`} loading="lazy" />
          ) : <div className="empty">Charts for {c.name} open on DexScreener.</div>}
          <div className="card stack" style={{ fontSize: ".9em" }}>
            <div className="field"><span>Contract address</span><span className="mono" style={{ overflowWrap: "anywhere" }}>{token}</span></div>
            <div className="row" style={{ gap: 6 }}>
              {swap && <a className="btn small primary" href={swap} target="_blank" rel="noopener noreferrer">Trade on {c.dex}</a>}
              <a className="btn small" href={dexscreenerUrl(c, launch.pair, token)} target="_blank" rel="noopener noreferrer">DexScreener</a>
              <a className="btn small" href={`${c.explorer}/token/${token}`} target="_blank" rel="noopener noreferrer">Explorer</a>
            </div>
            {listed ? (
              <p className="muted">Listed on {new Date(launch.created_at).toLocaleDateString()}. This token was launched somewhere else, not on the AUTISTIK Launch Pad, so we don&apos;t know its tax, owner or liquidity lock. Check the contract on the explorer before buying.</p>
            ) : <p className="muted">Launched {new Date(launch.created_at).toLocaleDateString()} with a fixed supply of {BigInt(launch.supply).toLocaleString("en-US")}. No tax, no minting, no owner. {lock === "burn" ? "The liquidity was burned at launch, so it stays in the pool forever." : `Liquidity: ${LOCKS[lock].short.toLowerCase()} in the Launch Pad contract.`}</p>}
          </div>
        </div>
        <div className="stack">
          <TrendingPay chain={c.key} token={token} promotedUntil={promotedUntil} />
          {!listed && lock !== "burn" && launch.lp_unlock_at && <UnlockButton chain={c.key} token={token} creator={launch.creator} unlockAt={launch.lp_unlock_at} />}
          <div className="notice warn" style={{ fontSize: ".86em" }}>{listed ? "Listed by a paid promotion, not checked by the AUTISTIK team." : "Made by a community member, not the AUTISTIK team."} Token prices can go to zero. Nothing here is financial advice.</div>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: { params: { chain: string; token: string } }) {
  return { title: `Token · AUTISTIK Launch Pad`, description: `${params.token} on ${CHAINS[params.chain as ChainKey]?.name ?? "the Launch Pad"}` };
}
