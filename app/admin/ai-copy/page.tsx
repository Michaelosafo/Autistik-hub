import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Copy · Admin", robots: { index: false, follow: false } };

/** Copy: copies Solana wallets you pick, buys when they buy and sells when they sell. */
export default async function AICopyPage() {
  const { staff, owner } = await adminState();
  if (!owner) notFound(); // helper admins only get AI Futures and the shared BnbRage
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AIFutures desk="copy" />;
}
