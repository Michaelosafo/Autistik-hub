import { createPublicClient, formatUnits, getAddress, http, isAddress } from "viem";
import { bsc } from "viem/chains";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { notify, type Note } from "@/lib/push";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { CHAINS } from "@/lib/launchpad";
import { SUSU_ABI, SUSU_ADDRESS, susuToken } from "@/lib/susu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const client = () => createPublicClient({ chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 15_000 }) });
const readPlan = (id: number) => client().readContract({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "plan", args: [BigInt(id)] }) as Promise<any>;

/**
 * Susu reminders.
 *  POST {ids, wallet}  a signed-in member's plans (read from the chain), so the Hub can remind them to save each day.
 *  GET                 hourly from the database's scheduler (supabase/susu.sql): once a day, a 🔔 + push reminder to
 *                      every member who hasn't saved today, and one when a plan is ready to withdraw.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "susu-track", 30, 600);
  if (slow) return slow;
  const me = await currentUser();
  if (!me) return json({ ok: false, reason: "signed out" });
  const b = await req.json().catch(() => null);
  const wallet = String(b?.wallet || "");
  const ids = (Array.isArray(b?.ids) ? b.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 0).slice(0, 50);
  if (!isAddress(wallet) || !ids.length) return json({ error: "Nothing to track." }, 400);
  const rows: any[] = [];
  for (const id of ids) {
    const r = await readPlan(id).catch(() => null);
    if (!r) continue;
    const p = r[0];
    if (getAddress(p.owner) !== getAddress(wallet)) continue;
    rows.push({ id, user_id: me.id, owner: getAddress(p.owner), token: getAddress(p.token), daily: p.daily.toString(), total_days: Number(p.totalDays), start_at: new Date(Number(p.start) * 1000).toISOString(), withdrawn: p.withdrawn });
  }
  if (rows.length) {
    const { error } = await supabaseService().from("susu_plans").upsert(rows, { onConflict: "id" });
    if (error) return json({ error: "Couldn't save your reminders." }, 500);
  }
  return json({ ok: true, tracked: rows.length });
}

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ skipped: "not set up" });
  const sb = supabaseService();
  const { data: go } = await sb.rpc("susu_lease", { p_seconds: 3000 });
  if (go !== true) return json({ skipped: true });
  const today = new Date().toISOString().slice(0, 10);
  const { data: plans } = await sb.from("susu_plans").select("*").eq("withdrawn", false).limit(2000);
  if (!plans?.length) return json({ plans: 0 });
  const res = await client().multicall({
    contracts: plans.map((p) => ({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "plan", args: [BigInt(p.id)] })) as any,
    allowFailure: true,
  });
  const notes: Note[] = [], remind: number[] = [], ready: number[] = [], gone: number[] = [];
  const now = Date.now() / 1000;
  plans.forEach((row, i) => {
    const r = res[i];
    if (r.status !== "success") return;
    const [p, day, dueDays, saved, unlocksAt] = r.result as any;
    const t = susuToken(p.token);
    const sym = t?.symbol ?? "USDT";
    const amt = (v: bigint) => Number(formatUnits(v, t?.decimals ?? 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (p.withdrawn) { gone.push(row.id); return; }
    if (now >= Number(unlocksAt)) {
      if (!row.ready_notified) {
        ready.push(row.id);
        notes.push({ user_id: row.user_id, title: "Your Susu is ready", body: `Day ${p.totalDays} is done. Withdraw your ${amt(saved)} ${sym} on the Susu page.`, link: "/susu" });
      }
      return;
    }
    if (Number(dueDays) > 0 && row.reminded_on !== today) {
      remind.push(row.id);
      const missed = Number(dueDays) - 1;
      notes.push({
        user_id: row.user_id, title: "Susu: time to save today",
        body: `Day ${day} of ${p.totalDays}: put in ${amt(p.daily)} ${sym}.${missed > 0 ? ` You also missed ${missed} day${missed > 1 ? "s" : ""}; you can catch up now.` : ""} Saved so far: ${amt(saved)} ${sym}.`,
        link: "/susu",
      });
    }
  });
  await notify(notes);
  if (remind.length) await sb.from("susu_plans").update({ reminded_on: today }).in("id", remind);
  if (ready.length) await sb.from("susu_plans").update({ ready_notified: true }).in("id", ready);
  if (gone.length) await sb.from("susu_plans").update({ withdrawn: true }).in("id", gone);
  return json({ plans: plans.length, reminded: remind.length, ready: ready.length });
}
