import Link from "next/link";
import { notFound } from "next/navigation";
import TraderTabs from "@/components/TraderTabs";
import AdminMonitor from "@/components/AdminMonitor";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitor · Admin", robots: { index: false, follow: false } };

/** Owner-only, MFA-gated BNB Chain wallet monitor. */
export default async function MonitorPage() {
  const { owner, staff } = await adminState();
  if (!owner) notFound();
  if (!staff) return <div className="card stack"><b>Enter your 2-step code first</b><p className="muted">Open <Link href="/admin">Admin</Link>, confirm your authenticator code, then return here.</p></div>;
  return (
    <div className="stack">
      <TraderTabs />
      <div className="page-head">
        <div className="label">Admin · BNB Chain</div>
        <h1>Monitor</h1>
        <p className="muted">Track up to five public wallet addresses and a token contract. This page is read-only.</p>
      </div>
      <AdminMonitor />
    </div>
  );
}
