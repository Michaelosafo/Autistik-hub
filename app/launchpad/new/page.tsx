import AdBar from "@/components/AdBar";
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
import VideoButton from "@/components/VideoButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch a token · AUTISTIK Hub" };

export default async function NewLaunchPage() {
  const [user, board, pads, { owner, admin }, access] = await Promise.all([currentUser(), getBoard(60), padSites(), adminState(), launchAccess()]);
  return (
    <div className="stack">
      <AdBar ads={toAds(ads(board))} />
      <header className="bd-top ln-top">
        <div>
          <h1>Create a coin</h1>
          <p className="muted">Free to launch. Liquidity locked or burned so it can&apos;t be pulled. Live in a few minutes.{!access.public ? " Coming soon." : ""}</p>
        </div>
        <div className="ln-top-r">
          <VideoButton label="Watch how" title="Launch your coin, step by step" src="/videos/launch-your-coin.mp4" poster="/videos/launch-your-coin.jpg" captions="/videos/launch-your-coin.vtt" minutes={5} />
          <Link href="/board" className="ln-ghost">Open the Board</Link>
        </div>
      </header>
      <ol className="ln-steps" aria-label="How it works">
        <li><i>1</i><span><b>Pick a network and a name</b><small>BNB Chain, Ethereum, Solana and more. Add a picture.</small></span></li>
        <li><i>2</i><span><b>Set your liquidity</b><small>Choose how much goes into the pool, then lock it or burn it.</small></span></li>
        <li><i>3</i><span><b>Sign once, you&apos;re live</b><small>Your coin appears on the Board right away.</small></span></li>
      </ol>
      <div className="ln-facts">
        <span><b>Free</b> to launch</span><span><b>Locked</b> or burned liquidity</span><span><b>≤10%</b> tax, only if you want</span><span>You need <b>$20 of AUTISTIK</b> (BNB Chain) to launch on EVM networks</span>
      </div>
      {!access.allowed ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>Coming soon</b>
          <p className="muted" style={{ margin: 0 }}>The Launch Pad is being tested by the AUTISTIK team and opens to everyone soon. Until then, browse coins on <Link href="/launchpad">Trending</Link>.</p>
        </div>
      ) : (
        <>
          {!access.public && <div className="notice warn">Test mode: only you (the owner) can launch and add liquidity here. Everyone else sees &ldquo;Coming soon&rdquo;. Remove <span className="mono">LAUNCH_PUBLIC=0</span> in Vercel to open it to all.</div>}
          <p className="ln-alt">Already made your token, here or anywhere else? <Link href="/liquidity">Add liquidity by pasting its address</Link></p>
          <Launchpad signedIn={!!user} pads={pads} admin={admin} />
          <AddLiquidity pads={pads} />
        </>
      )}
      {owner && !admin && <div className="notice">Your admin tools (deploy the Launch Pad on a new chain, list tokens) show here after your 2-step code. <Link href="/admin">Enter it on the Admin page</Link>, then come back to this page.</div>}
      {admin && <AdminListTokens />}
      {admin && <PadDeploy />}
      <p className="muted" style={{ fontSize: ".9em" }}>Already launched, or launched somewhere else? See the <Link href="/launchpad">Trending</Link> tab to get your token listed and promoted.</p>
    </div>
  );
}
