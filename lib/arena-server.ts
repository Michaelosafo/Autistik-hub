/** Data for the game arena: a token's tracked holders, their moves and the live trades. Server only. */
import { checkToken, syncTrades, type AChain } from "@/lib/analytics";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export async function loadArena(chain: AChain, token: string) {
  const sb = supabaseServer();
  let { data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", token).maybeSingle();
  if (!t) return null;
  // Fresh balances and trades when someone watches (public blockchain reads), like the scanner does.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await supabaseService().from("tracked_tokens").update({ viewed_at: new Date().toISOString() }).eq("chain", chain).eq("token", t.token);
    const tradesStale = !t.trades_at || Date.now() - Date.parse(t.trades_at) > 60_000;
    const balancesStale = !t.checked_at || Date.now() - Date.parse(t.checked_at) > 3 * 60_000;
    if (tradesStale || balancesStale) {
      await Promise.race([
        Promise.all([tradesStale ? syncTrades(chain, t.token, 2).catch(() => 0) : 0, balancesStale ? checkToken(chain, t.token).catch(() => []) : []]),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
      ({ data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", token).maybeSingle());
    }
  }
  const [{ data: holders }, { data: events }, { data: links }, { data: trades }] = await Promise.all([
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", t.token).order("rank", { ascending: true, nullsFirst: false }),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", t.token).order("created_at", { ascending: false }).limit(500),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", t.token).limit(500),
    sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,tx_hash,block").eq("chain", chain).eq("token", t.token)
      .gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(1000),
  ]);
  return { t, holders: holders || [], events: events || [], links: links || [], trades: trades || [] };
}

/**
 * A random handful of tokens with strong momentum right now (volume and buying well above normal, passing the basic
 * safety checks), for the arena's "hot matches". Picked fresh on every visit. A rough guide only, not advice.
 */
export async function hotMatches(count = 6) {
  const { momentum } = await import("@/lib/momentum-server");
  const { isAChain } = await import("@/lib/analytics");
  const picks = (await momentum().catch(() => [])).filter((p) =>
    isAChain(p.chain) && (p.level === "hot" || p.level === "building") && p.safety?.honeypot !== true && (p.safety?.sellTax ?? 0) <= 10);
  // Shuffle, then keep the order by score so the strongest of the draw shows first.
  for (let i = picks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [picks[i], picks[j]] = [picks[j], picks[i]]; }
  return picks.slice(0, count).sort((a, b) => b.score - a.score);
}
