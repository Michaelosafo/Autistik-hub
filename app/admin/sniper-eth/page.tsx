import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "SniperEth · Admin", robots: { index: false, follow: false } };

/** SniperEth: paste a Ethereum token; every picked wallet buys it with the dollar coin the moment Uniswap V2 liquidity lands. */
export default async function SniperEthPage() {
  const { staff, owner } = await adminState();
  // Owner only (admins you add see the BNB Chain tools only).
  if (!owner) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AIFutures desk="liq" net="ethereum" />;
}
