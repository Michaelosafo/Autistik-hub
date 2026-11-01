import { headers } from "next/headers";
import HFBoot from "./HFBoot";
import WalletDash from "./WalletDash";
import { HF_CSS, HF_MARKUP } from "./markup";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";
import { adminState } from "@/lib/admin";
import { FEE_BPS } from "@/lib/wallet-chains";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Wallet · Hyperfocus · AUTISTIK Hub",
  description: "Your AUTISTIK wallet and the Hyperfocus game: balances on every network, rewards, the wallet and token scanner, 3D races and offline swaps.",
};

/** A dollar amount to start a Buy with, when it is a sensible one. */
const usdOf = (v?: string) => { const x = Number(v); return isFinite(x) && x > 0 && x <= 100_000 ? Math.round(x * 100) / 100 : undefined; };

async function rewardsOf() {
  try {
    const user = await currentUser();
    const sb = supabaseServer();
    const { data: settings } = await sb.from("app_settings").select("qualify_points").eq("id", 1).maybeSingle();
    const need = settings?.qualify_points ?? 50;
    if (!user) return { signedIn: false, points: 0, need, rank: 0 };
    const { data } = await sb.from("member_points").select("user_id,points").order("points", { ascending: false }).limit(200);
    const board = (data || []).filter((r: any) => r.points > 0);
    const me = (data || []).find((r: any) => r.user_id === user.id);
    return { signedIn: true, points: me?.points ?? 0, need, rank: board.findIndex((r: any) => r.user_id === user.id) + 1 };
  } catch { return { signedIn: false, points: 0, need: 50, rank: 0 }; }
}

/**
 * Hyperfocus: the AUTISTIK wallet hub. Tabs: Wallet (dashboard + the full wallet), Scanner, Race (the 3D game) and
 * Offline swap. The game is plain JavaScript (public/hyperfocus), started by HFBoot; the wallet is the site's own.
 */
export default async function HyperfocusPage({ searchParams }: { searchParams: { chain?: string; buy?: string; quick?: string; usd?: string } }) {
  const nonce = headers().get("x-nonce") ?? undefined;
  const appId = PRIVY_APP_ID;
  const [member, { admin }, rewards] = await Promise.all([appId ? walletMember() : Promise.resolve(null), adminState(), rewardsOf()]);
  const start = { chain: searchParams.chain?.slice(0, 12), buy: searchParams.buy?.trim().slice(0, 64), quick: searchParams.quick === "1", usd: usdOf(searchParams.usd) };
  const feeNote = `Self-custody: your keys, your coins. Swaps use KyberSwap (BNB Chain, Base, Ethereum, Arbitrum) and Jupiter (Solana) to find the best price across every DEX. ${FEE_BPS ? `A ${FEE_BPS / 100}% fee per trade supports the AUTISTIK team.` : "Swaps have no AUTISTIK fee: you only pay the network's small gas fee."} Limit and stop-loss orders fill automatically through the AUTISTIK Orders contract; your tokens stay in your wallet until then. Tokens can lose all their value; nothing here is financial advice.`;
  return (
    <>
      <h1 className="sr-only">AUTISTIK Wallet and Hyperfocus</h1>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Russo+One&family=Figtree:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" />
      <style dangerouslySetInnerHTML={{ __html: HF_CSS }} />
      <div className="hf" dangerouslySetInnerHTML={{ __html: HF_MARKUP }} suppressHydrationWarning />
      <WalletDash appId={appId} member={member as any} start={start} admin={!!admin} rewards={rewards} feeNote={feeNote} />
      <HFBoot nonce={nonce} />
    </>
  );
}
