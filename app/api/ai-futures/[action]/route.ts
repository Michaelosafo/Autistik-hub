/**
 * AI Futures (separate from the copy-trading AI trader).
 * GET /api/ai-futures/cron: every minute, runs every futures trader that's on or still has open positions.
 * GET /api/ai-futures/status: the signed-in admin's futures trader.
 * POST settings | wallet | key-reveal | deposit | close | run | reset (admins, their own only).
 */
import { adminState } from "@/lib/admin";
import { cronDenied } from "@/lib/cron-auth";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { withTrader } from "@/lib/ai-trader-ctx";
import { moveToDesk, EARN_DESK, FX_DESK, SNIPE_DESK, TURBO_DESK, isSnipeDesk, earnMove, LIVE_VENUES, VENUES, closeAllNow, closeNow, withdrawFut, createFutSolWallet, createFutWallet, depositToHl, flog, fundFromSolana, futStatus, futWallet, getF, importFutKey, importFutSolKey, revealFutKey, revealFutSolKey, runFutures } from "@/lib/ai-futures";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (params.action === "cron") {
    const denied = cronDenied(req);
    if (denied) return denied;
    const sb = supabaseService();
    const [{ data: on }, { data: holding }] = await Promise.all([
      sb.from("ai_futures_settings").select("id").or(`enabled.eq.true,id.gte.${EARN_DESK}`), // Earn desks run to move Solana money in
      sb.from("ai_futures_positions").select("fut_id").in("status", ["open", "closing"]),
    ]);
    const ids = [...new Set([...(on || []).map((r: any) => Number(r.id)), ...(holding || []).map((r: any) => Number(r.fut_id))])];
    const out = await Promise.all(ids.map((id) => withTrader(id, () => runFutures()).then((r) => ({ id, r }), (e) => ({ id, r: `error: ${(e as Error).message}` }))));
    return json({ ok: true, ran: out });
  }
  const id = desk(req, await mine());
  if (!id) return json({ error: "Admins only." }, 403);
  if (params.action === "status") return withTrader(id, async () => json(await futStatus()));
  return json({ error: "Unknown." }, 404);
}

/** The signed-in admin's AI trader id (the futures trader shares it). */
async function mine(): Promise<number | null> {
  const who = await adminState();
  if (!who.staff) return null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const { data } = await supabaseService().from("ai_trader_settings").select("id").eq("user_id", user.id).maybeSingle();
  return data?.id ? Number(data.id) : null;
}

/** ?desk=fx: the admin's Forex trader, ?desk=earn: their Earn desk (each its own id), otherwise their Futures trader. */
const desk = (req: Request, id: number | null) => {
  const d = new URL(req.url).searchParams.get("desk");
  const off: Record<string, number> = { fx: FX_DESK, earn: EARN_DESK, turbo: TURBO_DESK, snipe: SNIPE_DESK };
  return id && d && off[d] ? off[d] + id : id;
};

const clamp = (v: unknown, lo: number, hi: number) => { const x = Number(v); return isFinite(x) ? Math.min(hi, Math.max(lo, x)) : undefined; };

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const id = desk(req, await mine());
  if (!id) return json({ error: "Open the AI Trader page once first (Admin → AI trader), then come back." }, 403);
  const b = await req.json().catch(() => ({}));
  return withTrader(id, async () => {
    const sb = supabaseService();
    try {
      switch (params.action) {
        case "settings": {
          const s = await getF();
          const up: Record<string, unknown> = {};
          if (typeof b.enabled === "boolean") up.enabled = b.enabled;
          for (const k of ["use_ta", "use_news", "use_x", "no_liq", "auto_fund"]) if (typeof b[k] === "boolean") up[k] = b[k];
          const nums: Record<string, [number, number]> = { max_lev: [1, 50], max_loss_pct: [1, 90], risk_pct: [0.25, 3], max_positions: [1, 8], daily_loss_pct: [1, 25], max_hold_hours: [1, 168], snipe_usd: [1, 10000], snipe_tp: [10, 1000], snipe_sl: [5, 90], snipe_budget: [0, 1_000_000], profit_lock_pct: [0, 500] };
          for (const [k, [lo, hi]] of Object.entries(nums)) if (b[k] != null) { const v = clamp(b[k], lo, hi); if (v != null) up[k] = k === "max_positions" ? Math.round(v) : v; }
          if (Array.isArray(b.venues)) up.venues = VENUES.filter((v) => b.venues.includes(v));
          if (Array.isArray(b.coins)) up.coins = [...new Set(b.coins.map((c: unknown) => String(c).trim().toUpperCase()).filter((c: string) => /^[A-Z0-9]{1,12}$/.test(c)))].slice(0, 15);
          if (Array.isArray(b.x_handles)) up.x_handles = [...new Set(b.x_handles.map((h: unknown) => String(h).trim().replace(/^@/, "")).filter((h: string) => /^[A-Za-z0-9_]{1,15}$/.test(h)))].slice(0, 20);
          if (b.mode === "paper" || b.mode === "live") {
            if (b.mode === "live") {
              const { data: open } = await sb.from("ai_futures_positions").select("id").eq("fut_id", id).eq("mode", "paper").in("status", ["open", "closing"]).limit(1);
              if (isSnipeDesk()) {
                const sw = await (await import("@/lib/ai-sniper")).snipeWallet().catch(() => null);
                if (!sw) return json({ error: "Create or import the Sniper's Solana wallet first." }, 400);
                if (!(Number((s as any).snipe_budget ?? b.snipe_budget) > 0)) return json({ error: "Set the Sniper budget first: how much of the shared Solana wallet it may trade with." }, 400);
                if (sw.usdt + sw.usdc < 5 && sw.sol * sw.solUsd < 5) return json({ error: `The Solana wallet has about $${sw.total.toFixed(2)}. Send at least $5 of USDT / USDC (plus ~0.02 SOL for fees) to ${sw.address} first.` }, 400);
                if (open?.length) await closeAllNow("paper");
                up.mode = b.mode; up.day = null; up.day_start_usd = null;
                const { error } = await sb.from("ai_futures_settings").update(up).eq("id", id);
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true, note: "Sniper is LIVE: it buys with the money in its Solana wallet." });
              }
              const w = await futWallet();
              if (!w) return json({ error: "Create the AI Futures wallet first." }, 400);
              if ((w.hlValue ?? 0) < 10) return json({ error: `The wallet has $${(w.hlValue ?? 0).toFixed(2)} on Hyperliquid. Fund it with at least $10 (see How to fund) before going live.` }, 400);
              if (!(up.venues as string[] | undefined ?? s.venues).some((v) => LIVE_VENUES.includes(v))) return json({ error: "Switch Hyperliquid or Forex on: live trading runs on Hyperliquid." }, 400);
              // Practice trades are pretend: close them so the AI starts fresh with the real money.
              if (open?.length) await closeAllNow("paper");
            } else {
              const { data: open } = await sb.from("ai_futures_positions").select("id").eq("fut_id", id).eq("mode", "live").in("status", ["open", "closing"]).limit(1);
              if (open?.length) return json({ error: "Close the live positions first (or let them finish)." }, 400);
            }
            up.mode = b.mode; up.day = null; up.day_start_usd = null;
          }
          if (!Object.keys(up).length) return json({ error: "Nothing to change." }, 400);
          const { error } = await sb.from("ai_futures_settings").update(up).eq("id", id);
          if (error) return json({ error: error.message }, 400);
          await flog("settings", `Settings changed: ${Object.entries(up).filter(([k]) => !["day", "day_start_usd"].includes(k)).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(", ") : v}`).join("; ")}`);
          return json({ ok: true, note: up.mode === "live" ? "LIVE: the AI now trades real money on Hyperliquid." : up.enabled === true ? "AI Futures is on." : up.enabled === false ? "Off. Open positions are still watched." : "Saved." });
        }
        case "wallet": { const address = await createFutWallet(); return json({ ok: true, address, note: "Wallet created. See How to fund." }); }
        case "key-reveal": return json({ ok: true, key: await revealFutKey() });
        case "sol-wallet": { const address = await createFutSolWallet(); return json({ ok: true, address, note: `Solana wallet ready: send USDT or USDC (plus ~0.01 SOL for fees) to ${address}. It moves to Hyperliquid by itself.` }); }
        case "sol-key-import": { const address = await importFutSolKey(String(b.key || "")); return json({ ok: true, address, note: `Perps now take funds from your Solana wallet ${address.slice(0, 4)}…${address.slice(-4)}.` }); }
        case "sol-key-reveal": return json({ ok: true, key: await revealFutSolKey() });
        case "key-import": { const address = await importFutKey(String(b.key || "")); return json({ ok: true, address, note: `Futures now trade from your wallet ${address.slice(0, 6)}…${address.slice(-4)}.` }); }
        case "fund-sol": {
          // USDT / USDC from the AI trader's Solana wallet straight into this futures account on Hyperliquid (Relay).
          const amt = Number(b.usd), sym = b.symbol === "USDC" ? "USDC" : "USDT";
          if (!isFinite(amt) || amt < 5 || amt > 100_000) return json({ error: "Send between $5 and $100,000." }, 400);
          const r = await fundFromSolana(amt, sym, b.quote === true, b.from === "trader" ? "trader" : "perps");
          return json({ ok: true, ...r, note: b.quote === true ? `You'd get about $${(r.receive ?? amt).toFixed(2)} on Hyperliquid (fee about $${r.feeUsd.toFixed(2)}${r.seconds ? `, ~${r.seconds}s` : ""}).` : `Sent. About $${(r.receive ?? amt).toFixed(2)} arrives on Hyperliquid in about a minute.` });
        }
        case "deposit": { const tx = await depositToHl(); return json({ ok: true, note: `Sent to Hyperliquid (tx ${tx.slice(0, 10)}…). It shows there in about a minute.` }); }
        case "close": { await closeNow(Number(b.id)); return json({ ok: true, note: "Closed." }); }
        case "close-all": { const k = await closeAllNow(); return json({ ok: true, note: k ? `Closed ${k} trade${k === 1 ? "" : "s"}. The money is free to withdraw now.` : "No open trades." }); }
        case "withdraw": {
          const to = b.to === "arbitrum" ? "arbitrum" : b.to === "hyperliquid" ? "hyperliquid" : "solana";
          const amt = Number(b.usd);
          if (!isFinite(amt) || amt <= 0 || amt > 1_000_000) return json({ error: "Enter an amount." }, 400);
          const r = await withdrawFut({ usd: amt, to, address: String(b.address || ""), symbol: b.symbol === "USDC" ? "USDC" : "USDT", quoteOnly: b.quote === true });
          const got = (r.receive ?? amt).toFixed(2);
          return json({ ok: true, ...r, note: b.quote === true ? `You'd receive about $${got} (fee about $${(r.feeUsd ?? 0).toFixed(2)}).` : to === "arbitrum" ? `Withdrawal sent: about $${got} USDC arrives on Arbitrum in ~5 minutes.` : to === "hyperliquid" ? `Sent $${got} to that Hyperliquid account.` : `Withdrawal sent: about $${got} arrives on Solana in about a minute. Track it in Money in & out.` });
        }
        case "run": return json({ ok: true, note: await runFutures() });
        case "move": {
          const dest = ["futures", "forex", "turbo", "sniper"].includes(b.dest) ? b.dest : null;
          if (!dest) return json({ error: "Pick where to move it." }, 400);
          return json({ ok: true, note: await moveToDesk(dest, Number(b.usd)) });
        }
        case "earn": {
          const usd = Number(b.usd);
          if (!(usd > 0) || usd > 1_000_000) return json({ error: "Type a dollar amount, like 50." }, 400);
          return json({ ok: true, note: await earnMove(b.op !== "withdraw", usd) });
        }
        case "reset": {
          const s = await getF();
          if (s.mode !== "paper") return json({ error: "Reset is for practice only." }, 400);
          const usd = clamp(b.usd, 100, 1_000_000) ?? 1000;
          await sb.from("ai_futures_positions").delete().eq("fut_id", id).eq("mode", "paper");
          await sb.from("ai_futures_settings").update({ paper_usd: usd, paper_start: usd, day: null, day_start_usd: null }).eq("id", id);
          await flog("settings", `Practice account reset to $${usd}.`);
          return json({ ok: true, note: `Practice account reset to $${usd}.` });
        }
        default: return json({ error: "Unknown." }, 404);
      }
    } catch (e) { return json({ error: (e as Error).message }, 400); }
  });
}
