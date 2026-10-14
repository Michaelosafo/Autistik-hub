import AdBar from "@/components/AdBar";
import Launchpad from "@/components/Launchpad";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board] = await Promise.all([currentUser(), getBoard(60)]);
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <div className="page-head">
        <div className="label">AUTISTIK Launch Pad</div>
        <h1>Launch your own token</h1>
        <p className="muted">Tell Autistik about your token and sign one transaction. It goes live on PancakeSwap, Uniswap or Robinhood Chain with its liquidity locked forever, then shows up on DexScreener.</p>
      </div>
      <Launchpad signedIn={!!user} />
    </div>
  );
}
