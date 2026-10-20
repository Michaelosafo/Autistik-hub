import AdBar from "@/components/AdBar";
import Guide from "@/components/Guide";
import Launchpad from "@/components/Launchpad";
import Link from "next/link";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { currentUser } from "@/lib/supabase/server";
import { padSites } from "@/lib/launchpad-server";
import { adminState } from "@/lib/admin";
import PadDeploy from "@/components/PadDeploy";
import ProHero from "@/components/ProHero";
import { liveChains } from "@/lib/launchpad";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board, pads, { admin }] = await Promise.all([currentUser(), getBoard(60), padSites(), adminState()]);
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <ProHero tone="coral" kicker="AUTISTIK · LAUNCH PAD" title="Launch your own token" live={liveChains(pads).length ? "Live" : false}
        text="Free to launch, live in one step: liquidity added and locked, anti-sniper protection and your own first buy. You need $20 of AUTISTIK in your wallet."
        stats={[["Free", "to launch"], ["≤10%", "tax you set"], ["30%", "max first buy"], ["6m · 1y", "lock or burn"]]} />
      <Guide id="launch" title="Launch a coin, in 3 steps" steps={[
        <>Have about <b>$20 of $AUTISTIK</b> in your wallet, plus the {`BNB`} you want to put in the trading pool.</>,
        <>Tell Autistik the name and ticker (or use the quick form). Choose tax (optional, up to 10%), whitelist and lock time.</>,
        <>Sign once. Your coin goes live with liquidity added and locked, then press <b>Start trading</b> when you&apos;re ready.</>,
      ]} tip="Locked liquidity and a fair launch make buyers trust your coin. Never promise profits." />
      <Launchpad signedIn={!!user} pads={pads} />
      {admin && <PadDeploy />}
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
