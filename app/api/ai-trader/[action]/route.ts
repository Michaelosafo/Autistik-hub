import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { ACTIVE_MS, TRADE_CHAINS, adminActive, closePosition, createTraderWallet, importTraderKey, revealTraderKey, getSettings, liveBalance, log, runTrader, traderAccount, withdrawBnb, type Position } from "@/lib/ai-trader";
import { supabaseService } from "@/lib/supabase/server";
import { cronDenied } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI trader (admin only while it's being tested).
 * GET /api/ai-trader/cron: the schedule (every 5 minutes; runs at most every 4).
 * GET /api/ai-trader/status: settings, positions, log, wallet (admins).
 * POST settings | run | close | edit | reset (admins).
 */
export async function GET(_req: Request, { params }: { params: { action: string } }) {
  if (params.action === "cron") {
    const denied = cronDenied(_req);
    if (denied) return denied;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
    return json(await runTrader().catch((e) => ({ error: (e as Error).message })));
  }
  if (params.action !== "status") return json({ error: "Not found." }, 404);
  const who = await adminState();
  if (!who.staff) return json({ error: "Admins only." }, 403);
  const sb = supabaseService();
  // Having this page open counts as being around (hands-on mode).
  await sb.from("ai_trader_settings").update({ admin_seen_at: new Date().toISOString() }).eq("id", 1);
  const [s, { data: open }, { data: closed }, { data: logs }, wallet] = await Promise.all([
    getSettings(),
    sb.from("ai_trader_positions").select("*").in("status", ["open", "closing"]).order("opened_at", { ascending: false }),
    sb.from("ai_trader_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(50),
    sb.from("ai_trader_log").select("*").order("at", { ascending: false }).limit(60),
    liveBalance().catch(() => null),
  ]);
  const done = ((closed || []) as Position[]).filter((p) => p.mode === s.mode);
  const pnl = done.reduce((a, p) => a + (Number(p.pnl) || 0), 0);
  const wins = done.filter((p) => (Number(p.pnl) || 0) > 0).length;
  return json({
    settings: s, open: open || [], closed: closed || [], log: logs || [],
    wallet: wallet ?? { address: null, bnb: null }, liveReady: !!(await traderAccount()), owner: who.admin,
    active: adminActive({ ...s, admin_seen_at: new Date().toISOString() }), activeMinutes: ACTIVE_MS / 60_000,
    stats: { trades: done.length, wins, winRate: done.length ? Math.round((wins / done.length) * 100) : null, pnl },
  });
}

const NUM: Record<string, [number, number]> = {
  per_trade: [0.001, 10], max_positions: [1, 20], min_liquidity: [1000, 10_000_000], max_tax: [0, 25], min_age_hours: [0, 720],
  mcap_min: [500, 10_000_000], mcap_max: [1000, 100_000_000], micro_min_liq: [500, 10_000_000], target_profit: [10, 1000], strat_stop: [5, 90],
  stop_loss: [1, 90], take_profit: [1, 2000], trail: [0, 90], max_hold_hours: [1, 720], daily_loss_limit: [0.001, 100],
};

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const who = await adminState();
  if (!who.staff) return json({ error: "Admins only." }, 403);
  const b = await req.json().catch(() => ({}));
  // Only the owner touches real money: the live wallet, withdrawals, switching to live, and rules while live.
  const ownerOnly = (msg = "Only the owner can do this.") => json({ error: msg }, 403);
  const sb = supabaseService();
  switch (params.action) {
    case "settings": {
      const cur = await getSettings();
      if (!who.admin && (cur.mode === "live" || b.mode === "live")) return ownerOnly("Only the owner can change things while the AI trades real money.");
      const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, [lo, hi]] of Object.entries(NUM)) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(hi, Math.max(lo, Number(b[k])));
      if (typeof b.enabled === "boolean") up.enabled = b.enabled;
      if (typeof b.use_ai === "boolean") up.use_ai = b.use_ai;
      if (typeof b.need_socials === "boolean") up.need_socials = b.need_socials;
      if (typeof b.manual_active === "boolean") up.manual_active = b.manual_active;
      if (typeof b.hype_on === "boolean") up.hype_on = b.hype_on;
      if (typeof b.dip_on === "boolean") up.dip_on = b.dip_on;
      if (b.away_take_profit != null && isFinite(Number(b.away_take_profit))) up.away_take_profit = Math.min(2000, Math.max(1, Number(b.away_take_profit)));
      // BNB Chain is always on; Ethereum, Robinhood Chain and Solana are optional.
      if (Array.isArray(b.chains)) up.chains = ["bsc", ...TRADE_CHAINS.filter((c) => c !== "bsc" && b.chains.includes(c))];
      if (b.mode === "paper" || b.mode === "live") {
        if (b.mode === "live" && !(await traderAccount())) return json({ error: "Create the trading wallet first (Live wallet, on this page) and send it some BNB." }, 400);
        up.mode = b.mode;
      }
      const { error } = await sb.from("ai_trader_settings").update(up).eq("id", 1);
      if (error) return json({ error: error.message }, 400);
      const what = Object.keys(up).filter((k) => k !== "updated_at").map((k) => `${k}=${up[k]}`).join(", ");
      if (what) await log("settings", `Admin changed: ${what}`);
      return json({ ok: true });
    }
    case "wallet": {
      if (!who.admin) return ownerOnly();
      try { const address = await createTraderWallet(); return json({ ok: true, address, note: "Wallet created. Send BNB (BNB Chain) to it, then switch to Live." }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "key-reveal": {
      if (!who.admin) return ownerOnly();
      try { return json({ ok: true, key: await revealTraderKey() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "key-import": {
      if (!who.admin) return ownerOnly();
      try { const address = await importTraderKey(String(b.key || "")); return json({ ok: true, address, note: `Now trading from your wallet ${address.slice(0, 6)}…${address.slice(-4)}.` }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "withdraw": {
      if (!who.admin) return ownerOnly();
      const { data: openLive } = await sb.from("ai_trader_positions").select("id").eq("mode", "live").in("status", ["open", "closing"]).limit(1);
      if (openLive?.length) return json({ error: "Sell the open live coins first, then withdraw." }, 400);
      try { const r = await withdrawBnb(String(b.to || "")); return json({ ok: true, note: `Sent ${r.bnb.toFixed(5)} BNB. Transaction ${r.hash.slice(0, 10)}…` }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "run":
      if ((await getSettings()).mode === "live" && !who.admin) return ownerOnly();
      return json(await runTrader({ force: true }).catch((e) => ({ error: (e as Error).message })));
    case "close": {
      const { data: p0 } = await sb.from("ai_trader_positions").select("mode").eq("id", String(b.id || "")).maybeSingle();
      if (p0?.mode === "live" && !who.admin) return ownerOnly("Only the owner can sell live coins.");
      const { data: p } = await sb.from("ai_trader_positions").select("*").eq("id", String(b.id || "")).in("status", ["open", "closing"]).maybeSingle();
      if (!p) return json({ error: "That position isn't open." }, 404);
      await closePosition(p as Position, "Closed by admin");
      return json({ ok: true });
    }
    case "edit": {
      if ((await getSettings()).mode === "live" && !who.admin) return ownerOnly();
      const up: Record<string, number> = {};
      for (const k of ["stop_loss", "take_profit", "trail"]) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(NUM[k][1], Math.max(NUM[k][0], Number(b[k])));
      const { data, error } = await sb.from("ai_trader_positions").update(up).eq("id", String(b.id || "")).in("status", ["open", "closing"]).select("symbol");
      if (error || !data?.length) return json({ error: "That position isn't open." }, 400);
      await log("settings", `Admin set ${data[0].symbol}: stop-loss ${up.stop_loss ?? "same"}%, take profit ${up.take_profit ?? "same"}%, trailing ${up.trail ?? "same"}%`);
      return json({ ok: true });
    }
    case "reset": {
      if ((await getSettings()).mode === "live" && !who.admin) return ownerOnly();
      // Practice mode only: clears practice positions and refills the practice balance.
      const start = Math.min(100, Math.max(0.01, Number(b.start) || 1));
      await sb.from("ai_trader_positions").delete().eq("mode", "paper");
      await sb.from("ai_trader_settings").update({ paper_cash: start, paper_start: start }).eq("id", 1);
      await log("settings", `Practice account reset to ${start} BNB.`);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}
