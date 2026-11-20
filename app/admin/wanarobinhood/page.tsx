import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminDirectPool from "@/components/AdminDirectPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "WanaRobinhood · Admin (Robinhood Chain)", robots: { index: false, follow: false } };

/** WanaRobinhood: BnbRage on Robinhood Chain (Uniswap V2). Deploy, add liquidity, first buy, remove. The admin's own wallet signs each step. */
export default async function WanaRobinhoodPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack rg">
      <TraderTabs />
      <div className="snp-hero" style={{ background: "linear-gradient(135deg, #00C805, #111827)" }}>
        <Link href="/admin" className="snp-back">← Admin</Link>
        <h1>🪶 WanaRobinhood — Robinhood Chain only</h1>
        <p>Deploy a token, add liquidity on Uniswap V2, then remove it when you want. Robinhood Chain only.</p>
        <details><summary>How it works</summary><p>Connect your admin wallet on Robinhood Chain. Deploy the token (optional buy and sell tax), add liquidity paid in the dollar coin (it&apos;s swapped to ETH for the token/ETH pool so the tax works), make the first buy, which opens trading, and remove the liquidity later from the same wallet. ETH is only used for gas.</p></details>
      </div>
      <AdminDirectPool mode="all" chain="robinhood" name="WanaRobinhood" />
    </div>
  );
}
