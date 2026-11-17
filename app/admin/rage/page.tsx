import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rage · Admin", robots: { index: false, follow: false } };

/** Owner admin session: deploy, add liquidity, then ask to remove it. One flow. */
export default async function RagePage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack">
      <TraderTabs />
      <div className="page-head">
        <div className="label">Admin · live BNB Chain</div>
        <h1>Rage</h1>
        <p className="muted">Deploy the token, add the liquidity, then it asks if you want to remove that liquidity.</p>
      </div>
      {owner ? <AdminDirectPool mode="all" /> : <div className="notice">Only the owner can use Rage.</div>}
    </div>
  );
}
