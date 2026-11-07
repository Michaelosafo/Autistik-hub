import AdBar from "@/components/AdBar";
import Launchpad from "@/components/Launchpad";
import Link from "next/link";
import { ads, getBoard } from "@/lib/board";
import { toAds } from "@/lib/ads";
import { currentUser } from "@/lib/supabase/server";
import { padInfo } from "@/lib/launchpad-server";
import { adminState, launchAccess } from "@/lib/admin";
import AddLiquidity from "@/components/AddLiquidity";
import PadDeploy from "@/components/PadDeploy";
import PadTestnetTrial from "@/components/PadTestnetTrial";
import LaunchChoice from "@/components/InstantLaunch";
import InstantAdmin from "@/components/InstantAdmin";
import AdminListTokens from "@/components/AdminListTokens";
import VideoButton from "@/components/VideoButton";
import DevPerks from "@/components/DevPerks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board, { pads, versions, instants, instantVersions }, { owner, admin }, access] = await Promise.all([currentUser(), getBoard(60), padInfo(), adminState(), launchAccess()]);
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <header className="bd-top ln-top">
        <div>
          <h1>Create a coin</h1>
          <p className="muted">Free to launch. Pick one of two ways below; tap More to read how it works.{!access.public ? " Coming soon." : ""}</p>
        </div>
        <div className="ln-top-r">
          <VideoButton label="Watch how" title="Launch your coin, step by step" src="/videos/launch-your-coin.mp4" poster="/videos/launch-your-coin.jpg" captions="/videos/launch-your-coin.vtt" minutes={5} />
          <Link href="/board" className="ln-ghost">Open the Board</Link>
        </div>
      </header>
      {!access.allowed ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>Coming soon</b>
          <p className="muted" style={{ margin: 0 }}>The Launch Pad is being tested by the AUTISTIK team and opens to everyone soon. Until then, browse coins on <Link href="/launchpad">Trending</Link>.</p>
        </div>
      ) : (
        <>
          {!access.public && <div className="notice warn">Test mode: only you (the owner) can launch and add liquidity here. Everyone else sees &ldquo;Coming soon&rdquo;. Remove <span className="mono">LAUNCH_PUBLIC=0</span> in Vercel to open it to all.</div>}
          <DevPerks />
          {/* Instant opens first (just a name, picture and info). The liquidity form and tools only show under Add liquidity. */}
          <LaunchChoice instants={{ bsc: instants.bsc, ethereum: instants.ethereum, robinhood: instants.robinhood }} instantVersions={instantVersions} admin={admin}>
            <div className="stack">
              <p className="ln-alt">Already made your token, here or anywhere else? <Link href="/liquidity">Add liquidity by pasting its address</Link></p>
              <Launchpad signedIn={!!user} pads={pads} versions={versions} admin={admin} />
              <AddLiquidity pads={pads} />
            </div>
          </LaunchChoice>
        </>
      )}
      {owner && !admin && <div className="notice">Your admin tools (deploy the Launch Pad on a new chain, list tokens) show here after your 2-step code. <Link href="/admin">Enter it on the Admin page</Link>, then come back to this page.</div>}
      {admin && <AdminListTokens />}
      {admin && <PadDeploy />}
      {admin && <PadTestnetTrial />}
      {admin && <InstantAdmin />}
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
