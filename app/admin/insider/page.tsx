import Link from "next/link";
import { notFound } from "next/navigation";
import Insider from "@/components/Insider";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insider · Admin", robots: { index: false, follow: false } };

/** Tracked public posts, caller scores, and paper or live buys from the owner's sniper wallets. */
export default async function InsiderPage() {
  const { staff, owner, helper } = await adminState();
  if (!owner && !helper) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link> and confirm your 2-step code, then come back.</p></div>;
  return (
    <div className="stack">
      <div className="page-head">
        <div className="label">Admin · calls</div>
        <h1>Insider</h1>
        <p className="muted">Watches public accounts you add, scores them from what the price did afterwards, and can buy with your sniper wallets. Paper mode is on until you turn it off. Nothing here posts, replies, or hides a wallet.</p>
      </div>
      <Insider />
    </div>
  );
}
