import Link from "next/link";
import AdBar from "@/components/AdBar";
import SectionTabs, { TRENDING_TABS } from "@/components/SectionTabs";
import TokenBoard from "@/components/TokenBoard";
import TrendingPay from "@/components/TrendingPay";
import { ads, getBoard, mostWatched, trending } from "@/lib/board";
import { toAds } from "@/lib/ads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trending · AUTISTIK Hub" };

export default async function LaunchpadPage() {
  const board = await getBoard();
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <SectionTabs tabs={TRENDING_TABS} active="/launchpad" label="Trending" />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="page-head">
          <h1>Trending on AUTISTIK</h1>
          <p className="muted">Liquidity locked or burned. &quot;Listed&quot; means launched elsewhere.</p>
        </div>
        <Link className="btn primary" href="/launchpad/new">🚀 Launch a token</Link>
      </div>
      <TokenBoard lists={{ trending: trending(board), watched: mostWatched(board), new: board }} />
      <TrendingPay />
    </div>
  );
}
