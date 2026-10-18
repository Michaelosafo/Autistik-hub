import AdBar from "@/components/AdBar";
import Launchpad from "@/components/Launchpad";
import Link from "next/link";
import SectionCards, { LAUNCH_CARDS } from "@/components/SectionCards";
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
      <SectionCards items={LAUNCH_CARDS} active="/launchpad/new" label="Launch" />
      <AdBar ads={toAds(ads(board))} />
      <ProHero tone="coral" kicker="AUTISTIK · LAUNCH PAD" title="Launch your own token" live={liveChains(pads).length ? "Live" : false}
        text="Free to launch, live in one step: liquidity added and locked, anti-sniper protection and your own first buy. You need $20 of AUTISTIK in your wallet."
        stats={[["Free", "to launch"], ["≤10%", "tax you set"], ["30%", "max first buy"], ["6m · 1y", "lock or burn"]]} />
      <Launchpad signedIn={!!user} pads={pads} />
      {admin && <PadDeploy />}
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
