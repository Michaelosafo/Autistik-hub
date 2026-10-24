import Link from "next/link";
import AddLiquidity from "@/components/AddLiquidity";
import ProHero from "@/components/ProHero";
import { padSites } from "@/lib/launchpad-server";
import { launchAccess } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add liquidity · AUTISTIK Hub" };

/** Paste a token address (any network, Solana too) and add liquidity, or create its pool if it has none. */
export default async function LiquidityPage() {
  const [pads, access] = await Promise.all([padSites(), launchAccess()]);
  return (
    <div className="stack">
      <ProHero tone="coral" kicker="AUTISTIK · LIQUIDITY" title="Add liquidity to your token"
        text="Already made your token? Paste its address. We find its network, then you add liquidity, or create its pool if it doesn't have one yet. Works on Solana (Raydium) and on BNB Chain, Ethereum, Base and the other networks."
        stats={[["Paste", "the address"], ["Auto", "network found"], ["Solana", "Raydium pools"], ["Burn", "or lock LP"]]} />
      {!access.allowed ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>🚀 Coming soon</b>
          <p className="muted" style={{ margin: 0 }}>Adding liquidity here opens with the Launch Pad. Until then, browse coins on <Link href="/launchpad">Trending</Link>.</p>
        </div>
      ) : (
        <AddLiquidity pads={pads} />
      )}
      <p className="muted" style={{ fontSize: ".9em" }}>Making a new token? Go to <Link href="/launchpad/new">Launch a token</Link>.</p>
    </div>
  );
}
