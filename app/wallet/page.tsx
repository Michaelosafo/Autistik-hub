import dynamicImport from "next/dynamic";
import Link from "next/link";
import Player, { PlayerDefs } from "@/components/arena/Player";
import { TOKEN_ADDRESS } from "@/lib/groups";
import SendTokens from "@/components/live/SendTokens";
import WalletLoader from "@/components/wallet/WalletLoader";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";
import { adminState } from "@/lib/admin";
import { FEE_BPS } from "@/lib/wallet-chains";

const OrdersAdmin = dynamicImport(() => import("@/components/wallet/OrdersAdmin"), { ssr: false });

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wallet · AUTISTIK Hub",
  description: "Your own self-custody crypto wallet: buy, sell and swap any token on BNB Chain, Base, Ethereum, Arbitrum and Solana.",
};

/** A dollar amount to start a Buy with (from the game arena), when it is a sensible one. */
const usdOf = (v?: string) => { const x = Number(v); return isFinite(x) && x > 0 && x <= 100_000 ? Math.round(x * 100) / 100 : undefined; };

export default async function WalletPage({ searchParams }: { searchParams: { chain?: string; buy?: string; quick?: string; usd?: string } }) {
  // Privy's app ID is public (it only names the app). Read at request time so adding it in Vercel needs no code change.
  const appId = PRIVY_APP_ID;
  const member = appId ? await walletMember() : null;
  const { admin } = await adminState();
  const start = { chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64), quick: searchParams.quick === "1", usd: usdOf(searchParams.usd) };
  return (
    <div className="stack wallet-game" style={{ maxWidth: 1320 }}>
      <h1 className="sr-only">AUTISTIK Wallet</h1>
      {/* The wallet is the player's locker room: straight into a match or the scanner from here. */}
      <nav className="wg-bar" aria-label="Wallet games">
        <span className="wg-me" aria-hidden="true">
          <svg viewBox="-40 -105 80 110"><defs><PlayerDefs /></defs><g className="pl chill"><g className="pl-move"><Player wallet={member?.evm || member?.sol || "autistik-player"} kit="#FFB300" trim="#fff" number={1} you /></g></g></svg>
        </span>
        <span className="wg-title"><b>Player wallet</b><small>Trade, then jump into a match</small></span>
        <span className="wg-links">
          <Link href="/arena" className="wg-btn arena">Game arena</Link>
          <Link href={`/arena/bsc/${TOKEN_ADDRESS}`} className="wg-btn">$AUTISTIK match</Link>
          <Link href="/analytics" className="wg-btn">Scanner</Link>
        </span>
      </nav>
      <details className="card" style={{ padding: "10px 14px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Send $AUTISTIK to a member by name</summary>
        <div style={{ marginTop: 10 }}><SendTokens /></div>
      </details>
      <WalletLoader appId={appId} member={member} start={start} />
      {admin && <OrdersAdmin />}
      <p className="muted" style={{ fontSize: ".82em" }}>
        Self-custody: your keys, your coins. Swaps use KyberSwap (BNB Chain, Base, Ethereum, Arbitrum) and Jupiter (Solana) to find the best price across every DEX.
        {FEE_BPS ? `A ${FEE_BPS / 100}% fee per trade supports the AUTISTIK team.` : "Swaps have no AUTISTIK fee: you only pay the network's small gas fee."} Limit and stop-loss orders fill automatically through the AUTISTIK Orders contract; your tokens stay in your wallet until then. Tokens can lose all their value; nothing here is financial advice.
      </p>
    </div>
  );
}
