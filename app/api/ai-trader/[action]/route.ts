import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { ACTIVE_MS, TRADE_CHAINS, adminActive, closePosition, createTraderWallet, importTraderKey, revealTraderKey, getSettings, liveBalance, log, runTrader, traderAccount, withdrawBnb, type Position } from "@/lib/ai-trader";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { T, tq, withTrader } from "@/lib/ai-trader-ctx";
import { tgaChats, tgaCode, tgaLogout, tgaPassword, tgaQrCheck, tgaQrStart, tgaResend, tgaReset, tgaStart, tgaStatus } from "@/lib/tg-account";
import { cronDenied } from "@/lib/cron-auth";
import { runAll, tradeSize } from "@/lib/ai-trader";
import { xReady } from "@/lib/ai-signals";
import { COPY_MAX_TAX } from "@/lib/ai-trader";
import { tgLinkStart, tgReady, tgSetHook, xAuthUrl, xCommunity, xFinish, xFollowing, xLoginReady, xMyLists, xReadReady, xSignOut } from "@/lib/ai-trader-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AI trader. Every admin (owner and the admins they add) has their own trader: settings, wallet, Telegram / X logins,
 * followed sources and trades. Each request works on the signed-in admin's own trader only.
 * GET /api/ai-trader/cron: the schedule (every 5 minutes; runs at most every 4).
 * GET /api/ai-trader/status: settings, positions, log, wallet (admins).
 * POST settings | run | close | edit | reset (admins).
 */
export async function GET(_req: Request, { params }: { params: { action: string } }) {
  if (params.action === "cron") {
    const denied = cronDenied(_req);
    if (denied) return denied;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "not set up" }, 503);
    return json(await runAll("scan").catch((e) => ({ error: (e as Error).message })));
  }
  if (params.action === "fast") {
    const denied = cronDenied(_req);
    if (denied) return denied;
    return json(await runAll("fast").catch((e) => ({ error: (e as Error).message })));
  }
  const tid = await myTrader();
  if (!tid) return json({ error: "Admins only." }, 403);
  return withTrader(tid, () => getMine(_req, params.action));
}

/** The signed-in admin's trader (made the first time they open the page). The owner's is the original one. */
async function myTrader(): Promise<number | null> {
  const who = await adminState();
  if (!who.staff) return null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const sb = supabaseService();
  const { data } = await sb.from("ai_trader_settings").select("id").eq("user_id", user.id).maybeSingle();
  if (data?.id) return Number(data.id);
  const { data: made, error } = await sb.from("ai_trader_settings").insert({ user_id: user.id, enabled: false, mode: "paper", paper_cash: 1, paper_start: 1 }).select("id").single();
  if (error) {
    const { data: again } = await sb.from("ai_trader_settings").select("id").eq("user_id", user.id).maybeSingle(); // opened twice at once
    return again?.id ? Number(again.id) : null;
  }
  await sb.from("ai_trader_x_auth").upsert({ id: made.id }, { onConflict: "id", ignoreDuplicates: true });
  return Number(made.id);
}

async function getMine(_req: Request, action: string) {
  const params = { action };
  if (params.action === "x-callback") {
    // X sends the owner back here after they sign in.
    const back = (q: string) => Response.redirect(`${new URL(_req.url).origin}/admin/ai-trader?${q}`, 302);
    const u = new URL(_req.url);
    if (u.searchParams.get("error")) return back("x=cancelled");
    try { const name = await xFinish(u.searchParams.get("code") || "", u.searchParams.get("state") || ""); await log("settings", `Signed in with X as @${name}.`); return back(`x=ok&as=${encodeURIComponent(name)}`); }
    catch (e) { return back(`x=error&why=${encodeURIComponent((e as Error).message.slice(0, 120))}`); }
  }
  if (params.action !== "status") return json({ error: "Not found." }, 404);
  const who = await adminState();
  const sb = supabaseService();
  // Having this page open counts as being around (hands-on mode).
  await sb.from("ai_trader_settings").update({ admin_seen_at: new Date().toISOString() }).eq("id", T());
  const [s, { data: open }, { data: closed }, { data: logs }, { data: sigs }, wallet] = await Promise.all([
    getSettings(),
    tq("ai_trader_positions").select("*").in("status", ["open", "closing"]).order("opened_at", { ascending: false }),
    tq("ai_trader_positions").select("*").eq("status", "closed").order("closed_at", { ascending: false }).limit(50),
    tq("ai_trader_log").select("*").order("at", { ascending: false }).limit(60),
    tq("ai_trader_signals").select("id,at,source,who,body,url,chain,token,symbol,mcap,result").not("result", "is", null).order("at", { ascending: false }).limit(40),
    liveBalance().catch(() => null),
  ]);
  const [{ data: srcs }, { data: callers }, { data: rebuys }] = await Promise.all([
    tq("ai_trader_sources").select("id,kind,ref,title,enabled,last_post_at,added_at").order("added_at", { ascending: true }),
    tq("ai_trader_callers").select("id,platform,who,usd").order("usd", { ascending: false }),
    tq("ai_trader_rebuy").select("id,chain,token,symbol,sold_usd,low_usd,status,note,sold_at").order("sold_at", { ascending: false }).limit(15),
  ]);
  const done = ((closed || []) as Position[]).filter((p) => p.mode === s.mode);
  const pnl = done.reduce((a, p) => a + (Number(p.pnl) || 0), 0);
  const wins = done.filter((p) => (Number(p.pnl) || 0) > 0).length;
  return json({
    signals: sigs || [], sources: { x: xReady(), telegram: !!process.env.TELEGRAM_BOT_TOKEN },
    copy: {
      sources: srcs || [], maxTax: COPY_MAX_TAX, callers: callers || [], rebuys: rebuys || [],
      tg: { ready: tgReady(), linked: !!s.tg_user_id, username: s.tg_username },
      tga: await tgaStatus().catch(() => ({ ready: false, signedIn: false, name: null, stage: null, hint: null, chats: null, chatsAt: null })),
      x: { loginReady: xLoginReady(), signedIn: !!s.x_username, username: s.x_username, canRead: await xReadReady().catch(() => false), communities: !!process.env.TWITTERAPI_IO_KEY },
    },
    perTradeBnb: await tradeSize(s).catch(() => s.per_trade),
    settings: s, open: open || [], closed: closed || [], log: logs || [],
    wallet: wallet ?? { address: null, bnb: null }, liveReady: !!(await traderAccount()), owner: true, isOwner: who.admin, traderId: T(),
    active: adminActive({ ...s, admin_seen_at: new Date().toISOString() }), activeMinutes: ACTIVE_MS / 60_000,
    stats: { trades: done.length, wins, winRate: done.length ? Math.round((wins / done.length) * 100) : null, pnl },
  });
}

const NUM: Record<string, [number, number]> = {
  per_trade_usd: [0, 100_000],
  per_trade: [0.001, 10], max_positions: [1, 20], min_liquidity: [1000, 10_000_000], max_tax: [0, 25], min_age_hours: [0, 720],
  mcap_min: [500, 10_000_000], mcap_max: [1000, 100_000_000], micro_min_liq: [500, 10_000_000], target_profit: [10, 1000], strat_stop: [5, 90],
  stop_loss: [1, 90], take_profit: [1, 2000], trail: [0, 90], max_hold_hours: [1, 720], daily_loss_limit: [0.001, 100],
  copy_tp: [10, 2000], copy_sl: [1, 90], rebuy_dump: [10, 95], rebuy_tp: [5, 1000],
};

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const tid = await myTrader();
  if (!tid) return json({ error: "Admins only." }, 403);
  const b = await req.json().catch(() => ({}));
  return withTrader(tid, () => postMine(params.action, b));
}

async function postMine(action: string, b: any) {
  const params = { action };
  const sb = supabaseService();
  switch (params.action) {
    case "settings": {
      const cur = await getSettings();
      const up: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, [lo, hi]] of Object.entries(NUM)) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(hi, Math.max(lo, Number(b[k])));
      if (typeof b.enabled === "boolean") up.enabled = b.enabled;
      if (typeof b.use_ai === "boolean") up.use_ai = b.use_ai;
      if (typeof b.need_socials === "boolean") up.need_socials = b.need_socials;
      if (typeof b.manual_active === "boolean") up.manual_active = b.manual_active;
      if (typeof b.hype_on === "boolean") up.hype_on = b.hype_on;
      if (typeof b.signals_on === "boolean") up.signals_on = b.signals_on;
      if (typeof b.copy_on === "boolean") up.copy_on = b.copy_on;
      if (typeof b.rebuy_on === "boolean") up.rebuy_on = b.rebuy_on;
      if (["telegram", "x", "general"].includes(b.trade_mode)) up.trade_mode = b.trade_mode;
      if (Array.isArray(b.callers)) up.callers = [...new Set(b.callers.map((h: unknown) => String(h).replace(/^@/, "").trim()).filter((h: string) => /^[A-Za-z0-9_]{1,15}$/.test(h)))].slice(0, 20);
      if (b.caller_mcap_max != null && isFinite(Number(b.caller_mcap_max))) up.caller_mcap_max = Math.min(1e9, Math.max(10_000, Number(b.caller_mcap_max)));
      if (typeof b.dip_on === "boolean") up.dip_on = b.dip_on;
      if (b.away_take_profit != null && isFinite(Number(b.away_take_profit))) up.away_take_profit = Math.min(2000, Math.max(1, Number(b.away_take_profit)));
      // BNB Chain is always on; Ethereum, Robinhood Chain and Solana are optional.
      if (Array.isArray(b.chains)) up.chains = ["bsc", ...TRADE_CHAINS.filter((c) => c !== "bsc" && b.chains.includes(c))];
      if (b.mode === "paper" || b.mode === "live") {
        if (b.mode === "live" && !(await traderAccount())) return json({ error: "Create the trading wallet first (Live wallet, on this page) and send it some BNB." }, 400);
        up.mode = b.mode;
      }
      const { error } = await sb.from("ai_trader_settings").update(up).eq("id", T());
      if (error) return json({ error: error.message }, 400);
      const what = Object.keys(up).filter((k) => k !== "updated_at").map((k) => `${k}=${up[k]}`).join(", ");
      if (what) await log("settings", `Admin changed: ${what}`);
      return json({ ok: true });
    }
    case "wallet": {
      try { const address = await createTraderWallet(); return json({ ok: true, address, note: "Wallet created. Send BNB (BNB Chain) to it, then switch to Live." }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tg-hook": {
      try { const me = await tgSetHook(); return json({ ok: true, note: `Connected @${me.username}. Add it to the groups you want copied.` }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tg-link": {
      try { return json({ ok: true, ...(await tgLinkStart()) }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tg-unlink": {
      await sb.from("ai_trader_settings").update({ tg_user_id: null, tg_username: null }).eq("id", T());
      await log("settings", "Telegram unlinked.");
      return json({ ok: true, note: "Telegram unlinked. Followed groups stay as they are." });
    }
    case "x-login": {
      try { return json({ ok: true, url: await xAuthUrl() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "x-logout": {
      await xSignOut();
      return json({ ok: true, note: "Signed out of X. Lists you follow stay saved but can't be read until you sign in again." });
    }
    case "tga-start": {
      try { return json({ ok: true, ...(await tgaStart(String(b.phone || ""), b.force === true)) }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-qr": {
      try { return json({ ok: true, ...(await tgaQrStart(b.force === true)) }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-qr-check": {
      try { const r = await tgaQrCheck(); if ("ok" in r) await log("settings", `Logged in with Telegram account ${r.name}.`); return json({ ok: true, ...r }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-reset": {
      await tgaReset();
      return json({ ok: true });
    }
    case "tga-resend": {
      try { return json({ ok: true, ...(await tgaResend()) }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-code": {
      try { const r = await tgaCode(String(b.code || "")); if ("ok" in r) await log("settings", `Logged in with Telegram account ${r.name}.`); return json({ ok: true, ...r }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-password": {
      try { const r = await tgaPassword(String(b.password || "")); await log("settings", `Logged in with Telegram account ${r.name}.`); return json(r); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-chats": {
      try { return json({ ok: true, chats: await tgaChats() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "tga-logout": {
      await tgaLogout();
      await log("settings", "Logged out of the Telegram account.");
      return json({ ok: true, note: "Logged out of Telegram. Your ticked groups are switched off." });
    }
    case "x-following": {
      try { return json({ ok: true, accounts: await xFollowing() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "x-lists": {
      try { return json({ ok: true, lists: await xMyLists() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "caller": {
      // Callers whose posts buy a set $ amount: a Telegram @username or user id, or an X handle.
      if (b.op === "remove") { await tq("ai_trader_callers").delete().eq("id", Number(b.id)); return json({ ok: true, note: "Caller removed." }); }
      const platform = b.platform === "x" ? "x" : "tg";
      const usd = Number(b.usd);
      if (!isFinite(usd) || usd <= 0 || usd > 100_000) return json({ error: "Type a dollar amount, like 50." }, 400);
      const list = String(b.who || "").split(/[\s,;]+/).map((w) => w.trim().replace(/^https?:\/\/(www\.)?(t\.me|x\.com|twitter\.com)\//i, "").replace(/^@/, "").split(/[/?]/)[0].toLowerCase()).filter(Boolean);
      const ok = [...new Set(list.filter((w) => /^\d{3,20}$/.test(w) || /^[a-z0-9_]{3,32}$/.test(w)))].slice(0, 50);
      if (!ok.length) return json({ error: "Paste @usernames or numeric user ids, separated by spaces or commas." }, 400);
      const { error } = await tq("ai_trader_callers").upsert(ok.map((who) => ({ platform, who, usd })), { onConflict: "trader_id,platform,who" });
      if (error) return json({ error: error.message }, 400);
      await log("settings", `Caller size $${usd} for ${ok.map((w) => (/^\d+$/.test(w) ? w : `@${w}`)).join(", ")} (${platform === "x" ? "X" : "Telegram"}).`);
      return json({ ok: true, note: `Saved: posts by ${ok.length === 1 ? (/^\d+$/.test(ok[0]) ? ok[0] : `@${ok[0]}`) : `${ok.length} callers`} buy $${usd}.` });
    }
    case "source": {
      // Add, switch on / off, or remove something to copy. Live trading changes are owner only.
      const op = String(b.op || "");
      if (op === "batch") {
        // The Save button: several ticks / unticks at once. adds: [{kind, ref, title, handle}], set: [{id, enabled}].
        const set = (Array.isArray(b.set) ? b.set : []).slice(0, 300);
        for (const x of set) await tq("ai_trader_sources").update({ enabled: !!x.enabled }).eq("id", Number(x.id));
        const adds = (Array.isArray(b.adds) ? b.adds : []).filter((a: any) => a?.kind === "tg_chat" && /^(c:\d+:-?\d+|g:\d+|u:\d+:-?\d+)$/.test(String(a.ref || ""))).slice(0, 100);
        if (adds.length) {
          const { error } = await tq("ai_trader_sources").upsert(adds.map((a: any) => ({ kind: "tg_chat", ref: String(a.ref), title: String(a.title || "Telegram chat").slice(0, 80), enabled: true, ...(/^[A-Za-z0-9_]{4,32}$/.test(String(a.handle || "")) ? { handle: String(a.handle) } : {}) })), { onConflict: "trader_id,kind,ref" });
          if (error) return json({ error: error.message }, 400);
        }
        const { count } = await tq("ai_trader_sources").select("id", { count: "exact", head: true }).eq("kind", "tg_chat").eq("enabled", true);
        if ((count || 0) > 25) await log("settings", `${count} Telegram chats ticked: only 25 are read each minute, taking turns.`);
        await log("settings", `Saved Telegram chats: ${adds.length + set.filter((x: any) => x.enabled).length} on, ${set.filter((x: any) => !x.enabled).length} off.`);
        return json({ ok: true, note: `Saved. Copying ${count || 0} Telegram chat${count === 1 ? "" : "s"}.` });
      }
      if (op === "toggle" || op === "remove") {
        const id = Number(b.id);
        const q = op === "toggle" ? tq("ai_trader_sources").update({ enabled: !!b.enabled }).eq("id", id) : tq("ai_trader_sources").delete().eq("id", id);
        const { error } = await q;
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      if (op === "add") {
        const kind = String(b.kind || "");
        let ref = "", title = "";
        try {
          if (kind === "tg_chat") {
            ref = String(b.ref || "");
            if (!/^(c:\d+:-?\d+|g:\d+|u:\d+:-?\d+)$/.test(ref)) return json({ error: "That isn't one of your Telegram chats." }, 400);
            title = String(b.title || "Telegram chat").slice(0, 80);
          } else if (kind === "x_account") {
            ref = String(b.ref || "").trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@/, "").split(/[/?]/)[0];
            if (!/^[A-Za-z0-9_]{1,15}$/.test(ref)) return json({ error: "That isn't an X handle." }, 400);
            title = `@${ref}`;
          } else if (kind === "x_list") {
            ref = String(b.ref || "").match(/(\d{5,25})/)?.[1] || "";
            if (!ref) return json({ error: "That isn't an X List." }, 400);
            title = String(b.title || `List ${ref}`).slice(0, 80);
          } else if (kind === "x_community") {
            const c = await xCommunity(String(b.ref || ""));
            ref = c.id; title = c.name;
          } else return json({ error: "Unknown source." }, 400);
        } catch (e) { return json({ error: (e as Error).message }, 400); }
        const { count } = await tq("ai_trader_sources").select("id", { count: "exact", head: true }).eq("enabled", true).eq("kind", kind === "tg_chat" ? "tg_chat" : kind).neq("kind", "tg");
        if (kind === "tg_chat" && (count || 0) >= 25) return json({ error: "You're copying 25 Telegram chats already (the most that can be read every minute). Switch one off first." }, 400);
        if (kind !== "tg_chat" && (count || 0) >= 30) return json({ error: "You're following 30 of these already. Switch one off first." }, 400);
        const handle = kind === "tg_chat" && /^[A-Za-z0-9_]{4,32}$/.test(String(b.handle || "")) ? String(b.handle) : null;
        const { error } = await tq("ai_trader_sources").upsert({ kind, ref: kind === "x_account" ? ref.toLowerCase() : ref, title, enabled: true, ...(handle ? { handle } : {}) }, { onConflict: "trader_id,kind,ref" });
        if (error) return json({ error: error.message }, 400);
        await log("settings", `Now copying ${title}.`);
        return json({ ok: true, note: `Now copying ${title}.` });
      }
      return json({ error: "Unknown action." }, 400);
    }
    case "key-reveal": {
      try { return json({ ok: true, key: await revealTraderKey() }); } catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "key-import": {
      try { const address = await importTraderKey(String(b.key || "")); return json({ ok: true, address, note: `Now trading from your wallet ${address.slice(0, 6)}…${address.slice(-4)}.` }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "withdraw": {
      const { data: openLive } = await tq("ai_trader_positions").select("id").eq("mode", "live").in("status", ["open", "closing"]).limit(1);
      if (openLive?.length) return json({ error: "Sell the open live coins first, then withdraw." }, 400);
      try { const r = await withdrawBnb(String(b.to || "")); return json({ ok: true, note: `Sent ${r.bnb.toFixed(5)} BNB. Transaction ${r.hash.slice(0, 10)}…` }); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
    }
    case "run":
      return json(await runTrader({ force: true }).catch((e) => ({ error: (e as Error).message })));
    case "close": {
      const { data: p } = await tq("ai_trader_positions").select("*").eq("id", String(b.id || "")).in("status", ["open", "closing"]).maybeSingle();
      if (!p) return json({ error: "That position isn't open." }, 404);
      await closePosition(p as Position, "Closed by admin");
      return json({ ok: true });
    }
    case "edit": {
      const up: Record<string, number> = {};
      for (const k of ["stop_loss", "take_profit", "trail"]) if (b[k] != null && isFinite(Number(b[k]))) up[k] = Math.min(NUM[k][1], Math.max(NUM[k][0], Number(b[k])));
      const { data, error } = await tq("ai_trader_positions").update(up).eq("id", String(b.id || "")).in("status", ["open", "closing"]).select("symbol");
      if (error || !data?.length) return json({ error: "That position isn't open." }, 400);
      await log("settings", `Admin set ${data[0].symbol}: stop-loss ${up.stop_loss ?? "same"}%, take profit ${up.take_profit ?? "same"}%, trailing ${up.trail ?? "same"}%`);
      return json({ ok: true });
    }
    case "reset": {
      // Practice mode only: clears practice positions and refills the practice balance.
      const start = Math.min(100, Math.max(0.01, Number(b.start) || 1));
      await tq("ai_trader_positions").delete().eq("mode", "paper");
      await sb.from("ai_trader_settings").update({ paper_cash: start, paper_start: start }).eq("id", T());
      await log("settings", `Practice account reset to ${start} BNB.`);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found." }, 404);
}
