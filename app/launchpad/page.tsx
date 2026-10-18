import Link from "next/link";
import AdBar from "@/components/AdBar";
import SectionCards, { LAUNCH_CARDS } from "@/components/SectionCards";
import TokenBoard from "@/components/TokenBoard";
import TrendingPay from "@/components/TrendingPay";
import { ads, getBoard, mostWatched, trending } from "@/lib/board";
import { toAds } from "@/lib/ads";
import ProHero from "@/components/ProHero";
import { usd } from "@/lib/market";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trending · AUTISTIK Hub" };

export default async function LaunchpadPage() {
  const board = await getBoard();
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <SectionCards items={LAUNCH_CARDS} active="/launchpad" label="Launch" />
      <ProHero tone="violet" kicker="AUTISTIK · TRENDING" title="Trending on AUTISTIK" live="Live"
        text={<>Tokens launched here have their liquidity locked or burned, so it can&apos;t be pulled early. Tokens marked Listed launched elsewhere and paid to be listed.</>}
        stats={[[board.length, "tokens on the board"], [board.filter((t) => t.promotedUntil).length, "promoted now"], [usd(board.reduce((s, t) => s + (t.market?.volume24h ?? 0), 0)), "24h volume"]]}>
        <div className="an-actions"><Link className="btn primary" href="/analytics">📊 Analytics: top wallets</Link><Link className="btn" href="/launchpad/new">🚀 Launch a token</Link></div>
      </ProHero>
      <TokenBoard lists={{ trending: trending(board), watched: mostWatched(board), new: board }} />
      <TrendingPay />
    </div>
  );
}
