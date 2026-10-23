import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { balances } from "@/lib/wallet-server";
import { WCHAINS } from "@/lib/wallet-chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in member's own snapshot for the App home: name, badge, who they follow, and what their wallet holds. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return json({ signedIn: false });
  const slow = await rateLimit(req, "me-summary", 40, 600, user.id);
  if (slow) return slow;
  const sb = supabaseService();
  const [{ data: prof }, { count: following }, { count: followers }, { data: w }] = await Promise.all([
    sb.from("profiles").select("alias,handle,color,is_team,team_title,is_verified").eq("id", user.id).maybeSingle(),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", user.id),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", user.id),
    sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle(),
  ]);
  const { data: fl } = await sb.from("follows").select("followee_id").eq("follower_id", user.id).order("created_at", { ascending: false }).limit(5);
  const ids = (fl || []).map((f: any) => f.followee_id as string);
  const { data: fp } = ids.length ? await sb.from("profiles").select("id,alias,handle,color,is_team,is_verified").in("id", ids) : { data: [] as any[] };
  const order = new Map(ids.map((id, i) => [id, i]));
  const recent = (fp || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  let funds: { symbol: string; amount: number; valueUsd: number | null }[] = [];
  let totalUsd: number | null = null;
  const address: string | null = w?.address ?? null;
  if (address) {
    try {
      const list = await Promise.race([balances(WCHAINS.bsc, address, []), new Promise<never>((_, no) => setTimeout(() => no(new Error("slow")), 7000))]);
      const held = list.filter((h) => h.amount > 0).sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
      funds = held.slice(0, 4).map((h) => ({ symbol: h.symbol, amount: h.amount, valueUsd: h.valueUsd }));
      totalUsd = held.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
    } catch { /* show the wallet without numbers */ }
  }
  return json({
    signedIn: true,
    profile: prof, following: following ?? 0, followers: followers ?? 0, recent,
    wallet: address ? { short: `${address.slice(0, 6)}…${address.slice(-4)}`, funds, totalUsd } : null,
  });
}
