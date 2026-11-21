/**
 * Dev watch: follow a token's deployer and get an alert when the same wallet creates a new token.
 * Members follow a dev automatically when they run the advanced scan on one of the dev's tokens (or with the
 * Follow button). The analytics cron calls runDevWatch: each followed dev is re-read about every 30 minutes
 * (lib/dev-history.ts devReport) and any token not seen before is announced to that dev's followers.
 */
import { ACHAINS, isAChain, type AChain } from "@/lib/analytics";
import { devReport, devVerdict, type DevReport } from "@/lib/dev-history";
import { notify } from "@/lib/push";
import { supabaseService } from "@/lib/supabase/server";

const CHECK_EVERY = 30 * 60_000;

/** Start following a dev. The first time anyone follows them, their current tokens are noted so only new ones alert. */
export async function followDev(userId: string, chain: AChain, wallet: string, fromToken?: string | null, report?: DevReport | null) {
  const sb = supabaseService();
  await sb.from("dev_follows").upsert({ user_id: userId, chain, wallet, from_token: fromToken ?? null }, { onConflict: "user_id,chain,wallet" });
  const { data: w } = await sb.from("dev_watch").select("wallet").eq("chain", chain).eq("wallet", wallet).maybeSingle();
  if (!w) await sb.from("dev_watch").insert({ chain, wallet, known: report ? report.tokens.map((t) => t.token.toLowerCase()) : [], checked_at: report ? report.scannedAt : null });
}
export async function unfollowDev(userId: string, chain: AChain, wallet: string) {
  await supabaseService().from("dev_follows").delete().eq("user_id", userId).eq("chain", chain).eq("wallet", wallet);
}
export async function followsDev(userId: string | null | undefined, chain: string, wallet: string) {
  if (!userId) return false;
  const { data } = await supabaseService().from("dev_follows").select("wallet").eq("user_id", userId).eq("chain", chain).eq("wallet", wallet).maybeSingle();
  return !!data;
}

/** A short summary of a dev for the scanner dashboard. */
export function devSummary(r: DevReport) {
  const v = devVerdict(r);
  return {
    wallet: r.wallet, chain: r.chain, score: r.score, label: r.label, bondChance: r.bondChance, summary: r.summary,
    stats: r.stats, verdict: { kind: v.kind, title: v.title }, limited: r.limited ?? null,
    tokens: r.tokens.slice(0, 6).map((t) => ({ token: t.token, symbol: t.symbol, name: t.name, logo: t.logo, createdAt: t.createdAt, status: t.status, marketCap: t.marketCap, athCap: t.athCap ?? null })),
  };
}

/** Cron: re-check followed devs (oldest first) until the deadline, and alert their followers about new tokens. */
export async function runDevWatch(deadline: number) {
  const sb = supabaseService();
  const { data: due } = await sb.from("dev_watch").select("chain,wallet,known,checked_at")
    .or(`checked_at.is.null,checked_at.lt.${new Date(Date.now() - CHECK_EVERY).toISOString()}`)
    .order("checked_at", { ascending: true, nullsFirst: true }).limit(6);
  let checked = 0, alerts = 0;
  for (const d of due || []) {
    if (Date.now() > deadline) break;
    if (!isAChain(d.chain)) continue;
    const { count } = await sb.from("dev_follows").select("user_id", { count: "exact", head: true }).eq("chain", d.chain).eq("wallet", d.wallet);
    if (!count) { await sb.from("dev_watch").delete().eq("chain", d.chain).eq("wallet", d.wallet); continue; }
    let r: DevReport;
    try { r = await devReport(d.chain, d.wallet, true); } catch { await sb.from("dev_watch").update({ checked_at: new Date().toISOString() }).eq("chain", d.chain).eq("wallet", d.wallet); continue; }
    checked++;
    const known = new Set((d.known || []).map((x: string) => x.toLowerCase()));
    const fresh = d.checked_at ? r.tokens.filter((t) => !known.has(t.token.toLowerCase())) : [];
    await sb.from("dev_watch").update({ known: r.tokens.map((t) => t.token.toLowerCase()).slice(0, 500), checked_at: new Date().toISOString() }).eq("chain", d.chain).eq("wallet", d.wallet);
    if (!fresh.length) continue;
    const { data: fans } = await sb.from("dev_follows").select("user_id").eq("chain", d.chain).eq("wallet", d.wallet);
    const short = `${d.wallet.slice(0, 6)}…${d.wallet.slice(-4)}`;
    for (const t of fresh.slice(0, 3)) {
      const name = t.symbol ? `$${t.symbol}` : t.name || `${t.token.slice(0, 8)}…`;
      await notify((fans || []).map((f: any) => ({
        user_id: f.user_id,
        title: `🆕 Dev ${short} launched ${name}`,
        body: `The deployer you follow just created a new token on ${ACHAINS[d.chain as AChain].name}. Their record: ${r.stats.launched} tokens, ${r.stats.bonded} bonded. Scan it before you buy.`,
        link: `/analytics?chain=${d.chain}&token=${t.token}`,
        strong: true,
      })));
      alerts += (fans || []).length;
    }
  }
  return { checked, alerts };
}
