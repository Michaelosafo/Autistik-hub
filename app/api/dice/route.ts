import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AUTISTIK Dice (play chips, no real money). One shared round every 30 seconds: put chips in, everyone rolls two dice
 * when it closes, the highest total takes the pot. All chips and rolls are handled by database functions
 * (supabase/2026-11-21-dice.sql); this route only calls them.
 */
const ROUND_MS = 30_000;
const roundNow = () => Math.floor(Date.now() / ROUND_MS);

async function settleDue(sb: ReturnType<typeof supabaseService>) {
  const { data } = await sb.from("dice_rounds").select("id").is("settled_at", null).lt("id", roundNow()).order("id").limit(5);
  for (const r of data || []) await sb.rpc("dice_settle", { p_round: r.id });
}

async function aliasOf(sb: ReturnType<typeof supabaseService>, id: string) {
  const { data } = await sb.from("profiles").select("alias").eq("id", id).maybeSingle();
  return String(data?.alias || "Player").slice(0, 24);
}

export async function GET() {
  const sb = supabaseService();
  const user = await currentUser();
  await settleDue(sb);
  const id = roundNow();
  const [{ data: cur }, { data: bets }, { data: last }, { data: top }] = await Promise.all([
    sb.from("dice_rounds").select("id,pot").eq("id", id).maybeSingle(),
    sb.from("dice_bets").select("alias,stake,user_id").eq("round_id", id).order("created_at"),
    sb.from("dice_rounds").select("id,pot,winners,settled_at").not("winners", "is", null).order("id", { ascending: false }).limit(6),
    sb.from("dice_wallets").select("alias,chips,won,played").gt("played", 0).order("chips", { ascending: false }).limit(10),
  ]);
  const lastIds = (last || []).map((r: any) => r.id);
  const { data: lastBets } = lastIds.length
    ? await sb.from("dice_bets").select("round_id,alias,stake,d1,d2,payout,user_id").in("round_id", lastIds)
    : { data: [] as any[] };
  let me: any = null;
  if (user) {
    const { data: w } = await sb.from("dice_wallets").select("chips,won,played,refilled_at").eq("user_id", user.id).maybeSingle();
    const chips = w ? Number(w.chips) : 1000;
    me = {
      chips, won: Number(w?.won || 0), played: w?.played || 0,
      canRefill: !!w && chips < 100 && Date.now() - Date.parse(w.refilled_at) > 86_400_000,
      inRound: (bets || []).some((b: any) => b.user_id === user.id),
    };
  }
  return json({
    now: Date.now(), round: { id, endsAt: (id + 1) * ROUND_MS, pot: Number(cur?.pot || 0),
      players: (bets || []).map((b: any) => ({ alias: b.alias, stake: Number(b.stake), me: !!user && b.user_id === user.id })) },
    results: (last || []).map((r: any) => ({
      id: r.id, pot: Number(r.pot), winners: r.winners || [],
      bets: (lastBets || []).filter((b: any) => b.round_id === r.id).sort((a: any, b: any) => (b.d1 + b.d2) - (a.d1 + a.d2))
        .map((b: any) => ({ alias: b.alias, stake: Number(b.stake), d1: b.d1, d2: b.d2, payout: Number(b.payout), me: !!user && b.user_id === user.id })),
    })),
    leaders: (top || []).map((x: any) => ({ alias: x.alias, chips: Number(x.chips), won: Number(x.won), played: x.played })),
    me,
  });
}

export async function POST(req: Request) {
  const slow = await rateLimit(req, "dice", 40, 60);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Sign in to play." }, 401);
  const sb = supabaseService();
  const b = await req.json().catch(() => ({}));
  if (b?.action === "refill") {
    const { data, error } = await sb.rpc("dice_refill", { p_user: user.id });
    if (error) return json({ error: error.message }, 400);
    return json({ chips: Number(data) });
  }
  const stake = Math.floor(Number(b?.stake));
  if (!(stake >= 1 && stake <= 100_000)) return json({ error: "Put in 1 to 100,000 chips." }, 400);
  const id = roundNow();
  if ((id + 1) * ROUND_MS - Date.now() < 2500) return json({ error: "This round is closing. Join the next one in a moment." }, 400);
  const { data, error } = await sb.rpc("dice_bet", { p_user: user.id, p_alias: await aliasOf(sb, user.id), p_round: id, p_stake: stake });
  if (error) return json({ error: error.message }, 400);
  return json({ chips: Number(data), round: id });
}
