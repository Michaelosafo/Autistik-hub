/**
 * Hyperfocus GP paid races, server side. Entry is $0.50 of $AUTISTIK (BNB Chain), sent from the player's own wallet to
 * the game wallet with a one-time code on the end, so nobody can claim someone else's payment. Rooms hold 10 and start
 * when full. Every player's buttons are replayed here through the same race rules the game uses (lib/hyperfocus-sim),
 * so places can't be faked. The pot is split automatically: 30% to the marketing wallet, 70% to the top 5.
 * The game wallet's key (HYPERFOCUS_GAME_KEY) lives only in the server's environment. Server only.
 */
import { createHash, randomBytes } from "crypto";
import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, getAddress, http, isAddress, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { CHAINS } from "@/lib/launchpad";
import { PRO_TOKEN } from "@/lib/pro";
import { autistikPriceUsd, unitsFor } from "@/lib/pro-server";
import { TREASURY } from "@/lib/trending";
import { supabaseService } from "@/lib/supabase/server";
// The same file the game runs (public/hyperfocus/sim.js is built from it).
import HFSim from "@/lib/hyperfocus-sim";

export const ENTRY_USD = Number(process.env.HYPERFOCUS_ENTRY_USD || 0.5);
export const ROOM_SIZE = 10;
const MARKETING_PCT = 30n;
/** How the winners' 70% is shared, 1st to 5th (percent of the 70%). */
export const SPLIT = [35n, 25n, 18n, 12n, 10n];
/** The price moves while a payment confirms and $AUTISTIK has a small transfer tax: accept 88% or more. */
const SLACK = 88n;
/** Results can be sent until a minute after the 5 minutes end. */
const GRACE_MS = 60_000;
const CARS = new Set(["street", "muscle", "super", "rally"]);

export function gameAccount() {
  const k = (process.env.HYPERFOCUS_GAME_KEY || "").trim();
  const hex = k.startsWith("0x") ? k : `0x${k}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return privateKeyToAccount(hex as `0x${string}`);
}
export function marketingWallet() {
  const a = process.env.HYPERFOCUS_MARKETING_WALLET || TREASURY;
  return a && isAddress(a) ? getAddress(a) : null;
}
const pub = () => createPublicClient({ chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 15_000 }) }) as any;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

let decCache: number | null = null;
export async function tokenDecimals() {
  if (decCache != null) return decCache;
  try { decCache = Number(await pub().readContract({ address: PRO_TOKEN, abi: erc20Abi, functionName: "decimals" })); } catch { return 18; }
  return decCache;
}

export type Entry = {
  id: string; room_id: string | null; wallet: string; name: string; car: string; color: string | null; nonce: string; secret_hash: string;
  amount: string; received: string | null; tx_hash: string | null; status: string; created_at: string; inputs: string | null;
  pos: number | null; finished: boolean | null; ft: number | null; place: number | null; payout: string | null; payout_tx: string | null; refund_tx: string | null;
};
export type Room = { id: string; status: string; seed: number; start_at: string | null; created_at: string; settled_at: string | null; pot: string | null; marketing_tx: string | null; error: string | null };

/** A price quote and a one-time code for a new entry. */
export async function quote(walletIn: string, nameIn: string, carIn: string, colorIn: string) {
  const game = gameAccount();
  if (!game) return { error: "Paid races open soon." as const };
  if (!isAddress(walletIn)) return { error: "Connect a BNB Chain wallet (0x…) to enter." as const };
  const name = String(nameIn || "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 16);
  if (!name) return { error: "Add your name to join." as const };
  // One seat per wallet: a wallet already in a waiting or running race can't enter again until it ends.
  const { data: active } = await supabaseService().from("hf_entries").select("id,room_id,hf_rooms!inner(status)").ilike("wallet", walletIn).eq("status", "paid").in("hf_rooms.status", ["waiting", "racing", "settling"]).limit(1);
  if (active?.length) return { error: "This wallet is already in a race. Finish or leave it first." as const };
  const [price, dec] = await Promise.all([autistikPriceUsd(), tokenDecimals()]);
  if (!price) return { error: "Couldn't get the $AUTISTIK price right now. Try again in a minute." as const };
  const amount = unitsFor(ENTRY_USD, price, dec);
  const nonce = randomBytes(16).toString("hex"), secret = randomBytes(16).toString("hex");
  const color = /^#[0-9a-fA-F]{6}$/.test(colorIn) ? colorIn : null;
  const { data, error } = await supabaseService().from("hf_entries").insert({
    wallet: getAddress(walletIn), name, car: CARS.has(carIn) ? carIn : "street", color, nonce, secret_hash: sha(secret), amount: amount.toString(),
  }).select("id").single();
  if (error || !data) return { error: "Couldn't start your entry. Try again." as const };
  return { entryId: data.id as string, secret, nonce, amount: amount.toString(), decimals: dec, priceUsd: price, usd: ENTRY_USD, token: PRO_TOKEN, gameWallet: game.address };
}

async function entryFor(id: string, secret: string): Promise<Entry | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/.test(secret)) return null;
  const { data } = await supabaseService().from("hf_entries").select("*").eq("id", id).maybeSingle();
  return data && data.secret_hash === sha(secret) ? (data as Entry) : null;
}

/** Checks the entry payment on-chain, then seats the player in a room. */
export async function join(id: string, secret: string, txHashIn: string) {
  const game = gameAccount();
  if (!game) return { error: "Paid races open soon." };
  const e = await entryFor(id, secret);
  if (!e) return { error: "That entry wasn't found. Start again." };
  const sb = supabaseService();
  if (e.status === "paid" && e.room_id) return { roomId: e.room_id };
  if (e.status !== "quoted") return { error: "That entry is closed." };
  const txHash = String(txHashIn || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return { error: "That isn't a transaction hash." };
  const p = pub();
  let tx: any, receipt: any, block: any;
  try {
    receipt = await p.waitForTransactionReceipt({ hash: txHash, timeout: 40_000 });
    [tx, block] = await Promise.all([p.getTransaction({ hash: txHash }), p.getBlock({ blockNumber: receipt.blockNumber })]);
  } catch { return { error: "Couldn't find that payment on BNB Chain yet. Try again in a minute.", retry: true }; }
  if (receipt.status !== "success") return { error: "That payment failed on-chain." };
  if (!tx.to || getAddress(tx.to) !== getAddress(PRO_TOKEN)) return { error: "That isn't an $AUTISTIK payment." };
  if (getAddress(tx.from) !== getAddress(e.wallet)) return { error: "That payment came from a different wallet." };
  if (Number(block.timestamp) * 1000 < Date.parse(e.created_at) - 120_000) return { error: "That payment is older than this entry." };
  const input = String(tx.input || "0x").toLowerCase();
  if (input.length !== 2 + 8 + 128 + 32 || !input.endsWith(e.nonce)) return { error: "That payment wasn't made from this entry. Use the Pay button." };
  let call: any;
  try { call = decodeFunctionData({ abi: erc20Abi, data: input.slice(0, 2 + 8 + 128) as `0x${string}` }); } catch { call = null; }
  if (!call || call.functionName !== "transfer" || getAddress(call.args[0] as string) !== getAddress(game.address)) return { error: "That payment didn't go to the game wallet." };
  const received = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((l: any) => getAddress(l.address) === getAddress(PRO_TOKEN) && getAddress(l.args.to) === getAddress(game.address))
    .reduce((a: bigint, l: any) => a + (l.args.value as bigint), 0n);
  if (received * 100n < BigInt(e.amount) * SLACK) return { error: `That payment is less than $${ENTRY_USD} of $AUTISTIK.` };
  const { error } = await sb.from("hf_entries").update({ status: "paid", tx_hash: txHash, received: received.toString(), paid_at: new Date().toISOString() })
    .eq("id", e.id).eq("status", "quoted");
  if (error) return { error: error.code === "23505" ? "That payment was already used." : "Couldn't save your entry. Try again." };
  const { data: seat, error: jerr } = await sb.rpc("hf_join", { p_entry: e.id });
  if (jerr || !seat?.[0]) return { error: "Paid, but couldn't seat you yet. Try again." };
  return { roomId: seat[0].room_id as string };
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A room as the players see it. Also settles it once the race is over. */
export async function roomView(roomId: string, me?: { id: string; secret: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
  const sb = supabaseService();
  let { data: room } = await sb.from("hf_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return null;
  if (room.status === "racing" || room.status === "settling") {
    const changed = await maybeSettle(room as Room);
    if (changed) ({ data: room } = await sb.from("hf_rooms").select("*").eq("id", roomId).maybeSingle());
  }
  const { data: list } = await sb.from("hf_entries").select("*").eq("room_id", roomId).in("status", ["paid"]).order("paid_at", { ascending: true });
  const mine = me ? await entryFor(me.id, me.secret) : null;
  const started = !!room!.start_at && Date.parse(room!.start_at) <= Date.now() + 25_000;
  return {
    now: Date.now(), size: ROOM_SIZE, entryUsd: ENTRY_USD, decimals: await tokenDecimals(), priceUsd: await autistikPriceUsd().catch(() => null),
    room: { id: room!.id, status: room!.status, startAt: room!.start_at ? Date.parse(room!.start_at) : null, seed: started ? room!.seed : null, raceSecs: HFSim.RACE_SECS,
      pot: room!.pot, marketingTx: room!.marketing_tx },
    players: (list || []).map((x: any) => ({ id: x.id, name: x.name, wallet: short(x.wallet), walletFull: room!.status === "paid" ? x.wallet : null, car: x.car, color: x.color,
      place: x.place, payout: x.payout, payoutTx: x.payout_tx, submitted: !!x.inputs, finished: x.finished, pos: x.pos, me: !!mine && mine.id === x.id })),
  };
}

/** Saves a player's recorded buttons and their replayed result. */
export async function finish(id: string, secret: string, inputs: string) {
  const e = await entryFor(id, secret);
  if (!e || e.status !== "paid" || !e.room_id) return { error: "That entry isn't in a race." };
  if (e.inputs) return { ok: true, pos: e.pos, finished: e.finished };
  const sb = supabaseService();
  const { data: room } = await sb.from("hf_rooms").select("*").eq("id", e.room_id).maybeSingle();
  if (!room || room.status !== "racing" || !room.start_at) return { error: "That race isn't running." };
  const t0 = Date.parse(room.start_at);
  if (Date.now() < t0) return { error: "The race hasn't started." };
  if (Date.now() > t0 + HFSim.RACE_SECS * 1000 + GRACE_MS) return { error: "Too late: this race is closed." };
  const r = HFSim.replay(HFSim.track(room.seed), e.car, inputs);
  if (!r) return { error: "Those race inputs don't look right." };
  await sb.from("hf_entries").update({ inputs, pos: r.pos, finished: r.finished, ft: r.ft || null, submitted_at: new Date().toISOString() }).eq("id", e.id).is("inputs", null);
  await roomView(e.room_id);
  return { ok: true, pos: r.pos, finished: r.finished, ft: r.ft };
}

/** Leaving before the race starts refunds the entry. */
export async function leave(id: string, secret: string) {
  const e = await entryFor(id, secret);
  if (!e) return { error: "That entry wasn't found." };
  if (e.status === "quoted") { await supabaseService().from("hf_entries").update({ status: "left" }).eq("id", e.id).eq("status", "quoted"); return { ok: true, refunded: false }; }
  const sb = supabaseService();
  const { data: ok } = await sb.rpc("hf_leave", { p_entry: e.id });
  if (!ok) return { error: "The race has already started, so this entry can't be refunded." };
  const amount = BigInt(e.received || "0");
  if (amount <= 0n) return { ok: true, refunded: false };
  try {
    const hash = await send(e.wallet, amount);
    await sb.from("hf_entries").update({ status: "refunded", refund_tx: hash }).eq("id", e.id);
    return { ok: true, refunded: true, tx: hash };
  } catch (err: any) {
    console.error("hyperfocus refund failed", e.id, err?.message);
    return { ok: true, refunded: false, error: "You left the room. The refund didn't go through yet; the team will send it." };
  }
}

async function send(to: string, amount: bigint) {
  const account = gameAccount();
  if (!account) throw new Error("no game wallet");
  const w = createWalletClient({ account, chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 15_000 }) }) as any;
  return (await w.writeContract({ address: PRO_TOKEN, abi: erc20Abi, functionName: "transfer", args: [getAddress(to), amount] })) as string;
}

/** Ranks the room and pays out, once everyone has sent their result or the time is up. Safe to call many times. */
async function maybeSettle(room: Room): Promise<boolean> {
  const sb = supabaseService();
  if (!room.start_at) return false;
  const end = Date.parse(room.start_at) + HFSim.RACE_SECS * 1000;
  if (room.status === "racing") {
    if (Date.now() < end) return false;
    const { data: list } = await sb.from("hf_entries").select("id,inputs").eq("room_id", room.id).eq("status", "paid");
    const all = (list || []).every((x: any) => !!x.inputs);
    if (!all && Date.now() < end + GRACE_MS) return false;
    // Only one caller wins the switch to "settling".
    const { data: claimed } = await sb.from("hf_rooms").update({ status: "settling", settled_at: new Date().toISOString() }).eq("id", room.id).eq("status", "racing").select("id");
    if (!claimed?.length) return false;
    await rank(room.id);
    await payOut(room.id);
    return true;
  }
  // A payout that stopped halfway (server restart, RPC error) is picked up again after two minutes.
  if (room.status === "settling" && room.settled_at && Date.now() - Date.parse(room.settled_at) > 120_000) {
    const { data: claimed } = await sb.from("hf_rooms").update({ settled_at: new Date().toISOString() }).eq("id", room.id).eq("status", "settling").eq("settled_at", room.settled_at).select("id");
    if (!claimed?.length) return false;
    await payOut(room.id);
    return true;
  }
  return false;
}

/** Places and prize amounts, saved before any money moves. */
async function rank(roomId: string) {
  const sb = supabaseService();
  const { data: list } = await sb.from("hf_entries").select("*").eq("room_id", roomId).eq("status", "paid");
  const rows = (list || []) as Entry[];
  const done = rows.filter((x) => x.inputs && (x.pos || 0) > 0).map((x) => ({ x, r: { pos: x.pos || 0, finished: !!x.finished, ft: x.ft || 0 } }));
  done.sort((a, b) => HFSim.better(a.r, b.r));
  const rest = rows.filter((x) => !done.some((d) => d.x.id === x.id));
  const pot = rows.reduce((a, x) => a + BigInt(x.received || "0"), 0n);
  const winners = pot - (pot * MARKETING_PCT) / 100n;
  let paid = 0n;
  const updates = done.map((d, i) => {
    const share = i < SPLIT.length ? (winners * SPLIT[i]) / 100n : 0n;
    paid += share;
    return { id: d.x.id, place: i + 1, payout: share.toString() };
  });
  rest.forEach((x, i) => updates.push({ id: x.id, place: done.length + i + 1, payout: "0" }));
  for (const u of updates) await sb.from("hf_entries").update({ place: u.place, payout: u.payout }).eq("id", u.id);
  // Marketing gets 30%, plus any prize that had no eligible winner (fewer than 5 finished results).
  await sb.from("hf_rooms").update({ pot: pot.toString(), error: null }).eq("id", roomId);
  return { pot, marketing: pot - paid };
}

async function payOut(roomId: string) {
  const sb = supabaseService();
  const { data: room } = await sb.from("hf_rooms").select("*").eq("id", roomId).maybeSingle();
  const { data: list } = await sb.from("hf_entries").select("*").eq("room_id", roomId).eq("status", "paid");
  if (!room) return;
  const rows = (list || []) as Entry[];
  try {
    for (const x of rows) {
      if (x.payout_tx || !x.payout || BigInt(x.payout) <= 0n) continue;
      const hash = await send(x.wallet, BigInt(x.payout));
      await sb.from("hf_entries").update({ payout_tx: hash }).eq("id", x.id);
    }
    if (!room.marketing_tx) {
      const pot = BigInt(room.pot || "0"), prizes = rows.reduce((a, x) => a + BigInt(x.payout || "0"), 0n), mk = pot - prizes, to = marketingWallet();
      if (mk > 0n && to) {
        const hash = await send(to, mk);
        await sb.from("hf_rooms").update({ marketing_tx: hash }).eq("id", roomId);
      }
    }
    await sb.from("hf_rooms").update({ status: "paid", settled_at: new Date().toISOString(), error: null }).eq("id", roomId);
  } catch (err: any) {
    console.error("hyperfocus payout failed", roomId, err?.message);
    await sb.from("hf_rooms").update({ error: String(err?.shortMessage || err?.message || "payout failed").slice(0, 300) }).eq("id", roomId);
  }
}

/** Is a room waiting for players right now (for the menu)? */
export async function openRoom() {
  const sb = supabaseService();
  const { data: rooms } = await sb.from("hf_rooms").select("id,created_at").eq("status", "waiting").order("created_at", { ascending: true }).limit(1);
  if (!rooms?.length) return { players: 0 };
  const { count } = await sb.from("hf_entries").select("id", { count: "exact", head: true }).eq("room_id", rooms[0].id).eq("status", "paid");
  return { players: count || 0 };
}
