/**
 * Hyperfocus GP paid races, server side. Entry is $0.50 of $AUTISTIK (BNB Chain), sent from the player's own wallet to
 * the game wallet with a one-time code on the end, so nobody can claim someone else's payment. Rooms hold 10 and start
 * when full. Each player's buttons stream in during the race (checked against the server clock, so a race can't be
 * worked out offline and sent afterwards) and are replayed here through the same race rules the game uses
 * (lib/hyperfocus-sim). The pot is split automatically: 30% to the marketing wallet, 70% to the top 5.
 *
 * Money out of the game wallet (prizes, marketing share, refunds) goes through one queue (hf_transfers): one sender at
 * a time, explicit nonces, and each transfer is signed and saved before it is broadcast, so a retry rebroadcasts the
 * same transaction and can never pay twice. A transfer only counts once its receipt confirms on-chain.
 * The game wallet's key (HYPERFOCUS_GAME_KEY) lives only in the server's environment. Server only.
 */
import { createHash, randomBytes, randomUUID } from "crypto";
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, http, isAddress, keccak256, parseEventLogs } from "viem";
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
/** The price moves while a payment confirms and $AUTISTIK has a small transfer tax: accept 92% or more. */
const SLACK = 92n;
/** A price quote is good for 15 minutes. */
const QUOTE_MS = 15 * 60_000;
/** Buttons must reach the server within 45 s of being pressed, and can't be ahead of the clock by more than 3 s. */
const LATE_STEPS = 45 * 30, EARLY_STEPS = 3 * 30;
/** After the 5 minutes, a minute for the last buttons to arrive. */
const GRACE_MS = 60_000;
/** The course is revealed 8 seconds before the start (time to build it on a phone). */
const REVEAL_MS = 8_000;
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
export const enabled = () => !!gameAccount() && !!marketingWallet();
const pub = () => createPublicClient({ chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 15_000 }) }) as any;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sb = () => supabaseService();
/** Supabase reports errors in the result; this turns them into thrown errors so nothing fails silently. */
async function must(q: PromiseLike<{ data: any; error: any }>): Promise<any> {
  const { data, error } = await q;
  if (error) throw new Error(error.message || "database error");
  return data;
}

let decCache: number | null = null;
export async function tokenDecimals() {
  if (decCache != null) return decCache;
  try { decCache = Number(await pub().readContract({ address: PRO_TOKEN, abi: erc20Abi, functionName: "decimals" })); } catch { return 18; }
  return decCache;
}

export type Entry = {
  id: string; room_id: string | null; wallet: string; name: string; car: string; color: string | null; nonce: string; secret_hash: string;
  amount: string; received: string | null; tx_hash: string | null; status: string; created_at: string; inputs: string | null; steps: number;
  pos: number | null; finished: boolean | null; ft: number | null; place: number | null; payout: string | null; payout_tx: string | null; refund_tx: string | null;
};
export type Room = { id: string; status: string; seed: number; start_at: string | null; created_at: string; settled_at: string | null; pot: string | null; marketing_tx: string | null; error: string | null };

async function activeSeat(wallet: string, exceptId?: string) {
  const { data } = await sb().from("hf_entries").select("id,hf_rooms!inner(status)").ilike("wallet", wallet).eq("status", "paid")
    .in("hf_rooms.status", ["waiting", "racing", "settling"]).limit(3);
  return (data || []).some((x: any) => x.id !== exceptId);
}

/** A price quote and a one-time code for a new entry. */
export async function quote(walletIn: string, nameIn: string, carIn: string, colorIn: string) {
  const game = gameAccount();
  if (!game || !marketingWallet()) return { error: "Paid races open soon." as const };
  if (!isAddress(walletIn)) return { error: "Connect a BNB Chain wallet (0x…) to enter." as const };
  const name = String(nameIn || "").replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 16);
  if (!name) return { error: "Add your name to join." as const };
  if (await activeSeat(walletIn)) return { error: "This wallet is already in a race. Finish or leave it first." as const };
  const [price, dec] = await Promise.all([autistikPriceUsd(), tokenDecimals()]);
  if (!price) return { error: "Couldn't get the $AUTISTIK price right now. Try again in a minute." as const };
  const amount = unitsFor(ENTRY_USD, price, dec);
  const nonce = randomBytes(16).toString("hex"), secret = randomBytes(16).toString("hex");
  const color = /^#[0-9a-fA-F]{6}$/.test(colorIn) ? colorIn : null;
  const { data, error } = await sb().from("hf_entries").insert({
    wallet: getAddress(walletIn), name, car: CARS.has(carIn) ? carIn : "street", color, nonce, secret_hash: sha(secret), amount: amount.toString(),
  }).select("id").single();
  if (error || !data) return { error: "Couldn't start your entry. Try again." as const };
  return { entryId: data.id as string, secret, nonce, amount: amount.toString(), decimals: dec, priceUsd: price, usd: ENTRY_USD, token: PRO_TOKEN, gameWallet: game.address };
}

async function entryFor(id: string, secret: string): Promise<Entry | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/.test(secret)) return null;
  const { data } = await sb().from("hf_entries").select("*").eq("id", id).maybeSingle();
  return data && data.secret_hash === sha(secret) ? (data as Entry) : null;
}

/** Seats a paid entry (safe to repeat: an entry already seated keeps its seat). */
async function seat(e: Entry): Promise<{ roomId?: string; error?: string; retry?: boolean }> {
  if (await activeSeat(e.wallet, e.id)) {
    // Paid twice from the same wallet: send this payment straight back.
    await sb().from("hf_entries").update({ status: "left" }).eq("id", e.id).eq("status", "paid");
    await queueRefund(e.id);
    await processTransfers().catch(() => null);
    return { error: "This wallet is already in a race, so this payment is being sent back to you." };
  }
  const { data, error } = await sb().rpc("hf_join", { p_entry: e.id });
  if (error || !data?.[0]) return { error: "Paid, but couldn't seat you yet. Trying again…", retry: true };
  return { roomId: data[0].room_id as string };
}

/** Checks the entry payment on-chain, then seats the player in a room. */
export async function join(id: string, secret: string, txHashIn: string): Promise<{ roomId?: string; error?: string; retry?: boolean }> {
  const game = gameAccount();
  if (!game) return { error: "Paid races open soon." };
  const e = await entryFor(id, secret);
  if (!e) return { error: "That entry wasn't found. Start again." };
  if (e.status === "paid") return e.room_id ? { roomId: e.room_id } : seat(e);
  if (e.status !== "quoted") return { error: "That entry is closed." };
  const txHash = String(txHashIn || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return { error: "That isn't a transaction hash." };
  const p = pub();
  let tx: any, receipt: any, block: any;
  try {
    receipt = await p.waitForTransactionReceipt({ hash: txHash, timeout: 40_000 });
    [tx, block] = await Promise.all([p.getTransaction({ hash: txHash }), p.getBlock({ blockNumber: receipt.blockNumber })]);
  } catch { return { error: "Couldn't find that payment on BNB Chain yet. Trying again…", retry: true }; }
  if (receipt.status !== "success") return { error: "That payment failed on-chain." };
  if (!tx.to || getAddress(tx.to) !== getAddress(PRO_TOKEN)) return { error: "That isn't an $AUTISTIK payment." };
  if (getAddress(tx.from) !== getAddress(e.wallet)) return { error: "That payment came from a different wallet." };
  const paidAt = Number(block.timestamp) * 1000, quotedAt = Date.parse(e.created_at);
  if (paidAt < quotedAt - 120_000) return { error: "That payment is older than this entry." };
  const input = String(tx.input || "0x").toLowerCase();
  if (input.length !== 2 + 8 + 128 + 32 || !input.endsWith(e.nonce)) return { error: "That payment wasn't made from this entry. Use the Pay button." };
  let call: any;
  try { call = decodeFunctionData({ abi: erc20Abi, data: input.slice(0, 2 + 8 + 128) as `0x${string}` }); } catch { call = null; }
  if (!call || call.functionName !== "transfer" || getAddress(call.args[0] as string) !== getAddress(game.address)) return { error: "That payment didn't go to the game wallet." };
  const received = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
    .filter((l: any) => getAddress(l.address) === getAddress(PRO_TOKEN) && getAddress(l.args.to) === getAddress(game.address))
    .reduce((a: bigint, l: any) => a + (l.args.value as bigint), 0n);
  // A late or short payment still reached the game wallet: record it and send it straight back.
  const late = paidAt > quotedAt + QUOTE_MS, low = received * 100n < BigInt(e.amount) * SLACK;
  const { data: upd, error } = await sb().from("hf_entries").update({ status: late || low ? "left" : "paid", tx_hash: txHash, received: received.toString(), paid_at: new Date().toISOString() })
    .eq("id", e.id).eq("status", "quoted").select("id");
  if (error) return error.code === "23505" ? { error: "That payment was already used." } : { error: "Couldn't save your entry. Trying again…", retry: true };
  if (!upd?.length) {
    const again = await entryFor(id, secret);
    return again?.status === "paid" ? (again.room_id ? { roomId: again.room_id } : seat(again)) : { error: "That entry is closed." };
  }
  if (late || low) {
    if (received > 0n) { await queueRefund(e.id); await processTransfers().catch(() => null); }
    return { error: late ? "That price quote expired before the payment arrived, so it's being sent back. Start a new entry." : `That payment is less than $${ENTRY_USD} of $AUTISTIK, so it's being sent back.` };
  }
  return seat({ ...e, status: "paid", received: received.toString() });
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A room as the players see it. Also moves settlement and payouts along. */
export async function roomView(roomId: string, me?: { id: string; secret: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
  let { data: room } = await sb().from("hf_rooms").select("*").eq("id", roomId).maybeSingle();
  if (!room) return null;
  if (room.status === "racing" || room.status === "settling") {
    await maybeSettle(room as Room).catch((e) => console.error("hyperfocus settle", roomId, e?.message));
    ({ data: room } = await sb().from("hf_rooms").select("*").eq("id", roomId).maybeSingle());
  }
  const { data: list } = await sb().from("hf_entries").select("*").eq("room_id", roomId).eq("status", "paid").order("paid_at", { ascending: true });
  const mine = me ? await entryFor(me.id, me.secret) : null;
  const done = room!.status === "paid";
  const reveal = !!room!.start_at && Date.now() >= Date.parse(room!.start_at) - REVEAL_MS;
  return {
    now: Date.now(), size: ROOM_SIZE, entryUsd: ENTRY_USD, decimals: await tokenDecimals(), priceUsd: await autistikPriceUsd().catch(() => null),
    room: { id: room!.id, status: room!.status, startAt: room!.start_at ? Date.parse(room!.start_at) : null, seed: reveal ? room!.seed : null, raceSecs: HFSim.RACE_SECS,
      pot: room!.pot, marketingTx: room!.marketing_tx },
    me: mine && mine.room_id === roomId ? { steps: mine.steps } : null,
    // Everyone's results stay hidden until the room is paid, so nobody can see the score to beat.
    players: (list || []).map((x: any) => ({ id: x.id, name: x.name, wallet: short(x.wallet), walletFull: done ? x.wallet : null, car: x.car, color: x.color,
      place: done ? x.place : null, payout: done ? x.payout : null, payoutTx: done ? x.payout_tx : null, submitted: done ? x.steps > 0 : null,
      finished: done ? x.finished : null, pos: done ? x.pos : null, me: !!mine && mine.id === x.id })),
  };
}

/**
 * The next run of buttons for a player's race, sent every few seconds while they drive. Each run must start where the
 * last one ended and must arrive close to real time, so a race can't be worked out offline and sent in afterwards.
 */
export async function inputs(id: string, secret: string, fromIn: unknown, chunk: string) {
  const e = await entryFor(id, secret);
  if (!e || e.status !== "paid" || !e.room_id) return { error: "That entry isn't in a race." };
  const { data: room } = await sb().from("hf_rooms").select("*").eq("id", e.room_id).maybeSingle();
  if (!room || room.status !== "racing" || !room.start_at) return { error: "That race isn't running.", steps: e.steps };
  const t0 = Date.parse(room.start_at), now = Date.now();
  if (now > t0 + HFSim.RACE_SECS * 1000 + GRACE_MS - 5_000) return { error: "This race is closed.", steps: e.steps };
  const from = Number(fromIn);
  if (from !== e.steps) return { error: "Out of step.", steps: e.steps };
  const add = HFSim.decode(chunk);
  if (!add || !add.length) return { error: "Those race inputs don't look right.", steps: e.steps };
  const to = from + add.length, elapsed = Math.floor(((now - t0) / 1000) / HFSim.STEP);
  if (to > HFSim.STEPS || to > elapsed + EARLY_STEPS) return { error: "Too early.", steps: e.steps };
  // Every run must begin within 45 s of real time (so a whole race can't be sent in one go at the end).
  if (from < Math.min(elapsed, HFSim.STEPS) - LATE_STEPS || add.length > LATE_STEPS) return { error: "Too late: your connection dropped for too long.", steps: e.steps };
  const all = (e.inputs ? HFSim.decode(e.inputs) || [] : []).concat(add);
  const { data: upd } = await sb().from("hf_entries").update({ inputs: HFSim.encode(all), steps: to, submitted_at: new Date().toISOString() })
    .eq("id", e.id).eq("steps", from).select("id");
  if (!upd?.length) return { error: "Out of step.", steps: (await entryFor(id, secret))?.steps ?? from };
  return { ok: true, steps: to };
}

/** Leaving before the race starts refunds the entry. Before paying there's nothing to refund. */
export async function leave(id: string, secret: string) {
  const e = await entryFor(id, secret);
  if (!e) return { error: "That entry wasn't found." };
  if (e.status === "quoted") return { ok: true, refunded: false };
  if (e.status === "left" || e.status === "refunded") return { ok: true, refunded: true };
  const { data: ok } = await sb().rpc("hf_leave", { p_entry: e.id });
  if (!ok) return { error: "The race has already started, so this entry can't be refunded." };
  await queueRefund(e.id);
  await processTransfers().catch(() => null);
  return { ok: true, refunded: true };
}

async function queueRefund(entryId: string) {
  const { data: e } = await sb().from("hf_entries").select("wallet,received").eq("id", entryId).maybeSingle();
  if (!e || !(BigInt(e.received || "0") > 0n)) return;
  // The unique index (kind, entry) makes this a no-op if the refund is already queued.
  await sb().from("hf_transfers").insert({ kind: "refund", entry_id: entryId, to_wallet: e.wallet, amount: e.received });
}

/** Ranks the room and queues the payouts once the race is over. Safe to call many times. */
async function maybeSettle(room: Room) {
  if (!room.start_at) return;
  const end = Date.parse(room.start_at) + HFSim.RACE_SECS * 1000;
  if (room.status === "racing") {
    if (Date.now() < end) return;
    const list = await must(sb().from("hf_entries").select("id,steps").eq("room_id", room.id).eq("status", "paid"));
    const all = (list || []).every((x: any) => x.steps >= HFSim.STEPS);
    if (!all && Date.now() < end + GRACE_MS) return;
    const claimed = await must(sb().from("hf_rooms").update({ status: "settling", settled_at: new Date().toISOString() }).eq("id", room.id).eq("status", "racing").select("id"));
    if (!claimed?.length) return;
    await rank(room);
  }
  await processTransfers();
}

/** Replays every race, saves places and prizes, and queues the transfers. Nothing is sent here. */
async function rank(room: Room) {
  const rows = (await must(sb().from("hf_entries").select("*").eq("room_id", room.id).eq("status", "paid"))) as Entry[];
  const T = HFSim.track(room.seed);
  const results = rows.map((x) => {
    const r = x.steps > 0 && x.inputs ? HFSim.replay(T, x.car, x.inputs) : null;
    return { x, r: r ? { pos: r.pos, finished: r.finished, ft: r.ft } : null };
  });
  const done = results.filter((d) => d.r && d.r.pos > HFSim.SEG * 25).sort((a: any, b: any) => HFSim.better(a.r, b.r));
  const rest = results.filter((d) => !done.includes(d));
  const pot = rows.reduce((a, x) => a + BigInt(x.received || "0"), 0n);
  const winners = pot - (pot * MARKETING_PCT) / 100n;
  let prizes = 0n;
  const ordered = [...done, ...rest];
  for (let i = 0; i < ordered.length; i++) {
    const d = ordered[i], eligible = i < done.length && i < SPLIT.length;
    const share = eligible ? (winners * SPLIT[i]) / 100n : 0n;
    prizes += share;
    await must(sb().from("hf_entries").update({ place: i + 1, payout: share.toString(), pos: d.r?.pos ?? 0, finished: !!d.r?.finished, ft: d.r?.ft || null }).eq("id", d.x.id));
    if (share > 0n) await sb().from("hf_transfers").insert({ kind: "prize", room_id: room.id, entry_id: d.x.id, to_wallet: d.x.wallet, amount: share.toString() });
  }
  // Marketing gets 30%, plus any prize with no eligible winner and the rounding dust.
  const mk = pot - prizes, to = marketingWallet();
  if (mk > 0n && to) await sb().from("hf_transfers").insert({ kind: "marketing", room_id: room.id, to_wallet: to, amount: mk.toString() });
  await must(sb().from("hf_rooms").update({ pot: pot.toString(), error: to ? null : "No marketing wallet set" }).eq("id", room.id));
}

/**
 * Sends queued transfers from the game wallet, one sender at a time. Each transfer gets an explicit nonce, is signed and
 * saved first, then broadcast; it only counts once its receipt confirms. A saved transfer that never landed is
 * rebroadcast as the same signed transaction (or requeued if its nonce was used by another), so nothing is paid twice.
 */
export async function processTransfers() {
  const account = gameAccount();
  if (!account) return;
  const me = randomUUID(), started = Date.now();
  const got = await must(sb().from("hf_sender_lock").update({ holder: me, until: new Date(Date.now() + 58_000).toISOString() })
    .eq("id", 1).lt("until", new Date().toISOString()).select("id"));
  if (!got?.length) return;
  const p = pub();
  const w = createWalletClient({ account, chain: bsc, transport: http(CHAINS.bsc.rpc, { timeout: 15_000 }) }) as any;
  try {
    // 1. Transfers already signed: did they land?
    const signed = await must(sb().from("hf_transfers").select("*").eq("status", "signed").order("nonce", { ascending: true }).limit(20));
    if (signed?.length) {
      const latest = BigInt(await p.getTransactionCount({ address: account.address, blockTag: "latest" }));
      for (const t of signed) {
        const rc = await p.getTransactionReceipt({ hash: t.hash }).catch(() => null);
        if (rc) { await settleTransfer(t, rc.status === "success" ? "confirmed" : "failed"); continue; }
        if (BigInt(t.nonce) < latest) {
          // Its nonce was used by something else, so it can never land: sign it again with a fresh nonce.
          await must(sb().from("hf_transfers").update({ status: "queued", nonce: null, hash: null, raw: null, updated_at: new Date().toISOString() }).eq("id", t.id).eq("status", "signed"));
        } else {
          await p.sendRawTransaction({ serializedTransaction: t.raw }).catch(() => null);
        }
      }
    }
    // 2. New transfers, oldest first.
    const queued = await must(sb().from("hf_transfers").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(8));
    if (!queued?.length) return;
    const stillSigned = await must(sb().from("hf_transfers").select("nonce").eq("status", "signed").order("nonce", { ascending: false }).limit(1));
    let nonce = BigInt(await p.getTransactionCount({ address: account.address, blockTag: "pending" }));
    if (stillSigned?.[0]?.nonce != null && BigInt(stillSigned[0].nonce) + 1n > nonce) nonce = BigInt(stillSigned[0].nonce) + 1n;
    const gasPrice = await p.getGasPrice();
    for (const t of queued) {
      if (Date.now() - started > 40_000) break;
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(t.to_wallet), BigInt(t.amount)] });
      let gas = 150_000n;
      try { gas = ((await p.estimateGas({ account: account.address, to: PRO_TOKEN, data })) * 13n) / 10n; } catch { /* keep the safe default */ }
      const raw = await w.signTransaction({ to: PRO_TOKEN, data, nonce: Number(nonce), gas, gasPrice, chainId: bsc.id, type: "legacy" });
      const hash = keccak256(raw);
      // Saved before it goes out: a crash after this point rebroadcasts this exact transaction, never a new one.
      const saved = await must(sb().from("hf_transfers").update({ status: "signed", nonce: nonce.toString(), hash, raw, updated_at: new Date().toISOString() }).eq("id", t.id).eq("status", "queued").select("id"));
      if (!saved?.length) continue;
      nonce += 1n;
      await p.sendRawTransaction({ serializedTransaction: raw }).catch(() => null);
      const rc = await p.waitForTransactionReceipt({ hash, timeout: 20_000 }).catch(() => null);
      if (rc) await settleTransfer({ ...t, hash }, rc.status === "success" ? "confirmed" : "failed");
    }
  } catch (err: any) {
    console.error("hyperfocus transfers", err?.shortMessage || err?.message);
  } finally {
    await sb().from("hf_sender_lock").update({ until: new Date(0).toISOString() }).eq("id", 1).eq("holder", me);
    await finishRooms().catch(() => null);
  }
}

async function settleTransfer(t: any, status: "confirmed" | "failed") {
  await must(sb().from("hf_transfers").update({ status, error: status === "failed" ? "reverted on-chain" : null, updated_at: new Date().toISOString() }).eq("id", t.id));
  if (status !== "confirmed") { if (t.room_id) await sb().from("hf_rooms").update({ error: `A ${t.kind} transfer failed on-chain` }).eq("id", t.room_id); return; }
  if (t.kind === "prize") await must(sb().from("hf_entries").update({ payout_tx: t.hash }).eq("id", t.entry_id));
  else if (t.kind === "refund") await must(sb().from("hf_entries").update({ refund_tx: t.hash, status: "refunded" }).eq("id", t.entry_id));
  else if (t.kind === "marketing") await must(sb().from("hf_rooms").update({ marketing_tx: t.hash }).eq("id", t.room_id));
}

/** A settling room is paid once every one of its transfers has confirmed. */
async function finishRooms() {
  const rooms = await must(sb().from("hf_rooms").select("id").eq("status", "settling").limit(10));
  for (const r of rooms || []) {
    const ts = await must(sb().from("hf_transfers").select("status").eq("room_id", r.id));
    if ((ts || []).every((t: any) => t.status === "confirmed")) await sb().from("hf_rooms").update({ status: "paid", settled_at: new Date().toISOString() }).eq("id", r.id).eq("status", "settling");
  }
}

/** Moves along races nobody is watching any more, and any waiting transfers (refunds). Called from the status check. */
export async function sweep() {
  const cutoff = new Date(Date.now() - (HFSim.RACE_SECS * 1000 + GRACE_MS)).toISOString();
  const { data: stale } = await sb().from("hf_rooms").select("*").eq("status", "racing").lt("start_at", cutoff).limit(3);
  for (const r of stale || []) await maybeSettle(r as Room).catch(() => null);
  const { count } = await sb().from("hf_transfers").select("id", { count: "exact", head: true }).in("status", ["queued", "signed"]);
  if (count) await processTransfers().catch(() => null);
}

/** Is a room waiting for players right now (for the menu)? */
export async function openRoom() {
  const { data: rooms } = await sb().from("hf_rooms").select("id,created_at").eq("status", "waiting").order("created_at", { ascending: true }).limit(1);
  if (!rooms?.length) return { players: 0 };
  const { count } = await sb().from("hf_entries").select("id", { count: "exact", head: true }).eq("room_id", rooms[0].id).eq("status", "paid");
  return { players: count || 0 };
}
