import Link from "next/link";
import { notFound } from "next/navigation";
import Launchpad from "@/components/Launchpad";
import AddLiquidity from "@/components/AddLiquidity";
import TestnetLiquidity from "@/components/TestnetLiquidity";
import { adminState } from "@/lib/admin";
import { currentUser } from "@/lib/supabase/server";
import { padInfo } from "@/lib/launchpad-server";
import type { Pads } from "@/lib/launchpad";

export const dynamic = "force-dynamic";
export const metadata = { title: "BSC token · Admin", robots: { index: false, follow: false } };

/**
 * Admin only: launch a BNB Chain token (buy and sell tax, tax wallet, liquidity added and locked in one go), add more
 * liquidity straight through PancakeSwap, and try add + remove liquidity on testnet first.
 */
export default async function AdminTokenPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  const [user, { pads, versions }] = await Promise.all([currentUser(), padInfo()]);
  const bsc: Pads = pads.bsc ? { bsc: pads.bsc } : {};
  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">Admin · BNB Chain</div>
        <h1>🪙 Launch a BSC token</h1>
        <p className="muted">Set the name, supply, buy tax and sell tax (max 10% each) and the wallet that receives the tax. The token deploys and its PancakeSwap pool is created in one step. Then add more liquidity below from the same wallet.</p>
      </div>
      {bsc.bsc ? (
        <>
          <Launchpad signedIn={!!user} pads={bsc} versions={{ bsc: versions.bsc }} admin />
          <AddLiquidity pads={bsc} chain="bsc" />
        </>
      ) : (
        <div className="notice warn">The Launch Pad isn&apos;t deployed on BNB Chain yet. Deploy it from the admin tools at the bottom of <Link href="/launchpad/new">the Launch page</Link>.</div>
      )}
      <TestnetLiquidity />
    </div>
  );
}
