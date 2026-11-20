import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Remove LP · Admin", robots: { index: false, follow: false } };

/** Owner admin session: remove liquidity that is sitting in the connected wallet, on BNB Chain only. */
export default async function RemoveLpPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack">
      <TraderTabs />
      <div className="page-head">
        <div className="label">Admin · remove liquidity</div>
        <h1>Remove LP</h1>
        <p className="muted">Take liquidity back out of the wallet that holds it. BNB Chain only (PancakeSwap). The tokens and BNB return to your wallet.</p>
      </div>
      {owner ? <AdminDirectPool mode="remove" /> : <div className="notice">Only the owner can remove liquidity here.</div>}
    </div>
  );
}
