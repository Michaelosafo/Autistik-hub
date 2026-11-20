import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminSolPool from "@/components/AdminSolPool";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "LobbySol · Admin (Solana)", robots: { index: false, follow: false } };

/** LobbySol: its own Solana tool (separate from Rage, which is BNB Chain only). Deploy, add liquidity on Raydium, remove it. */
export default async function LobbySolPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack rg">
      <TraderTabs />
      <div className="snp-hero" style={{ background: "linear-gradient(135deg, #9945FF, #14F195)" }}>
        <Link href="/admin" className="snp-back">← Admin</Link>
        <h1>🟣 LobbySol</h1>
        <p>Deploy a Solana token, add liquidity on Raydium, then remove it when you want. Solana only.</p>
        <details><summary>How it works</summary><p>Connect your own Solana wallet (Phantom, Solflare or Bitget). Deploy the token with an optional tax (only your wallet can collect it), add liquidity with SOL, and remove it later from the same wallet. Every step is signed in your wallet.</p></details>
      </div>
      <div className="card stack" style={{ gap: 10 }}>
        <div className="notice" style={{ fontWeight: 700 }}>Network: Solana · SOL</div>
        <AdminSolPool mode="all" name="LobbySol" />
      </div>
    </div>
  );
}
