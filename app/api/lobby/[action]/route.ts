/**
 * Lobby (BNB Chain sniper). See lib/lobby.ts.
 * GET /api/lobby/cron: every minute, watches every trader with a snipe waiting or held (52s each run).
 * GET /api/lobby/status: the signed-in admin's Lobby wallet and snipes.
 * POST wallet | key-reveal | snipe | cancel | target | sell | withdraw | watch (admins, their own only).
 */
import { adminState } from "@/lib/admin";
import { cronDenied } from "@/lib/cron-auth";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { activeTraders, addSnipe, cancelSnipe, createLobbyWallet, lobbyStatus, revealLobbyKey, runLobby, sellNow, setTarget, withdrawBnb } from "@/lib/lobby";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The signed-in admin's AI trader id (the Lobby wallet belongs to it). */
async function mine(): Promise<number | null> {
  const who = await adminState();
  if (!who.staff) return null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const { data } = await supabaseService().from("ai_trader_settings").select("id").eq("user_id", user.id).maybeSingle();
  return data?.id ? Number(data.id) : null;
}

export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (params.action === "cron") {
    const denied = cronDenied(req);
    if (denied) return denied;
    const ids = await activeTraders();
    const ran = await Promise.all(ids.map((id) => runLobby(id, 52_000).then((r) => ({ id, r }), (e) => ({ id, r: `error: ${(e as Error).message}` }))));
    return json({ ok: true, ran });
  }
  const id = await mine();
  if (!id) return json({ error: "Admins only." }, 403);
  if (params.action === "status") { try { return json(await lobbyStatus(id)); } catch (e) { return json({ error: (e as Error).message }, 400); } }
  return json({ error: "Unknown." }, 404);
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const id = await mine();
  if (!id) return json({ error: "Open the AI Trader page once first (Admin → AI trader), then come back." }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    switch (params.action) {
      case "wallet": { const address = await createLobbyWallet(id); return json({ ok: true, address, note: "Lobby wallet ready. Add BNB to it below." }); }
      case "key-reveal": return json({ ok: true, key: await revealLobbyKey(id) });
      case "snipe": return json({ ok: true, note: await addSnipe(id, b) });
      case "cancel": await cancelSnipe(id, Number(b.id)); return json({ ok: true, note: "Cancelled." });
      case "target": await setTarget(id, Number(b.id), Number(b.take_x), b.stop_pct ? Number(b.stop_pct) : null); return json({ ok: true, note: "Saved." });
      case "sell": return json({ ok: true, note: await sellNow(id, Number(b.id)) });
      case "withdraw": return json({ ok: true, note: await withdrawBnb(id, String(b.to || ""), b.amount === "max" ? "max" : Number(b.amount)) });
      // The page calls this while it's open, so watching starts at once instead of at the next minute.
      case "watch": return json({ ok: true, r: await runLobby(id, 50_000) });
      default: return json({ error: "Unknown." }, 404);
    }
  } catch (e) { return json({ error: (e as Error).message }, 400); }
}
