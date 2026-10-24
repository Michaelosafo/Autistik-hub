import Link from "next/link";
import CopyAddress from "@/components/CopyAddress";
import TokenLogo from "@/components/TokenLogo";
import { FEATURED } from "@/lib/featured";
import { CHAINS } from "@/lib/launchpad";
import { buyLink } from "@/lib/listings";
import { getMarkets, usd } from "@/lib/market";
import { supabaseServer } from "@/lib/supabase/server";
import { isWChain } from "@/lib/wallet-chains";

const pct = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

/** The featured token's banner: who it is, live numbers, its liquidity lock, and Buy / Chart / Copy address. */
export default async function FeaturedToken() {
  const f = FEATURED;
  if (!f || !CHAINS[f.chain]) return null;
  const [markets, launch] = await Promise.all([
    getMarkets([{ chain: f.chain, token: f.token }]).catch(() => ({} as Record<string, never>)),
    supabaseServer().from("launches").select("lp_lock,lp_unlock_at,source").eq("chain", f.chain).eq("token", f.token).maybeSingle().then((r) => r.data, () => null),
  ]);
  const m = markets[f.token.toLowerCase()];
  const lock = launch?.lp_lock === "burn" ? "Liquidity burned" : launch?.lp_unlock_at ? `Liquidity locked to ${new Date(launch.lp_unlock_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : launch?.lp_lock ? "Liquidity locked" : null;
  const page = `/launchpad/${f.chain}/${f.token}`;
  return (
    <section className="ft" aria-label={`Featured: ${f.name}`}>
      <div className="ft-id">
        <TokenLogo src={m?.imageUrl} symbol={f.symbol} big />
        <div>
          <span className="ft-kicker">★ Featured on AUTISTIK</span>
          <h2>{f.name} <span>${f.symbol}</span></h2>
          <p>{f.line}</p>
          <div className="ft-badges">
            <span>{CHAINS[f.chain].name}</span>
            {launch?.source === "launchpad" && <span>Launched on AUTISTIK</span>}
            {lock && <span>🔒 {lock}</span>}
          </div>
        </div>
      </div>
      <dl className="ft-stats">
        <div><dt>Price</dt><dd>{usd(m?.priceUsd)}</dd></div>
        <div><dt>24h</dt><dd className={m?.change24h == null ? "" : m.change24h >= 0 ? "up" : "down"}>{pct(m?.change24h)}</dd></div>
        <div><dt>Market cap</dt><dd>{usd(m?.marketCap)}</dd></div>
        <div><dt>Liquidity</dt><dd>{usd(m?.liquidityUsd)}</dd></div>
      </dl>
      <div className="ft-cta">
        <Link className="ft-btn gold" href={isWChain(f.chain) ? buyLink(f) : page}>Buy ${f.symbol}</Link>
        <Link className="ft-btn" href={page}>Chart</Link>
      </div>
      <div className="ft-ca"><CopyAddress address={f.token} /></div>
      <small className="ft-note">Featured by the AUTISTIK team. Crypto is risky: only buy what you can afford to lose.</small>
    </section>
  );
}
