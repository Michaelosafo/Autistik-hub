import { notFound } from "next/navigation";
import AITrader from "@/components/AITrader";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI trader · Admin", robots: { index: false, follow: false } };

export default async function AITraderPage() {
  const { admin } = await adminState();
  if (!admin) notFound();
  return <AITrader />;
}
