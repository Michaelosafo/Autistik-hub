import { notFound } from "next/navigation";
import AIFutures from "@/components/AIFutures";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Turbo · Admin", robots: { index: false, follow: false } };

/** Turbo (high risk): the futures engine at 15x on the most-traded Hyperliquid coins; own wallet and money. */
export default async function AITurboPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <a href="/admin">Admin</a> and confirm your 2-step code, then come back.</p></div>;
  return <AIFutures desk="turbo" />;
}
