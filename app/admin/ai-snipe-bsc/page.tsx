import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "SniperBNB · Admin", robots: { index: false, follow: false } };

/** BSC Sniper: paste a token before its liquidity is added; buys the moment liquidity lands. Every admin, each with their own wallets. */
export default async function BscSniperPage({ searchParams }: { searchParams: { g?: string } }) {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  // Under BnbRage it's the team's sniper (shared wallets and tokens, like BnbRage); ?g=personal is each admin's own.
  return <AIFutures desk="liq" team={searchParams.g !== "personal"} />;
}
