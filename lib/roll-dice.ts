/**
 * Roll the Dice (server only): a real-money AUTISTIK dice game on BNB Chain.
 *
 * - To join you must hold at least $10 of AUTISTIK, and you pay $0.50 of AUTISTIK into the pot wallet from your own
 *   wallet. The page sends that transfer; the server checks it on chain (right token, right pot, right amount, not
 *   used before, recent) before you're in.
 * - A round closes ROUND_SECONDS after its second player joins. Everyone rolls two dice (crypto-random, on the
 *   server); ties roll again until one player is left. The winner gets the whole pot, sent from the pot wallet.
 * - Alone for REFUND_AFTER_MIN minutes: your entry is sent back.
 *
 * The pot wallet's key is ROLL_POT_KEY in Vercel (a dedicated wallet holding a little BNB for gas). Without it the
 * game shows as closed.
 */
import { randomInt } from "crypto";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, fallback, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { TOKEN_ADDRESS } from "@/lib/groups";
import { getMarkets } from "@/lib/market";
import { supabaseService } from "@/lib/supabase/server";

export const ENTRY_USD = 0.5;
export const HOLD_USD = 10;
export const ROUND_SECONDS = 60;
export const REFUND_AFTER_MIN = 30;
export const MAX_PLAYERS = 50;

const TOKEN = getAddress(TOKEN_ADDRESS);
const RPCS = [process.env.COPY_BSC_RPC, process.env.NEXT_PUBLIC_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-dataseed.bnbchain.org"].filter(Boolean) as string[];
const transport = () => fallback(RPCS.map((u) => http(u, { timeout: 10_000, retryCount: 0 })), { retryCount: 1 });
const pub = () => createPublicClient({ chain: bsc, transport: transport() }) as any;
const sb = () => supabaseService();

function potAccount() {
  const k = (process.env.ROLL_POT_KEY || "").trim();
  if (!k) return null;
  const key = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? privateKeyToAccount(key) : null;
}
export const potAddress = () => potAccount()?.address ?? null;

let decCache: number | null = null;
async function decimals(): Promise<number> {
  if (decCache != null) return decCache;
  decCache = Number(await pub().readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" }).catch(() => 18));
  return decCache;
}

/** AUTISTIK's $ price, and the entry and holding amounts in raw token units. */
export async function pricing() {
  const m = await getMarkets([{ chain: "bsc" as any, token: TOKEN }]).catch(() => ({} as Record<string, any>));
  const price = Number(m[TOKEN.toLowerCase()]?.priceUsd) || 0;
  if (!(price > 0)) throw new Error("Couldn't get the AUTISTIK price right now. Try again in a minute.");
  const dec = await decimals();
  const raw = (usd: number) => BigInt(Math.ceil((usd / price) * 1e6)) * 10n ** BigInt(dec) / 1_000_000n;
  return { price, decimals: dec, entryRaw: raw(ENTRY_USD), holdRaw: raw(HOLD_USD) };
}

export async function balanceOf(addr: string): Promise<bigint> {
  return BigInt(await pub().readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [getAddress(addr)] }));
}

async function openRound() {
  const { data } = await sb().from("roll_rounds").select("*").eq("status", "open").maybeSingle();
  if (data) return data;
  const { data: made, error } = await sb().from("roll_rounds").insert({ status: "open" }).select("*").single();
  if (error) { const { data: again } = await sb().from("roll_rounds").select("*").eq("status", "open").maybeSingle(); return again; }
  return made;
}

/** Everything the page shows. Also settles or refunds a round that's due. */
export async function rollState(userId: string | null) {
  await tick().catch(() => {});
  const round = await openRound();
  const [{ data: entries }, { data: past }] = await Promise.all([
    sb().from("roll_entries").select("user_id,alias,address,created_at").eq("round_id", round.id).order("created_at"),
    sb().from("roll_rounds").select("id,pot_raw,winner_alias,winner_addr,payout_tx,settled_at,status,note").in("status", ["settled", "refunded"]).order("id", { ascending: false }).limit(8),
  ]);
  const ids = (past || []).map((r: any) => r.id);
  const { data: pastEntries } = ids.length ? await sb().from("roll_entries").select("round_id,alias,d1,d2,user_id").in("round_id", ids) : { data: [] as any[] };
  let p: Awaited<ReturnType<typeof pricing>> | null = null;
  try { p = await pricing(); } catch { /* shown as unavailable */ }
  return {
    open: !!potAccount(), pot: potAddress(), token: TOKEN, decimals: p?.decimals ?? 18,
    price: p?.price ?? null, entryRaw: p?.entryRaw.toString() ?? null, holdRaw: p?.holdRaw.toString() ?? null,
    entryUsd: ENTRY_USD, holdUsd: HOLD_USD, roundSeconds: ROUND_SECONDS, refundAfterMin: REFUND_AFTER_MIN,
    round: {
      id: round.id, closesAt: round.closes_at, now: new Date().toISOString(),
      players: (entries || []).map((e: any) => ({ alias: e.alias, address: e.address, me: !!userId && e.user_id === userId })),
      potRaw: String(round.pot_raw || 0),
    },
    results: (past || []).map((r: any) => ({
      id: r.id, status: r.status, potRaw: String(r.pot_raw || 0), winner: r.winner_alias, winnerAddr: r.winner_addr, tx: r.payout_tx, at: r.settled_at, note: r.note,
      rolls: (pastEntries || []).filter((e: any) => e.round_id === r.id).map((e: any) => ({ alias: e.alias, d1: e.d1, d2: e.d2, me: !!userId && e.user_id === userId }))
        .sort((a: any, b: any) => (b.d1 + b.d2) - (a.d1 + a.d2)),
    })),
  };
}

/** Holds at least $10 of AUTISTIK? (Checked before paying, and again on join.) */
export async function checkHolder(addr: string) {
  const p = await pricing();
  const have = await balanceOf(addr);
  return { ok: have >= p.holdRaw + p.entryRaw, haveRaw: have.toString(), needRaw: (p.holdRaw + p.entryRaw).toString(), price: p.price, decimals: p.decimals };
}

/** Verify the entry transfer on chain and put the player in the open round. */
export async function join(userId: string, alias: string, txHash: string) {
  const pot = potAddress();
  if (!pot) throw new Error("Roll the Dice is closed right now.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("That isn't a transaction hash.");
  const { data: used } = await sb().from("roll_entries").select("round_id").eq("tx_hash", txHash.toLowerCase()).maybeSingle();
  if (used) throw new Error("That payment was already used to join.");
  const c = pub();
  let rc: any = null;
  for (let i = 0; i < 20 && !rc; i++) {
    rc = await c.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);
    if (!rc) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!rc) throw new Error("That payment hasn't landed yet. Wait a few seconds and tap Join again.");
  if (rc.status !== "success") throw new Error("That payment failed on chain.");
  const block = await c.getBlock({ blockNumber: rc.blockNumber });
  if (Date.now() / 1000 - Number(block.timestamp) > 20 * 60) throw new Error("That payment is too old to join with.");
  let from = "", paid = 0n;
  for (const l of rc.logs || []) {
    if (getAddress(l.address) !== TOKEN || l.topics?.[0] !== "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") continue;
    const to = getAddress("0x" + String(l.topics[2]).slice(26));
    if (to !== getAddress(pot)) continue;
    from = getAddress("0x" + String(l.topics[1]).slice(26));
    paid += BigInt(l.data);
  }
  if (!from || paid <= 0n) throw new Error("That transaction didn't send AUTISTIK to the pot.");
  const p = await pricing();
  if (paid * 100n < p.entryRaw * 95n) throw new Error("That payment was less than $0.50 of AUTISTIK.");
  const round = await openRound();
  const { count } = await sb().from("roll_entries").select("user_id", { count: "exact", head: true }).eq("round_id", round.id);
  // Not a holder any more, round full, or already in: the payment is sent straight back.
  const have = await balanceOf(from).catch(() => 0n);
  const refuse = have < p.holdRaw ? `You need to hold at least $${HOLD_USD} of AUTISTIK to play.` : (count || 0) >= MAX_PLAYERS ? "This round is full." : "";
  const { data: mine } = await sb().from("roll_entries").select("tx_hash").eq("round_id", round.id).eq("user_id", userId).maybeSingle();
  if (refuse || mine) {
    const hash = await payOut(from, paid).catch(() => null);
    throw new Error(`${refuse || "You're already in this round."} Your payment ${hash ? "was sent back" : "will be sent back"}.`);
  }
  const { error } = await sb().from("roll_entries").insert({ round_id: round.id, user_id: userId, alias: alias.slice(0, 24) || "Player", address: from, tx_hash: txHash.toLowerCase(), amount_raw: paid.toString() });
  if (error) throw new Error(error.message);
  const { data: all } = await sb().from("roll_entries").select("amount_raw").eq("round_id", round.id);
  const potRaw = (all || []).reduce((a: bigint, e: any) => a + BigInt(e.amount_raw), 0n);
  const up: Record<string, unknown> = { pot_raw: potRaw.toString() };
  if ((all || []).length >= 2 && !round.closes_at) up.closes_at = new Date(Date.now() + ROUND_SECONDS * 1000).toISOString();
  await sb().from("roll_rounds").update(up).eq("id", round.id);
  return { round: round.id, players: (all || []).length };
}

async function payOut(to: string, amount: bigint): Promise<string> {
  const acc = potAccount();
  if (!acc) throw new Error("No pot wallet.");
  const w = createWalletClient({ account: acc, chain: bsc, transport: transport() }) as any;
  const hash = await w.sendTransaction({ account: acc, chain: bsc, to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(to), amount] }) });
  // Sent: wait a little for it (BNB Chain confirms in seconds), but never longer than the request can run.
  const rc = await pub().waitForTransactionReceipt({ hash, timeout: 30_000 }).catch(() => null);
  if (rc && rc.status !== "success") throw new Error("The payout failed on chain.");
  return hash;
}

const roll = () => 1 + randomInt(6);

/** Settle a closed round, or refund a lone player who waited too long. Safe to call often: each round runs once. */
export async function tick() {
  const { data: r } = await sb().from("roll_rounds").select("*").eq("status", "open").maybeSingle();
  if (!r) return;
  const { data: entries } = await sb().from("roll_entries").select("*").eq("round_id", r.id);
  const n = (entries || []).length;
  const closed = r.closes_at && Date.parse(r.closes_at) <= Date.now();
  const lonely = n === 1 && Date.now() - Date.parse(entries![0].created_at) > REFUND_AFTER_MIN * 60_000;
  if (!(n >= 2 && closed) && !lonely) return;
  // Claim the round so only one request settles it.
  const { data: claimed } = await sb().from("roll_rounds").update({ status: lonely ? "refunding" : "settling" }).eq("id", r.id).eq("status", "open").select("id");
  if (!claimed?.length) return;
  if (lonely) {
    const e = entries![0];
    const hash = await payOut(e.address, BigInt(e.amount_raw)).catch(() => null);
    await sb().from("roll_entries").update({ refund_tx: hash }).eq("round_id", r.id).eq("user_id", e.user_id);
    await sb().from("roll_rounds").update({ status: "refunded", settled_at: new Date().toISOString(), payout_tx: hash, note: hash ? "No one else joined: entry sent back." : "Refund pending: the pot wallet needs BNB for gas." }).eq("id", r.id);
    return;
  }
  // Everyone rolls two dice; ties roll again among the tied players until one is left.
  let left = [...entries!];
  for (const e of left) { e.d1 = roll(); e.d2 = roll(); }
  for (const e of entries!) await sb().from("roll_entries").update({ d1: e.d1, d2: e.d2 }).eq("round_id", r.id).eq("user_id", e.user_id);
  const first = Math.max(...left.map((e) => e.d1 + e.d2));
  const tied = left.filter((e) => e.d1 + e.d2 === first).length > 1;
  for (let i = 0; i < 50; i++) {
    const best = Math.max(...left.map((e) => e.d1 + e.d2));
    left = left.filter((e) => e.d1 + e.d2 === best);
    if (left.length === 1) break;
    for (const e of left) { e.d1 = roll(); e.d2 = roll(); }
  }
  const win = left[0];
  const pot = entries!.reduce((a, e) => a + BigInt(e.amount_raw), 0n);
  const tieNote = tied ? " (won the tie roll-off)" : "";
  let hash: string | null = null, note = `${win.alias} won the pot${tieNote}.`;
  try { hash = await payOut(win.address, pot); }
  catch (e) { note = `${win.alias} won; payout pending: ${(e as Error).message.slice(0, 120)}`; }
  await sb().from("roll_rounds").update({ status: "settled", pot_raw: pot.toString(), winner_user: win.user_id, winner_alias: win.alias, winner_addr: win.address, payout_tx: hash, settled_at: new Date().toISOString(), note }).eq("id", r.id);
}
