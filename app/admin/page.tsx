import Link from "next/link";
import { notFound } from "next/navigation";
import Admin from "@/components/Admin";
import AdminMfa from "@/components/AdminMfa";
import AIBudget from "@/components/AIBudget";
import AdminActivity from "@/components/AdminActivity";
import AdminFees from "@/components/AdminFees";
import AdminSolCollect from "@/components/AdminSolCollect";
import AdminAirdrop from "@/components/AdminAirdrop";
import AdminBadges from "@/components/AdminBadges";
import AdminTeam from "@/components/AdminTeam";
import AdminWalletBackfill from "@/components/AdminWalletBackfill";
import SiteActivity from "@/components/SiteActivity";
import AdminHelpers from "@/components/AdminHelpers";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · AUTISTIK Hub", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const { owner, admin, helper, staff } = await adminState();
  // Everyone except the owner and their helper admins sees an ordinary "page not found", so the admin area isn't advertised.
  if (!owner && !helper) notFound();
  if (!owner) {
    return (
      <div className="stack">
        <div className="page-head"><div className="label">Admin · helper</div><h1>Build the Hub</h1><p className="muted">The owner made you a helper admin. You can build and moderate (TIK news, hiding posts, sessions, Launch Pad tools) and use the AI trader. Money tools and the live trading wallet stay with the owner, who can remove helper access any time.</p></div>
        {staff ? <>
          <Link href="/admin/ai-trader" className="notice" style={{ display: "block", fontWeight: 800 }}>🤖 AI trader →</Link>
          <Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures →</Link><Link href="/admin/ai-forex" className="notice" style={{ display: "block", fontWeight: 800 }}>💱 AI Forex →</Link><Link href="/admin/ai-earn" className="notice" style={{ display: "block", fontWeight: 800 }}>💰 Earn →</Link>
          <div className="notice">Launch Pad tools (deploy on a new chain, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom. Post AUTISTIK news from <Link href="/app">TIK Home</Link>.</div>
        </> : <AdminMfa />}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only the Hub owner can open this page.</p></div>
      <AdminWalletBackfill />
      {admin ? <><Link href="/admin/ai-trader" className="notice" style={{ display: "block", fontWeight: 800 }}>🤖 AI trader (testing): give it funds, it finds coins and trades with stop-loss and take profit →</Link><Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures: news, X and chart-driven futures on Hyperliquid and Aster, own wallet, max 3x →</Link><Link href="/admin/ai-forex" className="notice" style={{ display: "block", fontWeight: 800 }}>💱 AI Forex: currency pairs (EUR/USD, USD/JPY, …) with news and charts, own wallet funded from Solana, Practice or Live →</Link><Link href="/admin/ai-earn" className="notice" style={{ display: "block", fontWeight: 800 }}>💰 Earn: steady growth in Hyperliquid&apos;s HLP vault, own wallet funded from Solana →</Link><div className="notice">Launch Pad tools (deploy on Ethereum, Robinhood Chain and other chains, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom.</div><AdminHelpers /><AdminFees /><AdminSolCollect /><AdminActivity /><AdminAirdrop /><AdminBadges /><AdminTeam /><SiteActivity /><AIBudget /><Admin /></> : <AdminMfa />}
    </div>
  );
}
