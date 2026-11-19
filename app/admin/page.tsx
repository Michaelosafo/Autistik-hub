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
  if (!owner && !helper) notFound();
  if (!owner) {
    return (
      <div className="stack">
        <div className="page-head"><div className="label">Admin · helper</div><h1>Build the Hub</h1><p className="muted">The owner made you a helper admin. You can build and moderate (TIK news, hiding posts, sessions, Launch Pad tools) and use the AI trader. Money tools and the live trading wallet stay with the owner, who can remove helper access any time.</p></div>
        {staff ? <>
          <Link href="/admin/ai-trader" className="notice" style={{ display: "block", fontWeight: 800 }}>🤖 AI trader →</Link>
          <Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures →</Link><Link href="/admin/token" className="notice" style={{ display: "block", fontWeight: 800 }}>🪙 Launch a BSC token →</Link><Link href="/admin/rage" className="notice" style={{ display: "block", fontWeight: 800 }}>💧 Rage: deploy, add liquidity, remove it (BNB default, plus Ethereum, Base, Arbitrum, Polygon, Avalanche, Optimism, Robinhood, Solana) →</Link><Link href="/admin/ai-snipe-bsc" className="notice" style={{ display: "block", fontWeight: 800 }}>⚡ Sniper (BSC): buys the moment liquidity is added →</Link><Link href="/admin/ai-forex" className="notice" style={{ display: "block", fontWeight: 800 }}>💱 AI Forex →</Link><Link href="/admin/ai-copy" className="notice" style={{ display: "block", fontWeight: 800 }}>👥 Copy →</Link>
          <div className="notice">Launch Pad tools (deploy on a new chain, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom. Post AUTISTIK news from <Link href="/app">TIK Home</Link>.</div>
        </> : <AdminMfa />}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only the Hub owner can open this page.</p></div>
      <AdminWalletBackfill />
      {admin ? <><Link href="/admin/chain" className="notice" style={{ display: "block", fontWeight: 800 }}>⛓️ AUTISTIK Chain (owner only): blocks, live on-chain activity, token & treasury, validators, bridge →</Link><Link href="/admin/ai-trader" className="notice" style={{ display: "block", fontWeight: 800 }}>🤖 AI trader (testing): give it funds, it finds coins and trades with stop-loss and take profit →</Link><Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures: news, X and chart-driven futures on Hyperliquid and Aster, own wallet, max 3x →</Link><Link href="/admin/rage" className="notice" style={{ display: "block", fontWeight: 800 }}>Rage: deploy a token on BNB Chain (default) or Ethereum, Base, Arbitrum, Polygon, Avalanche, Optimism, Robinhood Chain, or Solana, add liquidity, and remove it →</Link><Link href="/admin/token" className="notice" style={{ display: "block", fontWeight: 800 }}>🪙 Launch a BSC token: buy & sell tax, tax wallet, add liquidity on PancakeSwap, test add/remove on testnet →</Link><Link href="/admin/ai-forex" className="notice" style={{ display: "block", fontWeight: 800 }}>💱 AI Forex: currency pairs (EUR/USD, USD/JPY, …) with news and charts, own wallet funded from Solana, Practice or Live →</Link><Link href="/admin/ai-copy" className="notice" style={{ display: "block", fontWeight: 800 }}>👥 Copy: copies BNB Chain wallets you paste, buys when they buy, sells when they sell →</Link><Link href="/admin/ai-snipe-bsc" className="notice" style={{ display: "block", fontWeight: 800 }}>⚡ Sniper (BSC): paste a token before launch, buys the moment liquidity is added →</Link><div className="notice">Launch Pad tools (deploy on Ethereum, Robinhood Chain and other chains, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom.</div><AdminHelpers /><AdminFees /><AdminSolCollect /><AdminActivity /><AdminAirdrop /><AdminBadges /><AdminTeam /><SiteActivity /><AIBudget /><Admin /></> : <AdminMfa />}
    </div>
  );
}
