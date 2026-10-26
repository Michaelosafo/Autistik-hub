/**
 * Solana holder rewards. Server only.
 *
 * A Solana coin launched with holder rewards is a Token-2022 coin with one fee on every transfer (so on every trade,
 * on any app or DEX): the AUTISTIK fee (solTradeFeeBps) plus the creator's fee. Nobody can change it (no fee authority).
 * The fee is withheld in the receiving token accounts, and only the AUTISTIK rewards wallet (SOLANA_REWARDS_KEY, its
 * private key added in Vercel) can collect it. Every run (app/api/launchpad/solana-rewards, every 10 minutes):
 *  1. collect the withheld fee from every account of the coin into the rewards wallet;
 *  2. split what came in: the AUTISTIK part to the marketing wallet, the creator's part (minus the holders' share) to
 *     the creator's wallet, the holders' share swapped on Jupiter into the reward (SOL, BTC or ETH);
 *  3. credit every holder by how much they hold (pools, lockers and other program accounts don't earn);
 *  4. send what's due, a batch per run. Anyone can also claim their own rewards on the coin's page.
 * Amounts owed are kept in the database (sol_reward_owed) and marked paid before they're sent, so nothing is paid twice.
 */
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction,
  createWithdrawWithheldTokensFromAccountsInstruction, createWithdrawWithheldTokensFromMintInstruction, getAssociatedTokenAddressSync,
  getTransferFeeAmount, getTransferFeeConfig, unpackAccount, unpackMint,
} from "@solana/spl-token";
import { SOL_DECIMALS, SOL_REWARD_TOKENS, solFeeWallet } from "@/lib/launchpad";
import { supabaseService } from "@/lib/supabase/server";

const RPC = process.env.LAUNCH_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const PRIORITY = Number(process.env.SOLANA_REWARDS_PRIORITY || 20_000);
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";
/** Smallest automatic payout per reward (base units): about 0.001 SOL, 100 sats, 0.00001 ETH. */
export const MIN_PAYOUT: Record<string, bigint> = { sol: 1_000_000n, btc: 100n, eth: 1_000n };
/** Smallest claim (base units): anything above dust. */
export const MIN_CLAIM: Record<string, bigint> = { sol: 100_000n, btc: 10n, eth: 100n };

const conn = () => new Connection(RPC, "confirmed");
const pk = (v: string) => new PublicKey(v);

// ---------------------------------------------------------------- the rewards wallet

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string) {
  let n = 0n;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}

let wallet: Keypair | null | undefined;
/** The AUTISTIK rewards wallet (SOLANA_REWARDS_KEY: a base58 private key as wallets export it, or a JSON byte array). */
export function rewardsWallet(): Keypair | null {
  if (wallet !== undefined) return wallet;
  const raw = (process.env.SOLANA_REWARDS_KEY || "").trim();
  try {
    const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : b58decode(raw);
    wallet = bytes.length === 64 ? Keypair.fromSecretKey(bytes) : null;
  } catch { wallet = null; }
  return wallet;
}
export const rewardsReady = () => !!rewardsWallet();

async function send(ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const w = rewardsWallet()!;
  const c = conn();
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: w.publicKey, recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ...ixs],
  }).compileToV0Message());
  tx.sign([w, ...signers]);
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const r = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (r.value.err) throw new Error(`transaction failed: ${JSON.stringify(r.value.err)}`);
  return sig;
}

async function programOf(mint: string) {
  const acc = await conn().getAccountInfo(pk(mint));
  if (!acc) throw new Error("mint not found");
  return acc.owner;
}

/** The fee config of a coin, if it is a Token-2022 coin whose fee only the rewards wallet can collect. */
export async function rewardFeeOf(mint: string) {
  const w = rewardsWallet();
  const acc = await conn().getAccountInfo(pk(mint)).catch(() => null);
  if (!w || !acc || !acc.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  const cfg = getTransferFeeConfig(unpackMint(pk(mint), acc, TOKEN_2022_PROGRAM_ID));
  if (!cfg || !cfg.withdrawWithheldAuthority.equals(w.publicKey) || cfg.transferFeeConfigAuthority) return null;
  return { bps: cfg.newerTransferFee.transferFeeBasisPoints, withheldOnMint: cfg.withheldAmount };
}

// ---------------------------------------------------------------- Jupiter

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

/** Swaps `amount` of `inMint` into `outMint` from the rewards wallet. Returns what arrived (base units). */
async function swap(inMint: string, outMint: string, amount: bigint, rewardKey: string): Promise<bigint> {
  const w = rewardsWallet()!;
  const c = conn();
  const q = await getJson(`${JUP}/swap/v1/quote?inputMint=${inMint}&outputMint=${outMint}&amount=${amount}&slippageBps=300&restrictIntermediateTokens=true`);
  if (!q?.outAmount) throw new Error("no route");
  if (BigInt(q.outAmount) < MIN_CLAIM[rewardKey] * 5n) throw new Error("too small to swap yet");
  const j = await getJson(`${JUP}/swap/v1/swap`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: q, userPublicKey: w.publicKey.toBase58(), wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true, prioritizationFeeLamports: 20_000 }),
  });
  if (!j?.swapTransaction) throw new Error("no swap transaction");
  const tx = VersionedTransaction.deserialize(Buffer.from(j.swapTransaction, "base64"));
  tx.sign([w]);
  const native = rewardKey === "sol";
  const outAta = native ? null : getAssociatedTokenAddressSync(pk(outMint), w.publicKey, false, await programOf(outMint));
  const before = native ? 0n : BigInt((await c.getTokenAccountBalance(outAta!).catch(() => null))?.value.amount ?? "0");
  const sig = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const bh = await c.getLatestBlockhash("confirmed");
  const r = await c.confirmTransaction({ signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
  if (r.value.err) throw new Error("swap failed");
  if (!native) return BigInt((await c.getTokenAccountBalance(outAta!)).value.amount) - before;
  // SOL: what the swap added to the wallet, plus the network fee it paid.
  const t = await c.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!t?.meta) return BigInt(q.otherAmountThreshold); // the least it could have been
  const i = t.transaction.message.staticAccountKeys.findIndex((k) => k.equals(w.publicKey));
  return BigInt(t.meta.postBalances[i] - t.meta.preBalances[i] + t.meta.fee);
}

// ---------------------------------------------------------------- one coin

type Coin = { mint: string; creator: string; reward: string; fee_bps: number; platform_bps: number; holder_bps: number; tax_wallet: string; pending_tokens: string; active: boolean };

/** Every token account of the coin: who holds how much, and the fee withheld in it. */
async function accountsOf(mint: string) {
  const list = await conn().getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint } }] });
  const out: { address: PublicKey; owner: PublicKey; amount: bigint; withheld: bigint }[] = [];
  for (const a of list) {
    try {
      const t = unpackAccount(a.pubkey, a.account, TOKEN_2022_PROGRAM_ID);
      out.push({ address: a.pubkey, owner: t.owner, amount: t.amount, withheld: getTransferFeeAmount(t)?.withheldAmount ?? 0n });
    } catch { /* not a token account */ }
  }
  return out;
}

/** Collects, splits, swaps and credits one coin. Returns a short report. */
export async function runCoin(coin: Coin) {
  const sb = supabaseService();
  const w = rewardsWallet()!;
  const mint = pk(coin.mint);
  const reward = SOL_REWARD_TOKENS[coin.reward];
  if (!reward) return { mint: coin.mint, skipped: "unknown reward" };
  const fee = await rewardFeeOf(coin.mint);
  if (!fee) return { mint: coin.mint, skipped: "fee not collectable by the rewards wallet" };
  const accounts = await accountsOf(coin.mint);

  // 1. Collect the withheld fee into the rewards wallet's account for this coin.
  const mine = getAssociatedTokenAddressSync(mint, w.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const sources = accounts.filter((a) => a.withheld > 0n).map((a) => a.address);
  const head = [createAssociatedTokenAccountIdempotentInstruction(w.publicKey, mine, w.publicKey, mint, TOKEN_2022_PROGRAM_ID)];
  if (fee.withheldOnMint > 0n) head.push(createWithdrawWithheldTokensFromMintInstruction(mint, mine, w.publicKey, [], TOKEN_2022_PROGRAM_ID) as any);
  for (let i = 0; i < Math.max(1, sources.length); i += 20) {
    const chunk = sources.slice(i, i + 20);
    const ixs = i === 0 ? [...head] : [];
    if (chunk.length) ixs.push(createWithdrawWithheldTokensFromAccountsInstruction(mint, mine, w.publicKey, [], chunk, TOKEN_2022_PROGRAM_ID) as any);
    if (ixs.length) await send(ixs);
  }

  // 2. Split what came in since last time. The holders' part waiting to be swapped (pending_tokens) isn't split again.
  const balance = BigInt((await conn().getTokenAccountBalance(mine).catch(() => null))?.value.amount ?? "0");
  const pending = BigInt(coin.pending_tokens || "0");
  const fresh = balance > pending ? balance - pending : 0n;
  const total = BigInt(coin.platform_bps + coin.fee_bps);
  const platformPart = total > 0n ? (fresh * BigInt(coin.platform_bps)) / total : 0n;
  const creatorAll = fresh - platformPart;
  const holdersPart = (creatorAll * BigInt(coin.holder_bps)) / 10_000n;
  const creatorPart = creatorAll - holdersPart;
  const pay: TransactionInstruction[] = [];
  const give = (to: string, amount: bigint) => {
    if (amount <= 0n) return;
    const ata = getAssociatedTokenAddressSync(mint, pk(to), true, TOKEN_2022_PROGRAM_ID);
    pay.push(createAssociatedTokenAccountIdempotentInstruction(w.publicKey, ata, pk(to), mint, TOKEN_2022_PROGRAM_ID));
    pay.push(createTransferCheckedInstruction(mine, mint, ata, w.publicKey, amount, SOL_DECIMALS, [], TOKEN_2022_PROGRAM_ID));
  };
  const marketing = solFeeWallet();
  give(marketing ?? coin.tax_wallet, platformPart);
  give(coin.tax_wallet, creatorPart);
  if (pay.length) await send(pay);
  let toSwap = pending + holdersPart;
  await sb.from("sol_reward_coins").update({
    pending_tokens: toSwap.toString(), last_run: new Date().toISOString(),
    collected: (BigInt(await stat(coin.mint, "collected")) + fresh).toString(),
  }).eq("mint", coin.mint);

  // 3. Swap the holders' part into the reward and credit every holder by how much they hold.
  let got = 0n, swapNote = "";
  if (toSwap > 0n) {
    try {
      got = await swap(coin.mint, reward.mint, toSwap, coin.reward);
      toSwap = 0n;
    } catch (e) { swapNote = (e as Error).message; }
  }
  await sb.from("sol_reward_coins").update({ pending_tokens: toSwap.toString() }).eq("mint", coin.mint);
  let credited = 0;
  if (got > 0n) credited = await credit(coin, accounts, got);
  return { mint: coin.mint, collected: fresh.toString(), toHolders: got.toString(), credited, swap: swapNote || undefined };
}

async function stat(mint: string, col: "collected" | "distributed") {
  const { data } = await supabaseService().from("sol_reward_coins").select(col).eq("mint", mint).maybeSingle();
  return String((data as any)?.[col] ?? "0").split(".")[0] || "0";
}

/** Shares `amount` of the reward between holders by balance. Program-owned accounts (pools, lockers) don't earn. */
async function credit(coin: Coin, accounts: Awaited<ReturnType<typeof accountsOf>>, amount: bigint) {
  const w = rewardsWallet()!;
  const byOwner = new Map<string, bigint>();
  for (const a of accounts) {
    if (a.amount === 0n || !PublicKey.isOnCurve(a.owner.toBytes())) continue;
    const o = a.owner.toBase58();
    if (o === w.publicKey.toBase58() || o === INCINERATOR) continue;
    byOwner.set(o, (byOwner.get(o) ?? 0n) + a.amount);
  }
  const supply = [...byOwner.values()].reduce((x, y) => x + y, 0n);
  if (supply === 0n) return 0;
  const min = supply / 1_000_000n; // tiny dust balances still count toward nothing
  const rows: { h: string; a: string }[] = [];
  let given = 0n;
  for (const [h, bal] of byOwner) {
    if (bal < min) continue;
    const share = (amount * bal) / supply;
    if (share > 0n) { rows.push({ h, a: share.toString() }); given += share; }
  }
  const sb = supabaseService();
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await sb.rpc("sol_rewards_credit", { p_mint: coin.mint, p_rows: rows.slice(i, i + 1000) });
    if (error) throw new Error(error.message);
  }
  await sb.from("sol_reward_coins").update({ distributed: (BigInt(await stat(coin.mint, "distributed")) + given).toString() }).eq("mint", coin.mint);
  return rows.length;
}

// ---------------------------------------------------------------- paying out

/** Sends `amount` of the reward to each holder. Returns which ones were sent. */
async function sendRewards(rewardKey: string, items: { holder: string; amount: bigint }[]) {
  const w = rewardsWallet()!;
  const reward = SOL_REWARD_TOKENS[rewardKey];
  const ok: string[] = [];
  if (rewardKey === "sol") {
    for (let i = 0; i < items.length; i += 15) {
      const chunk = items.slice(i, i + 15);
      try {
        await send(chunk.map((x) => SystemProgram.transfer({ fromPubkey: w.publicKey, toPubkey: pk(x.holder), lamports: x.amount })));
        ok.push(...chunk.map((x) => x.holder));
      } catch { /* refunded below */ }
    }
    return ok;
  }
  const program = await programOf(reward.mint);
  const from = getAssociatedTokenAddressSync(pk(reward.mint), w.publicKey, false, program);
  // Only to holders who already have an account for the reward token (claiming creates it, paid by the holder).
  const atas = items.map((x) => getAssociatedTokenAddressSync(pk(reward.mint), pk(x.holder), true, program));
  const infos = await conn().getMultipleAccountsInfo(atas);
  const ready = items.map((x, i) => ({ ...x, ata: atas[i], exists: !!infos[i] })).filter((x) => x.exists);
  for (let i = 0; i < ready.length; i += 10) {
    const chunk = ready.slice(i, i + 10);
    try {
      await send(chunk.map((x) => createTransferCheckedInstruction(from, pk(reward.mint), x.ata, w.publicKey, x.amount, reward.decimals, [], program)));
      ok.push(...chunk.map((x) => x.holder));
    } catch { /* refunded below */ }
  }
  return ok;
}

/** Automatic payouts for one coin: the holders owed the most, up to `limit`. */
export async function payoutCoin(coin: Coin, limit = 45) {
  const sb = supabaseService();
  const { data } = await sb.rpc("sol_rewards_take_many", { p_mint: coin.mint, p_min: MIN_PAYOUT[coin.reward].toString(), p_limit: limit });
  const items = ((data as any[]) || []).map((r) => ({ holder: String(r.holder), amount: BigInt(String(r.amount).split(".")[0]) }));
  if (!items.length) return 0;
  const sent = new Set(await sendRewards(coin.reward, items));
  // Anything not sent (no account for the reward yet, or a failed transaction) stays owed.
  for (const x of items) if (!sent.has(x.holder)) await sb.rpc("sol_rewards_refund", { p_mint: coin.mint, p_holder: x.holder, p_amount: x.amount.toString() });
  return sent.size;
}

/** A holder claims what they're owed now. */
export async function claim(mint: string, holder: string) {
  const sb = supabaseService();
  const { data: coin } = await sb.from("sol_reward_coins").select("reward").eq("mint", mint).maybeSingle();
  if (!coin) return { error: "This coin has no holder rewards." };
  const { data } = await sb.rpc("sol_rewards_take", { p_mint: mint, p_holder: holder, p_min: MIN_CLAIM[coin.reward].toString() });
  const amount = BigInt(String(data ?? "0").split(".")[0] || "0");
  if (amount <= 0n) return { error: "Nothing to claim yet." };
  const sent = await sendRewards(coin.reward, [{ holder, amount }]);
  if (!sent.length) {
    await sb.rpc("sol_rewards_refund", { p_mint: mint, p_holder: holder, p_amount: amount.toString() });
    return { error: coin.reward === "sol" ? "Couldn't send it right now. Try again in a minute." : "needs-account" };
  }
  return { ok: true, amount: amount.toString(), reward: coin.reward };
}

/** The holder's own transaction that opens their account for the reward token (they pay its small deposit). */
export async function buildRewardAccount(mint: string, holder: string) {
  const { data: coin } = await supabaseService().from("sol_reward_coins").select("reward").eq("mint", mint).maybeSingle();
  const reward = coin && SOL_REWARD_TOKENS[coin.reward];
  if (!reward || coin.reward === "sol") return { error: "Nothing to set up." };
  const program = await programOf(reward.mint);
  const owner = pk(holder);
  const ata = getAssociatedTokenAddressSync(pk(reward.mint), owner, true, program);
  const { blockhash } = await conn().getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({
    payerKey: owner, recentBlockhash: blockhash,
    instructions: [createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, pk(reward.mint), program)],
  }).compileToV0Message());
  return { tx: Buffer.from(tx.serialize()).toString("base64") };
}

/** What a coin's holders have been paid, and (with `holder`) what one holder has earned and can claim. */
export async function rewardsInfo(mint: string, holder?: string) {
  const sb = supabaseService();
  const { data: coin } = await sb.from("sol_reward_coins").select("reward,fee_bps,platform_bps,holder_bps,distributed,active").eq("mint", mint).maybeSingle();
  if (!coin) return null;
  const { count } = await sb.from("sol_reward_owed").select("holder", { count: "exact", head: true }).eq("mint", mint);
  let mine: { earned: string; due: string } | null = null;
  if (holder) {
    const { data: r } = await sb.from("sol_reward_owed").select("owed,paid").eq("mint", mint).eq("holder", holder).maybeSingle();
    const owed = BigInt(String(r?.owed ?? "0").split(".")[0]), paid = BigInt(String(r?.paid ?? "0").split(".")[0]);
    mine = { earned: owed.toString(), due: (owed - paid).toString() };
  }
  return { ...coin, distributed: String(coin.distributed ?? "0").split(".")[0], holders: count ?? 0, mine };
}
