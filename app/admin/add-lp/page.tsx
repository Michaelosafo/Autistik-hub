import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add LP · Admin", robots: { index: false, follow: false } };

/** Owner admin session: add liquidity on BNB Chain only. Removing it is a separate tab. */
export default async function AddLpPage() {
  const { staff, owner } = await adminState();
  if (!owner) notFound(); // helper admins only get AI Futures and the shared BnbRage
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack">
      <TraderTabs />
      <div className="page-head">
        <div className="label">Admin · add liquidity</div>
        <h1>Add LP</h1>
        <p className="muted">Add liquidity for the token you deployed in BnbRage. BNB Chain only (PancakeSwap). The LP stays in your wallet.</p>
      </div>
      {owner ? <AdminDirectPool mode="add" /> : <div className="notice">Only the owner can add liquidity here.</div>}
    </div>
  );
}
