import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "SniperRobinhood · Admin", robots: { index: false, follow: false } };

/** SniperRobinhood: paste a Robinhood Chain token; every picked wallet buys it with the dollar coin the moment Uniswap V2 liquidity lands. */
export default async function SniperRobinhoodPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AIFutures desk="liq" net="robinhood" />;
}
