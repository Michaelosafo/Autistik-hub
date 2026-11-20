import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rage · Admin (BNB Only)", robots: { index: false, follow: false } };

/** BNB Chain only. Deploy, add liquidity, remove liquidity. Uses the admin's own wallet. */
export default async function RagePage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack rg">
      <TraderTabs />
      <div className="snp-hero">
        <Link href="/admin" className="snp-back">← Admin</Link>
        <h1>💧 Rage — BNB Chain Only</h1>
        <p>Deploy a token, add liquidity on PancakeSwap, then remove it when you want. BNB Chain only.</p>
        <details><summary>How it works</summary><p>This tool is locked to BNB Chain (PancakeSwap V2). Connect your admin wallet on BNB, deploy the token, add liquidity with BNB, and remove liquidity later from the same wallet.</p></details>
      </div>
      <AdminDirectPool mode="all" />
    </div>
  );
}
