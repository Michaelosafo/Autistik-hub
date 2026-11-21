import { notFound } from "next/navigation";
import AITrader from "@/components/AITrader";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI trader · Admin", robots: { index: false, follow: false } };

export default async function AITraderPage() {
  const { staff, owner } = await adminState();
  if (!owner) notFound(); // helper admins only get AI Futures and the shared BnbRage
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AITrader />;
}
