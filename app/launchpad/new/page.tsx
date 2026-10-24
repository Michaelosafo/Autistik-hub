import AdBar from "@/components/AdBar";
import Guide from "@/components/Guide";
import Launchpad from "@/components/Launchpad";
import Link from "next/link";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { currentUser } from "@/lib/supabase/server";
import { padSites } from "@/lib/launchpad-server";
import { adminState, launchAccess } from "@/lib/admin";
import AddLiquidity from "@/components/AddLiquidity";
import PadDeploy from "@/components/PadDeploy";
import AdminListTokens from "@/components/AdminListTokens";
import ProHero from "@/components/ProHero";
import HowToVideo from "@/components/HowToVideo";
import { liveChains } from "@/lib/launchpad";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board, pads, { owner, admin }, access] = await Promise.all([currentUser(), getBoard(60), padSites(), adminState(), launchAccess()]);
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <ProHero tone="coral" kicker="AUTISTIK · LAUNCH PAD" title="Launch your own token" live={!access.public ? "Coming soon" : liveChains(pads).length ? "Live" : false}
        text="Free to launch, live in one step: liquidity added and locked, anti-sniper protection and your own first buy. You need $20 of AUTISTIK in your wallet."
        stats={[["Free", "to launch"], ["≤10%", "tax you set"], ["30%", "max first buy"], ["6m · 1y", "lock or burn"]]} />
      <HowToVideo title="Watch: launch your coin, step by step" src="/videos/launch-your-coin.mp4" poster="/videos/launch-your-coin.jpg" captions="/videos/launch-your-coin.vtt" minutes={5} />
      <Guide id="launch" title="Launch a coin, in 3 steps" steps={[
        <>Have about <b>$20 of $AUTISTIK</b> in your wallet, plus the {`BNB`} you want to put in the trading pool.</>,
        <>Tell Autistik the name and ticker (or use the quick form). Choose tax (optional, up to 10%), whitelist and lock time.</>,
        <>Sign once. Your coin goes live with liquidity added and locked, then press <b>Start trading</b> when you&apos;re ready.</>,
      ]} tip="Locked liquidity and a fair launch make buyers trust your coin. Never promise profits." />
      {!access.allowed ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>🚀 Coming soon</b>
          <p className="muted" style={{ margin: 0 }}>The Launch Pad is being tested by the AUTISTIK team and opens to everyone soon. Until then, browse coins on <Link href="/launchpad">Trending</Link>.</p>
        </div>
      ) : (
        <>
          {!access.public && <div className="notice warn">🔒 Test mode: only you (the owner) can launch and add liquidity here. Everyone else sees &ldquo;Coming soon&rdquo;. Remove <span className="mono">LAUNCH_PUBLIC=0</span> in Vercel to open it to all.</div>}
          <div className="notice">💧 Already made your token (here or anywhere else)? <Link href="/liquidity"><b>Add liquidity by pasting its address →</b></Link></div>
          <Launchpad signedIn={!!user} pads={pads} admin={admin} />
          <AddLiquidity pads={pads} />
        </>
      )}
      {owner && !admin && <div className="notice">🛠️ Your admin tools (deploy the Launch Pad on a new chain, list tokens) show here after your 2-step code. <Link href="/admin">Enter it on the Admin page</Link>, then come back to this page.</div>}
      {admin && <AdminListTokens />}
      {admin && <PadDeploy />}
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
