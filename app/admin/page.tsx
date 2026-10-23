import Link from "next/link";
import { notFound } from "next/navigation";
import Admin from "@/components/Admin";
import AdminMfa from "@/components/AdminMfa";
import AIBudget from "@/components/AIBudget";
import AdminActivity from "@/components/AdminActivity";
import AdminAirdrop from "@/components/AdminAirdrop";
import AdminBadges from "@/components/AdminBadges";
import AdminTeam from "@/components/AdminTeam";
import AdminWalletBackfill from "@/components/AdminWalletBackfill";
import SiteActivity from "@/components/SiteActivity";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · AUTISTIK Hub", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const { owner, admin } = await adminState();
  // Everyone except the owner sees an ordinary "page not found", so the admin area isn't advertised.
  if (!owner) notFound();
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only the Hub owner can open this page.</p></div>
      <AdminWalletBackfill />
      {admin ? <><div className="notice">🚀 Launch Pad tools (deploy on Ethereum, Robinhood Chain and other chains, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom.</div><AdminActivity /><AdminAirdrop /><AdminBadges /><AdminTeam /><SiteActivity /><AIBudget /><Admin /></> : <AdminMfa />}
    </div>
  );
}
