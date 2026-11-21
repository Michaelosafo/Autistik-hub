import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "BnbRage · Admin (BNB Chain)", robots: { index: false, follow: false } };

/** BNB Chain only, shared: the owner and every helper admin use the same team wallets and the same saved CAs. */
export default async function RagePage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack rg">
      <TraderTabs />
      <div className="snp-hero">
        <Link href="/admin" className="snp-back">← Admin</Link>
        <h1>💧 BnbRage — BNB Chain only</h1>
        <p>Deploy a token, add liquidity on PancakeSwap, then remove it when you want. Shared: you and the owner (or your helper admins) see and use the same wallets and tokens.</p>
        <details><summary>How it works</summary><p>Locked to BNB Chain (PancakeSwap V2). Pick a team wallet (or add one), deploy the token, add liquidity and the first buy with USDT, and remove liquidity later. A wallet or token one admin adds shows for everyone, and anyone on the team can carry on where another left off.</p></details>
      </div>
      <AdminDirectPool mode="all" team />
    </div>
  );
}
