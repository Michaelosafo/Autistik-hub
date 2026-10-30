import Link from "next/link";
import BackButton from "@/components/BackButton";
import { notFound } from "next/navigation";
import Arena from "@/components/Arena";
import AnalyticsScan from "@/components/AnalyticsScan";
import AutoRefresh from "@/components/AutoRefresh";
import TokenLogo from "@/components/TokenLogo";
import { ACHAINS, isAChain, isChainAddress } from "@/lib/analytics";
import { loadArena } from "@/lib/arena-server";
import { isWChain } from "@/lib/wallet-chains";
import { walletMember } from "@/lib/privy-server";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function generateMetadata({ params }: { params: { chain: string; token: string } }) {
  return { title: `Match ${params.token.slice(0, 8)}… · Game arena · AUTISTIK Hub` };
}
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

/** One token's match: every holder and seller on the pitch, with Join (buy) and a box to open another token. */
export default async function ArenaMatch({ params }: { params: { chain: string; token: string } }) {
  if (!isAChain(params.chain) || !isChainAddress(params.chain, params.token)) notFound();
  const chain = params.chain, c = ACHAINS[chain];
  const [user, data] = await Promise.all([currentUser(), loadArena(chain, params.token)]);
  const member = user ? await walletMember().catch(() => null) : null;
  const myWallet = member ? (chain === "solana" ? member.sol : member.evm) : null;

  if (!data) return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="back-links"><BackButton fallback="/arena" /><Link href="/arena" className="muted">Game arena</Link></div>
      <section className="ga-hero">
        <div className="ga-kicker">{c.name.toUpperCase()} · {short(params.token)}</div>
        <h1>⚽ This match hasn&apos;t kicked off yet</h1>
        <p>Nobody has opened this token in the arena before. Kick it off and every holder runs onto the pitch in about a minute.</p>
        <AnalyticsScan signedIn={!!user} chain={chain} token={params.token} label="Kick off the match" to="arena" />
      </section>
    </div>
  );

  const { t } = data;
  return (
    <div className="stack" style={{ maxWidth: 1080 }}>
      <AutoRefresh seconds={60} />
      <div className="ga-matchbar">
        <BackButton fallback="/arena" />
        <Link href="/arena" className="ga-back">Lobby</Link>
        <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
        <span className="grow"><b>${t.symbol || short(t.token)}</b><small>{t.name || short(t.token)} · {c.name}</small></span>
        <Link href={`/analytics/${chain}/${t.token}`} className="wg-btn">📊 Scanner view</Link>
      </div>
      <div className="card stack ga-match-card">
        <Arena holders={data.holders as any} events={data.events as any} trades={data.trades as any} links={data.links as any} explorer={c.explorer} token={t.token} symbol={t.symbol || "TOKEN"}
          chain={chain} canBuy={isWChain(chain)} me={myWallet} signedIn={!!user} />
        <details className="chess-help">
          <summary>How to watch the match</summary>
          <ul>
            <li><b>Green kits are Diamond Hands</b>: wallets still holding, defending their own goal. <b>Red kits are Paper Hands</b>: wallets that sold some in this time frame.</li>
            <li><b>Shaking and sweating</b> means a holder looks ready to sell (sold before, bought very recently, or linked to other wallets).</li>
            <li><b>Faded red players</b> sold part of their bag: the less they have left, the more see-through they get. Wallets that sold everything vanish in a <b>💨 puff</b> and stay on as grey <b>ghosts</b> with a halo.</li>
            <li><b>Every new sell pops up</b> as a note at the top of the screen, and the latest buys and sells show over the player who made them.</li>
            <li><b>Your player</b> has gold hair, a gold kit and a YOU flag. Not signed in? Paste your wallet under &quot;Your player&quot; to find it.</li>
            <li><b>Join the match</b> (or tap the gold JOIN on the touchline): pick an amount and buy in your wallet. Your player runs on within a minute.</li>
            <li><b>🔎 Scan a token</b> opens any other token&apos;s match. Pick a time frame (1H to All) and tap any player to see that wallet.</li>
          </ul>
        </details>
      </div>
      <p className="muted" style={{ fontSize: ".8em" }}>Data straight from the blockchain, refreshed every minute. Faces are random cartoons made from each wallet address. Nothing here is financial advice.</p>
    </div>
  );
}
