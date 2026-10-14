import Link from "next/link";
import AdBar from "@/components/AdBar";
import TokenBoard from "@/components/TokenBoard";
import { ads, getBoard, mostWatched, trending } from "@/lib/board";
import { toAds } from "@/lib/ads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch Pad · AUTISTIK Hub" };

export default async function LaunchpadPage() {
  const board = await getBoard();
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <div className="page-head">
          <div className="label">AUTISTIK Launch Pad</div>
          <h1>Tokens launched by the community</h1>
          <p className="muted">Every token here launched with its liquidity locked or burned, so it can&apos;t be pulled early. See what&apos;s trending, what people are watching, and what&apos;s new.</p>
        </div>
        <Link className="btn primary" href="/launchpad/new">🚀 Launch a token</Link>
      </div>
      <TokenBoard lists={{ trending: trending(board), watched: mostWatched(board), new: board }} />
    </div>
  );
}
