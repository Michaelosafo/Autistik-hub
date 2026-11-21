import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personal RageBNB · Admin (BNB Chain)", robots: { index: false, follow: false } };

/** The owner's own BnbRage: same tool, your own connected wallet, nothing shared with helper admins. */
export default async function PersonalRagePage() {
  const { staff, owner } = await adminState();
  if (!owner) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack rg">
      <TraderTabs />
      <div className="snp-hero">
        <Link href="/admin" className="snp-back">← Admin</Link>
        <h1>🔒 Personal RageBNB — only you</h1>
        <p>Your own BnbRage: deploy a token, add liquidity on PancakeSwap, then remove it, from your own connected wallet. Helper admins can&apos;t see this page.</p>
        <details><summary>How it works</summary><p>Same as BnbRage, locked to BNB Chain (PancakeSwap V2), but it uses the wallet you connect in your browser and nothing here is shared. Your personal sniper is SniperBNB, next to this tab.</p></details>
      </div>
      <AdminDirectPool mode="all" name="Personal RageBNB" />
    </div>
  );
}
