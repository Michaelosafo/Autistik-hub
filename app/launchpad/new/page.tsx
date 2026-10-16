import AdBar from "@/components/AdBar";
import Launchpad from "@/components/Launchpad";
import SectionTabs, { TRENDING_TABS } from "@/components/SectionTabs";
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
      <SectionTabs tabs={TRENDING_TABS} active="/launchpad/new" label="Launch Pad" />
      <div className="page-head">
        <h1>Launch your token</h1>
        <p className="muted">Chat with Autistik, then sign once. Hold $20 of AUTISTIK to launch.</p>
      </div>
      <Launchpad signedIn={!!user} />
    </div>
  );
}
