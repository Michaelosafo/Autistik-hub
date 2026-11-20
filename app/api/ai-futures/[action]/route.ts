/**
 * AI Futures (separate from the copy-trading AI trader).
 * GET /api/ai-futures/cron: every minute, runs every futures trader that's on or still has open positions.
 * GET /api/ai-futures/status: the signed-in admin's futures trader.
 * POST settings | wallet | key-reveal | deposit | close | run | reset (admins, their own only).
 */
import { adminState } from "@/lib/admin";
import { cronDenied } from "@/lib/cron-auth";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { withTrader } from "@/lib/ai-trader-ctx";
import { moveToDesk, EARN_DESK, FX_DESK, SNIPE_DESK, TURBO_DESK, COPY_DESK, LIQ_DESK, MAD_DESK, isCopyDesk, isLiqDesk, isSpotDesk, earnMove, LIVE_VENUES, VENUES, closeAllNow, closeNow, withdrawFut, createFutSolWallet, createFutWallet, depositToHl, flog, fundFromSolana, futStatus, futWallet, getF, importFutKey, importFutSolKey, revealFutKey, revealFutSolKey, runFutures, setStopTarget } from "@/lib/ai-futures";

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
    // Each desk gets 52s; a slow one is reported instead of timing out the whole minute for all 8 desks.
    const capped = <X,>(p: Promise<X>) => Promise.race([p, new Promise<X>((_, no) => setTimeout(() => no(new Error("still running after 52s, continues next minute")), 52_000))]);
    const out = await Promise.all(ids.map((id) => capped(withTrader(id, () => runFutures())).then((r) => ({ id, r }), (e) => ({ id, r: `error: ${(e as Error).message}` }))));
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
  const off: Record<string, number> = { fx: FX_DESK, earn: EARN_DESK, turbo: TURBO_DESK, snipe: SNIPE_DESK, copy: COPY_DESK, liq: LIQ_DESK, mad: MAD_DESK };
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
          const nums: Record<string, [number, number]> = { max_lev: [1, 50], max_loss_pct: [1, 90], risk_pct: [0.25, 3], max_positions: [1, 8], daily_loss_pct: [1, 25], max_hold_hours: [1, 168], snipe_usd: [1, 10000], snipe_tp: [10, 1000], snipe_sl: [5, 90], snipe_budget: [0, 1_000_000], profit_lock_pct: [0, 500], stop_pct: [0, 50] };
          for (const [k, [lo, hi]] of Object.entries(nums)) if (b[k] != null) { const v = clamp(b[k], lo, hi); if (v != null) up[k] = k === "max_positions" ? Math.round(v) : v; }
          let exits = false;
          if (isCopyDesk()) for (const k of ["copy_sl_on", "copy_tp_on"]) if (typeof b[k] === "boolean") { up[k] = b[k]; exits = true; }
          if (isCopyDesk()) {
            if (b.copy_key_usd && typeof b.copy_key_usd === "object") {
              // { "1": 5, "3": 20 }: $ per buy for those wallets; missing / empty = the normal amount.
              const m: Record<string, number> = {};
              for (const [k, v] of Object.entries(b.copy_key_usd)) { const slot = Number(k), x = clamp(v, 0.5, 100000); if (slot >= 1 && slot <= 13 && x != null && Number(v) > 0) m[String(slot)] = x; }
              up.copy_key_usd = m;
            }
            if (typeof b.copy_mev === "boolean") up.copy_mev = b.copy_mev;
            if (b.copy_gwei != null) { const v = clamp(b.copy_gwei, 0.05, 20); if (v != null) up.copy_gwei = v; }
            if (b.copy_slip != null) { const v = clamp(b.copy_slip, 3, 15); if (v != null) up.copy_slip = v; }
          }
          if (isLiqDesk()) {
            if (b.liq_x != null) { const v = clamp(b.liq_x, 1.05, 1000); if (v != null) up.liq_x = v; }
            if (b.liq_sell_pct != null) { const v = clamp(b.liq_sell_pct, 5, 100); if (v != null) up.liq_sell_pct = v; }
            if (b.liq_slip != null) { const v = clamp(b.liq_slip, 3, 49); if (v != null) up.liq_slip = v; }
            if (typeof b.liq_tp_on === "boolean") up.liq_tp_on = b.liq_tp_on;
            if (b.snipe_amounts && typeof b.snipe_amounts === "object") {
              // { "1": { "bsc": 0.05, "solana": 0.5 } }: each wallet's snipe amount per chain, in that chain's coin.
              const m: Record<string, Record<string, number>> = {};
              for (const [k, per] of Object.entries(b.snipe_amounts)) {
                const slot = Number(k);
                if (!(slot >= 1 && slot <= 13) || !per || typeof per !== "object") continue;
                const row: Record<string, number> = {};
                for (const c of ["bsc", "ethereum", "base", "arbitrum", "solana"]) { const v = Number((per as any)[c]); if (v > 0 && isFinite(v) && v <= 1_000_000) row[c] = v; }
                if (Object.keys(row).length) m[String(slot)] = row;
              }
              up.snipe_amounts = m;
            }
            if (Array.isArray(b.liq_targets)) {
              // Tokens to snipe: 0x addresses, each once.
              const seen = new Set<string>();
              // BNB Chain only: the sniper buys with BNB or USDT from each picked wallet's BSC address.
              const pays = ["native", "usdt"];
              const prios = ["low", "med", "high", "max"];
              // SniperBnbSol: 0x tokens on BNB Chain. SniperLobbySol: Solana mints.
              const mint = (token: string, chain: string) => chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : /^0x[0-9a-fA-F]{40}$/.test(token);
              const keyOf = (token: string) => token.startsWith("0x") ? token.toLowerCase() : token;
              up.liq_targets = b.liq_targets.map((t: any) => ({
                token: String(t?.token || "").trim(), label: String(t?.label || "").trim().slice(0, 24) || undefined, usd: clamp(t?.usd, 0.5, 100000),
                chain: !t?.chain || t.chain === "bsc" ? "bsc" : t.chain === "solana" ? "solana" : "other",
                pay: pays.includes(t?.pay) ? t.pay : undefined,
                amount: clamp(t?.amount, 0, 1_000_000_000),
                // Each picked wallet's own amount for this token (in the pay coin); missing = `amount`.
                amounts: t?.amounts && typeof t.amounts === "object" ? (() => {
                  const m: Record<string, number> = {};
                  for (const [k, v] of Object.entries(t.amounts)) { const slot = Number(k), x = Number(v); if (slot >= 1 && slot <= 13 && x > 0 && isFinite(x) && x <= 1_000_000_000) m[String(slot)] = x; }
                  return Object.keys(m).length ? m : undefined;
                })() : undefined,
                prio: prios.includes(t?.prio) ? t.prio : undefined,
                on: t?.on !== false, state: ["waiting", "done", "failed"].includes(t?.state) ? t.state : "waiting", added: String(t?.added || new Date().toISOString()),
                // Which wallets snipe it (1–13); none = all.
                wallets: Array.isArray(t?.wallets) ? [...new Set(t.wallets.map(Number).filter((x: number) => x >= 1 && x <= 13))].sort((a: number, b: number) => a - b) : undefined,
                // Wallets that already sent their buy (kept so they never buy twice) and when the first did.
                fired: Array.isArray(t?.fired) ? [...new Set(t.fired.map(Number).filter((x: number) => x >= 1 && x <= 13))].sort((a: number, b: number) => a - b) : undefined,
                first_at: t?.first_at && !isNaN(Date.parse(t.first_at)) ? String(t.first_at) : undefined,
              })).filter((t: any) => (t.chain === "bsc" || t.chain === "solana") && mint(t.token, t.chain) && !seen.has(keyOf(t.token)) && seen.add(keyOf(t.token))).slice(0, 30);
            }
          }
          if (Array.isArray(b.copy_wallets) && isCopyDesk()) {
            // BNB Chain only: 0x… addresses.
            const seen = new Set<string>();
            up.copy_wallets = b.copy_wallets.map((w: any) => ({ address: String(w?.address || "").trim(), chain: "bsc", label: String(w?.label || "").trim().slice(0, 24) || undefined, usd: clamp(w?.usd, 1, 10000), on: w?.on !== false }))
              .filter((w: any) => /^0x[0-9a-fA-F]{40}$/.test(w.address) && !seen.has(w.address.toLowerCase()) && seen.add(w.address.toLowerCase())).slice(0, 25);
          }
          if (Array.isArray(b.venues)) up.venues = VENUES.filter((v) => b.venues.includes(v));
          if (Array.isArray(b.coins) || Array.isArray(b.extra_coins)) {
            // Only coins Hyperliquid really lists, with its exact name (e.g. "kPEPE"), whatever case you typed.
            const { hlMarket } = await import("@/lib/hyperliquid");
            const names = new Map([...(await hlMarket()).keys()].map((k) => [k.toLowerCase(), k] as const));
            for (const key of ["coins", "extra_coins"] as const) {
              if (!Array.isArray(b[key])) continue;
              const want = b[key].map((c: unknown) => String(c).trim()).filter(Boolean);
              const bad = want.filter((c: string) => !names.has(c.toLowerCase()) && !names.has(("k" + c).toLowerCase()));
              if (bad.length) return json({ error: `Hyperliquid doesn't list ${bad.join(", ")}. Use the name Hyperliquid shows (e.g. BTC, SOL, HYPE, kPEPE).` }, 400);
              up[key] = [...new Set(want.map((c: string) => names.get(c.toLowerCase()) || names.get(("k" + c).toLowerCase())!))].slice(0, 20);
            }
          }
          if (Array.isArray(b.x_handles)) up.x_handles = [...new Set(b.x_handles.map((h: unknown) => String(h).trim().replace(/^@/, "")).filter((h: string) => /^[A-Za-z0-9_]{1,15}$/.test(h)))].slice(0, 20);
          if (b.mode === "paper" || b.mode === "live") {
            if (b.mode === "live") {
              const { data: open } = await sb.from("ai_futures_positions").select("id").eq("fut_id", id).eq("mode", "paper").in("status", ["open", "closing"]).limit(1);
              if (isCopyDesk()) {
                const { copyKeys } = await import("@/lib/ai-copy");
                const k = await copyKeys();
                const have = k.keys.filter((x) => x.address);
                if (!have.length) return json({ error: "Add at least one wallet (private key) for Copy to buy with first." }, 400);
                const funded = have.some((x) => Number(x.bnb) > 0.005);
                if (open?.length) await closeAllNow("paper");
                up.mode = b.mode; up.day = null; up.day_start_usd = null;
                const { error } = await sb.from("ai_futures_settings").update(up).eq("id", id);
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true, note: `${isLiqDesk() ? "Sniper" : "Copy"} is LIVE: ${have.length > 1 ? `${have.length} wallets buy` : `wallet ${have[0].slot} buys`} on BNB Chain.${funded ? "" : ` They hold almost no BNB yet: send BNB (BNB Chain / BEP20) to ${have.map((x) => x.address).join(" or ")} so they can buy.`}` });
              }
              if (isSpotDesk()) {
                const nm = isCopyDesk() ? "Copy" : "Sniper";
                const sw = await (await import("@/lib/ai-sniper")).snipeWallet().catch(() => null);
                if (!sw) return json({ error: "Create or import the shared Solana wallet first." }, 400);
                if (!(Number(b.snipe_budget ?? (s as any).snipe_budget) > 0)) return json({ error: `Set the ${nm} budget first: how much of the shared Solana wallet it may trade with.` }, 400);
                if (sw.usdt + sw.usdc < 5 && sw.sol * sw.solUsd < 5) return json({ error: `The Solana wallet has about $${sw.total.toFixed(2)}. Send at least $5 of USDT / USDC (plus ~0.02 SOL for fees) to ${sw.address} first.` }, 400);
                if (open?.length) await closeAllNow("paper");
                up.mode = b.mode; up.day = null; up.day_start_usd = null;
                const { error } = await sb.from("ai_futures_settings").update(up).eq("id", id);
                if (error) return json({ error: error.message }, 400);
                return json({ ok: true, note: `${nm} is LIVE: it buys with its budget in the shared Solana wallet.` });
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
          if (error) return json({ error: /snipe_amounts/.test(error.message) ? "Run supabase/2026-11-19-sniper-amounts.sql in Supabase, then try again." : error.message }, 400);
          if (exits) await (await import("@/lib/ai-copy")).applyExitSwitches(await getF());
          await flog("settings", `Settings changed: ${Object.entries(up).filter(([k]) => !["day", "day_start_usd"].includes(k)).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.map((x: any) => (x && typeof x === "object" ? x.label || x.address : x)).join(", ") : v}`).join("; ")}`);
          return json({ ok: true, note: up.mode === "live" ? "LIVE: the AI now trades real money on Hyperliquid." : up.enabled === true ? "AI Futures is on." : up.enabled === false ? "Off. Open positions are still watched." : "Saved." });
        }
        case "copy-key-set": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          const { setCopyKey } = await import("@/lib/ai-copy");
          const address = await setCopyKey(Number(b.slot), String(b.key || ""));
          return json({ ok: true, address, note: `Wallet ${Number(b.slot)} added: ${address.slice(0, 6)}…${address.slice(-4)}. Send BNB to it so it can buy.` });
        }
        case "copy-sell": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          const frac = Number(b.frac) > 0 ? Math.min(1, Number(b.frac)) : 1;
          const note = await (await import("@/lib/ai-copy")).sellCopyNow(await getF(), Number(b.id), frac);
          return json({ ok: true, note: note || (frac >= 1 ? "Sold. See the log for the result." : `Sold ${Math.round(frac * 100)}%. See the log for the result.`) });
        }
        case "copy-exits": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
          const st = num(b.stop), tg = num(b.target);
          if ((st != null && !isFinite(st)) || (tg != null && !isFinite(tg))) return json({ error: "Type a number." }, 400);
          return json({ ok: true, note: await (await import("@/lib/ai-copy")).setCopyExits(Number(b.id), st, tg) });
        }
        case "copy-key-new": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          const { createCopyKey } = await import("@/lib/ai-copy");
          const count = Math.min(13, Math.max(1, Math.floor(Number(b.count) || 1)));
          if (count > 1) {
            // Fill the free slots, one after another.
            const made: { slot: number; address: string }[] = [];
            for (let i = 0; i < count; i++) made.push(await createCopyKey().catch(() => null as any));
            const ok = made.filter(Boolean);
            return json({ ok: true, made: ok, note: `Created ${ok.length} wallet${ok.length === 1 ? "" : "s"} (${ok.map((m) => `#${m.slot}`).join(", ")}). Fund each with BNB / USDT on BNB Chain.` });
          }
          const r = await createCopyKey(Number(b.slot) || undefined);
          return json({ ok: true, ...r, note: `Wallet ${r.slot} created: ${r.address}. Send BNB or USDT (BNB Chain / BEP20) to it and it starts buying.` });
        }
        case "copy-key-reveal": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          return json({ ok: true, key: await (await import("@/lib/ai-copy")).revealCopyKey(Number(b.slot)) });
        }
        case "copy-transfer": {
          if (!isCopyDesk()) return json({ error: "Copy / Sniper only." }, 400);
          const slow = await rateLimit(req, "copy-transfer", 12, 60, String(id));
          if (slow) return slow;
          const amount = b.amount === "max" ? "max" : Number(b.amount);
          const note = await (await import("@/lib/ai-copy")).transferBetween(Number(b.from), Number(b.to), String(b.asset || ""), amount as number | "max");
          return json({ ok: true, note });
        }
        case "sniper-balances":
        case "sniper-transfer-preview":
        case "sniper-transfer":
        case "sniper-swap-quote":
        case "sniper-swap": {
          if (!isCopyDesk()) return json({ error: "Sniper only." }, 400);
          const cap = params.action === "sniper-swap" || params.action === "sniper-transfer" ? 8 : 40;
          const slow = await rateLimit(req, params.action, cap, 60, String(id));
          if (slow) return slow;
          const w = await import("@/lib/sniper-wallet");
          const amount = b.amount === "max" ? "max" as const : Number(b.amount);
          const chain = String(b.chain || "bsc");
          if (params.action === "sniper-balances") {
            const chains = await import("@/lib/sniper-chains");
            return json(await chains.cardHoldings(Number(b.slot), chain, Array.isArray(b.extra) ? b.extra.map(String) : []));
          }
          if (params.action === "sniper-transfer-preview") return json(await w.transferPreview(Number(b.from), Number(b.to), String(b.asset || ""), amount, chain));
          if (params.action === "sniper-transfer") return json({ ok: true, note: await w.transferSend(Number(b.from), Number(b.to), String(b.asset || ""), amount, chain) });
          const slip = Number(b.slippageBps ?? 100);
          const chains = await import("@/lib/sniper-chains");
          if (chain === "solana" && params.action === "sniper-swap-quote") return json(await chains.solSwapQuote(Number(b.slot), String(b.tokenIn || ""), String(b.tokenOut || ""), amount, slip));
          if (chain === "solana" && params.action === "sniper-swap") return json({ ok: true, note: await chains.solSwapSend(Number(b.slot), String(b.tokenIn || ""), String(b.tokenOut || ""), amount, slip, String(b.minOutRaw || ""), b.confirmImpact === true) });
          if (params.action === "sniper-swap-quote") return json(await w.swapQuote(Number(b.slot), chain, String(b.tokenIn || ""), String(b.tokenOut || ""), amount, slip));
          return json({ ok: true, note: await w.swapSend(Number(b.slot), chain, String(b.tokenIn || ""), String(b.tokenOut || ""), amount, slip, String(b.minOutRaw || ""), b.confirmImpact === true) });
        }
        case "sniper-detect":
        case "sniper-ready": {
          if (!isLiqDesk()) return json({ error: "Sniper only." }, 400);
          const slow = await rateLimit(req, params.action, 30, 60, String(id));
          if (slow) return slow;
          if (params.action === "sniper-detect") {
            const { detectSnipeBsc, detectSnipeSol } = await import("@/lib/sniper-detect");
            return json(b.net === "solana" ? await detectSnipeSol(String(b.token || "")) : await detectSnipeBsc(String(b.token || "")));
          }
          const { snipeReady } = await import("@/lib/sniper-fire");
          const chain = String(b.chain || "");
          const pay = b.pay === "usdt" ? "usdt" : "native";
          if (chain !== "bsc" && chain !== "solana") return json({ error: "Pick BNB Chain or Solana." }, 400);
          const slots = Array.isArray(b.slots) ? b.slots.map(Number).filter((x: number) => x >= 1 && x <= 13) : [];
          const amounts: Record<string, number> = {};
          if (b.amounts && typeof b.amounts === "object") for (const [k, v] of Object.entries(b.amounts)) { const x = Number(v); if (Number(k) >= 1 && Number(k) <= 13 && x > 0 && isFinite(x)) amounts[k] = x; }
          return json(await snipeReady(chain as any, pay, Number(b.amount) || 0, slots, amounts, b.usd === true));
        }
        case "sniper-card":
        case "sniper-sol-create":
        case "sniper-sol-reveal":
        case "sniper-sol-import":
        case "sniper-bridge-quote":
        case "sniper-bridge": {
          if (!isLiqDesk()) return json({ error: "Sniper only." }, 400);
          // Bridges: up to 15 a minute, so one tap can bridge to all 13 wallets.
          const cap = params.action === "sniper-bridge" ? 15 : ["sniper-sol-create", "sniper-sol-reveal", "sniper-sol-import"].includes(params.action) ? 6 : 30;
          const slow = await rateLimit(req, params.action, cap, 60, String(id));
          if (slow) return slow;
          const chains = await import("@/lib/sniper-chains");
          if (params.action === "sniper-card") return json(await chains.walletCard(Number(b.slot)));
          if (params.action === "sniper-sol-reveal") return json({ ok: true, ...(await chains.revealSniperSol(Number(b.slot))) });
          if (params.action === "sniper-sol-import") {
            const made = await chains.importSniperSol(Number(b.slot), String(b.key || ""));
            return json({ ok: true, ...made, note: `Wallet ${made.slot} now uses your Solana wallet ${made.address}.` });
          }
          if (params.action === "sniper-sol-create") {
            const made = await chains.createSniperSol(Number(b.slot));
            return json({ ok: true, ...made, note: `Solana address for wallet ${made.slot}: ${made.address}` });
          }
          const amount = b.amount === "max" ? "max" as const : Number(b.amount);
          if (params.action === "sniper-bridge-quote") return json(await chains.bridgeQuote(Number(b.from), Number(b.to), String(b.fromChain || ""), String(b.toChain || ""), String(b.assetIn || ""), String(b.assetOut || ""), amount));
          return json({ ok: true, note: await chains.bridgeSend(Number(b.from), Number(b.to), String(b.fromChain || ""), String(b.toChain || ""), String(b.assetIn || ""), String(b.assetOut || ""), amount, String(b.minOutRaw || "0")) });
        }
        case "sniper-withdraw-preview":
        case "sniper-withdraw": {
          if (!isLiqDesk()) return json({ error: "Sniper only." }, 400);
          const slow = await rateLimit(req, params.action, params.action.endsWith("preview") ? 20 : 8, 60, String(id));
          if (slow) return slow;
          const w = await import("@/lib/sniper-wallet");
          const amount = b.amount === "max" ? "max" as const : Number(b.amount);
          const asset = String(b.asset || "");
          const to = String(b.to || "");
          if (params.action === "sniper-withdraw-preview") return json(await w.withdrawPreview(Number(b.slot), asset, amount, to));
          return json({ ok: true, note: await w.withdrawSend(Number(b.slot), asset, amount, to) });
        }
        case "copy-key-remove": {
          if (!isCopyDesk()) return json({ error: "Copy only." }, 400);
          const k = await (await import("@/lib/ai-copy")).removeCopyKey(Number(b.slot));
          return json({ ok: true, note: `Wallet ${Number(b.slot)} removed${k ? `; its ${k} open trade${k === 1 ? "" : "s"} taken off (the coins stay in that wallet)` : ""}.` });
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
        case "stop": {
          const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
          const st = num(b.stop), tg = num(b.target);
          if ((st != null && !isFinite(st)) || (tg != null && !isFinite(tg))) return json({ error: "Type a price, like 64250." }, 400);
          return json({ ok: true, note: await setStopTarget(Number(b.id), st, tg) });
        }
        case "move": {
          const dest = ["futures", "forex", "turbo", "sniper", "copy", "madness", "earn"].includes(b.dest) ? b.dest : null;
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
