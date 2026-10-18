import AdBar from "@/components/AdBar";
import Launchpad from "@/components/Launchpad";
import Link from "next/link";
import SectionCards, { LAUNCH_CARDS } from "@/components/SectionCards";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board] = await Promise.all([currentUser(), getBoard(60)]);
  return (
    <div className="stack">
      <SectionCards items={LAUNCH_CARDS} active="/launchpad/new" label="Launch" />
      <AdBar ads={toAds(ads(board))} />
      <div className="page-head">
        <h1>Launch your own token</h1>
        <p className="muted">Live in one step. You need $20 of AUTISTIK in your wallet.</p>
      </div>
      <Launchpad signedIn={!!user} />
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
