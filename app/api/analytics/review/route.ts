import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { ACHAINS, isAChain, isChainAddress, scanToken } from "@/lib/analytics";
import { detectChain } from "@/lib/analytics-detect";
import { insights } from "@/lib/analytics-insights";
import { holdOutlook, tradeCall } from "@/lib/analytics-signals";
import { bundleCheck } from "@/lib/analytics-bundle";
import { simulateHoneypot } from "@/lib/honeypot-sim";
import { trustScore } from "@/lib/trust-score";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The built-in scanner as a short review, for Believer's trading bot: scans the token (same as Analytics), then gives
 * the buy-or-sell read, the long-term outlook, the trust score with its checks, and what buyers should know.
 * Links to the full report.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "analytics-review", 30, 600);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in to scan tokens." }, 401);
  const perUser = await rateLimit(null, "analytics-scan-user", 15, 3600, user.id);
  if (perUser) return perUser;

  const b = await req.json().catch(() => null);
  const raw = String(b?.token || "").trim().slice(0, 64);
  let chain: any = b?.chain;
  if (!isAChain(chain) || !isChainAddress(chain, raw)) chain = await detectChain(raw);
  if (!chain || !isAChain(chain) || !isChainAddress(chain, raw)) return json({ error: "Couldn't find that token on any network the scanner covers." }, 400);

  const err = await scanToken(chain, raw, { userId: user.id });
  if (err) return json({ error: err }, 400);
  const sb = supabaseService();
  const { data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain)[chain === "solana" ? "eq" : "ilike"]("token", raw).maybeSingle();
  if (!t) return json({ error: "The scan didn't finish. Try again in a minute." }, 502);

  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: holders }, { data: events }, { data: links }, { data: trades }, sim] = await Promise.all([
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", t.token).order("rank", { ascending: true, nullsFirst: false }),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", t.token).order("created_at", { ascending: false }).limit(500),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", t.token).limit(500),
    sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,tx_hash,block").eq("chain", chain).eq("token", t.token).gt("at", since).order("at", { ascending: false }).limit(1000),
    ACHAINS[chain as keyof typeof ACHAINS].kind === "evm" ? simulateHoneypot(chain, t.token).catch(() => null) : Promise.resolve(null),
  ]);
  const H = (holders || []) as any[];
  const s = (t.security || {}) as any;
  // A honeypot found by either test counts; the simulation's measured taxes win over the estimate.
  const sec = { ...s, honeypot: s.honeypot === true || sim?.honeypot === true ? true : s.honeypot ?? sim?.honeypot ?? null, buyTax: sim?.buyTax ?? s.buyTax, sellTax: sim?.sellTax ?? s.sellTax };
  const sigIn = { holders: H, events: (events || []) as any, trades: (trades || []) as any, links: (links || []) as any, dev: t.dev, security: sec };
  const call = tradeCall(sigIn);
  const hold = holdOutlook(sigIn, call);
  const top = H.filter((h) => h.in_top && !h.is_contract);
  const topShare = top.slice(0, 40).reduce((a, h) => a + (Number(h.pct) || 0), 0);
  const dev = H.find((h) => h.is_dev);
  const bundle = bundleCheck({ holders: H, trades: (trades || []) as any, links: (links || []) as any, dev: t.dev });
  const trust = trustScore({ security: sec, topShare: top.length ? topShare : null, bundle: H.length ? bundle.level : null });
  const know = insights({ holders: H, events: (events || []) as any, links: (links || []) as any, security: sec, fullList: t.holder_source === "moralis" });

  return json({
    chain, chainName: ACHAINS[chain as keyof typeof ACHAINS].name, path: `/analytics/${chain}/${t.token}`,
    symbol: t.symbol, name: t.name,
    verdict: { kind: call.kind, emoji: call.emoji, title: call.title, summary: call.summary, score: call.score, reasons: call.reasons.slice(0, 5) },
    hold: { short: { level: hold.short.level, title: hold.short.title }, long: { level: hold.long.level, title: hold.long.title } },
    trust: { score: trust.score, level: trust.level, title: trust.title, checks: trust.checks },
    holders: { top: top.length, topShare: top.length ? Math.round(topShare * 10) / 10 : null, devPct: dev ? Math.round((Number(dev.pct) || 0) * 100) / 100 : null, bundle: H.length ? { level: bundle.level, title: bundle.title } : null },
    know: know.slice(0, 6),
  });
}
