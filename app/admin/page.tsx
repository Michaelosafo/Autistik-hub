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
        <div className="page-head"><div className="label">Admin · helper</div><h1>Build the Hub</h1><p className="muted">The owner made you a helper admin. You can build and moderate (TIK news, hiding posts, sessions), use AI Futures, and share BnbRage with the owner: the same team wallets and tokens. The other tools and money stay with the owner, who can remove helper access any time.</p></div>
        {staff ? <>
          <Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures →</Link><Link href="/admin/rage" className="notice" style={{ display: "block", fontWeight: 800 }}>💧 BnbRage (shared with the owner): team wallets, deploy, add liquidity, remove it (BNB Chain only) →</Link>
          <div className="notice">Post AUTISTIK news from <Link href="/app">TIK Home</Link>.</div>
        </> : <AdminMfa />}
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="page-head"><div className="label">Admin</div><h1>Run the Hub</h1><p className="muted">Only the Hub owner can open this page.</p></div>
      <AdminWalletBackfill />
      {admin ? <><Link href="/admin/chain" className="notice" style={{ display: "block", fontWeight: 800 }}>⛓️ AUTISTIK Chain (owner only): blocks, live on-chain activity, token & treasury, validators, bridge →</Link><Link href="/admin/ai-trader" className="notice" style={{ display: "block", fontWeight: 800 }}>🤖 AI trader (testing): give it funds, it finds coins and trades with stop-loss and take profit →</Link><Link href="/admin/ai-futures" className="notice" style={{ display: "block", fontWeight: 800 }}>📊 AI Futures: news, X and chart-driven futures on Hyperliquid and Aster, own wallet, max 3x →</Link><Link href="/admin/rage" className="notice" style={{ display: "block", fontWeight: 800 }}>💧 BnbRage (shared with your admins): team wallets, deploy a token on BNB Chain, add liquidity, and remove it →</Link><Link href="/admin/rage-personal" className="notice" style={{ display: "block", fontWeight: 800 }}>🔒 Personal RageBNB (only you): your own wallet, with SniperBNB in its menu →</Link><Link href="/admin/ethrise" className="notice" style={{ display: "block", fontWeight: 800 }}>🔷 EthRise: deploy on Ethereum, Uniswap liquidity, with SniperEth in its menu →</Link><Link href="/admin/wanarobinhood" className="notice" style={{ display: "block", fontWeight: 800 }}>🪶 WanaRobinhood: deploy on Robinhood Chain, liquidity, with SniperRobinhood in its menu →</Link><Link href="/admin/lobbysol" className="notice" style={{ display: "block", fontWeight: 800 }}>🟣 LobbySol: deploy on Solana, Raydium liquidity, with SniperLobbySol in its menu →</Link><Link href="/admin/token" className="notice" style={{ display: "block", fontWeight: 800 }}>🪙 Launch a BSC token: buy & sell tax, tax wallet, add liquidity on PancakeSwap, test add/remove on testnet →</Link><Link href="/admin/ai-forex" className="notice" style={{ display: "block", fontWeight: 800 }}>💱 AI Forex: currency pairs (EUR/USD, USD/JPY, …) with news and charts, own wallet funded from Solana, Practice or Live →</Link><Link href="/admin/ai-copy" className="notice" style={{ display: "block", fontWeight: 800 }}>👥 Copy: copies BNB Chain wallets you paste, buys when they buy, sells when they sell →</Link><Link href="/admin/insider" className="notice" style={{ display: "block", fontWeight: 800 }}>👁 Insider: score public callers and auto-buy from the sniper wallets →</Link><div className="notice">Launch Pad tools (deploy on Ethereum, Robinhood Chain and other chains, list tokens) are on <Link href="/launchpad/new">the Launch page</Link>, at the bottom.</div><AdminHelpers /><AdminFees /><AdminSolCollect /><AdminActivity /><AdminAirdrop /><AdminBadges /><AdminTeam /><SiteActivity /><AIBudget /><Admin /></> : <AdminMfa />}
    </div>
  );
}
