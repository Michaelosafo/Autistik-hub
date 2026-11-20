import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "SniperLobbySol · Admin", robots: { index: false, follow: false } };

/** SniperLobbySol: paste a Solana token; every picked wallet buys it with USDT the moment it can be bought. Own wallets. */
export default async function SniperLobbySolPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AIFutures desk="liq" net="solana" />;
}
