import { createPublicClient, createWalletClient, formatUnits, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
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
 *                      every member who hasn't saved today. And the bot pays out every plan that has ended, straight
 *                      to its owner's wallet (SUSU_KEEPER_KEY: a small wallet with a little BNB for network fees).
 */

const keeperKey = () => {
  const k = (process.env.SUSU_KEEPER_KEY || process.env.ORDERS_KEEPER_KEY || "").trim();
  return /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as `0x${string}`) : /^[0-9a-fA-F]{64}$/.test(k) ? (`0x${k}` as `0x${string}`) : null;
};

/** Pays out every ended plan (any plan in the contract, not only members'), straight to each owner. */
async function autoRelease() {
  const key = keeperKey();
  if (!key) return { skipped: "no keeper key" };
  const c = client() as any;
  const count = Number(await c.readContract({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "planCount" }));
  const now = Date.now() / 1000;
  const ready: bigint[] = [];
  for (let i = 0; i < Math.min(count, 5000); i += 300) {
    const ids = Array.from({ length: Math.min(300, count - i) }, (_, k) => BigInt(i + k));
    const res = await c.multicall({ contracts: ids.map((id) => ({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "plan", args: [id] })), allowFailure: true });
    res.forEach((r: any, k: number) => {
      if (r.status !== "success") return;
      const [p, , , , unlocksAt] = r.result;
      if (!p.withdrawn && now >= Number(unlocksAt)) ready.push(ids[k]);
    });
  }
  if (!ready.length) return { released: 0 };
  const w = createWalletClient({ chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 20_000 }), account: privateKeyToAccount(key) });
  const sent: number[] = [];
  for (let i = 0; i < ready.length; i += 30) {
    const batch = ready.slice(i, i + 30);
    try {
      const hash = await w.writeContract({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "release", args: [batch], chain: bsc } as any);
      const rc = await c.waitForTransactionReceipt({ hash, timeout: 40_000 });
      if (rc.status === "success") sent.push(...batch.map(Number));
    } catch (e) { console.error("susu release", (e as Error).message.slice(0, 160)); break; }
  }
  return { released: sent.length, ids: sent };
}
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
  // 1. The bot pays out every plan that has ended.
  const auto = await autoRelease().catch((e) => ({ error: (e as Error).message.slice(0, 160) }));
  const paidOut = new Set<number>((auto as any).ids ?? []);
  const { data: plans } = await sb.from("susu_plans").select("*").eq("withdrawn", false).limit(2000);
  if (!plans?.length) return json({ plans: 0, auto });
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
    if (paidOut.has(Number(row.id))) {
      gone.push(row.id);
      notes.push({ user_id: row.user_id, title: "Your Susu is in your wallet 🎉", body: `Your ${p.totalDays}-day Susu ended and ${amt(saved)} ${sym} was sent to your wallet automatically. Well done!`, link: "/susu" });
      return;
    }
    if (p.withdrawn) { gone.push(row.id); return; }
    if (now >= Number(unlocksAt)) {
      if (!row.ready_notified) {
        ready.push(row.id);
        notes.push({ user_id: row.user_id, title: "Your Susu is ready", body: `Day ${p.totalDays} is done. Your ${amt(saved)} ${sym} is being sent to your wallet; you can also press Withdraw on the Susu page.`, link: "/susu" });
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
  return json({ plans: plans.length, reminded: remind.length, ready: ready.length, auto });
}
