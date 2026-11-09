import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { closePosition, getSettings, liveBalance, log, runTrader, traderAccount, type Position } from "@/lib/ai-trader";
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
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const sb = supabaseService();
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
    wallet: wallet ?? { address: null, bnb: null }, liveReady: !!traderAccount(),
    stats: { trades: done.length, wins, winRate: done.length ? Math.round((wins / done.length) * 100) : null, pnl },
  });
}

const NUM: Record<string, [number, number]> = {
  per_trade: [0.001, 10], max_positions: [1, 20], min_liquidity: [1000, 10_000_000], max_tax: [0, 25], min_age_hours: [0, 720],
  stop_loss: [1, 90], take_profit: [1, 2000], trail: [0, 90], max_hold_hours: [1, 720], daily_loss_limit: [0.001, 100],
};

export async function POST(req: Request, { params }: { params: { action: string } }) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const b = await req.json().catch(() => ({}));
  const sb = supabaseService();
  switch (params.action) {
    case "settings": {
      const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, [lo, hi]] of Object.entries(NUM)) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(hi, Math.max(lo, Number(b[k])));
      if (typeof b.enabled === "boolean") up.enabled = b.enabled;
      if (typeof b.use_ai === "boolean") up.use_ai = b.use_ai;
      if (b.mode === "paper" || b.mode === "live") {
        if (b.mode === "live" && !traderAccount()) return json({ error: "Add AI_TRADER_KEY in Vercel first (a new wallet used only for the AI trader), then redeploy." }, 400);
        up.mode = b.mode;
      }
      const { error } = await sb.from("ai_trader_settings").update(up).eq("id", 1);
      if (error) return json({ error: error.message }, 400);
      const what = Object.keys(up).filter((k) => k !== "updated_at").map((k) => `${k}=${up[k]}`).join(", ");
      if (what) await log("settings", `Admin changed: ${what}`);
      return json({ ok: true });
    }
    case "run": return json(await runTrader({ force: true }).catch((e) => ({ error: (e as Error).message })));
    case "close": {
      const { data: p } = await sb.from("ai_trader_positions").select("*").eq("id", String(b.id || "")).in("status", ["open", "closing"]).maybeSingle();
      if (!p) return json({ error: "That position isn't open." }, 404);
      await closePosition(p as Position, "Closed by admin");
      return json({ ok: true });
    }
    case "edit": {
      const up: Record<string, number> = {};
      for (const k of ["stop_loss", "take_profit", "trail"]) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(NUM[k][1], Math.max(NUM[k][0], Number(b[k])));
      const { data, error } = await sb.from("ai_trader_positions").update(up).eq("id", String(b.id || "")).in("status", ["open", "closing"]).select("symbol");
      if (error || !data?.length) return json({ error: "That position isn't open." }, 400);
      await log("settings", `Admin set ${data[0].symbol}: stop-loss ${up.stop_loss ?? "same"}%, take profit ${up.take_profit ?? "same"}%, trailing ${up.trail ?? "same"}%`);
      return json({ ok: true });
    }
    case "reset": {
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
