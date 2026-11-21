/**
 * LobbySol pools on Meteora DAMM v2 (cp-amm) instead of Raydium CPMM: about 0.02–0.03 SOL to create (rent only, no
 * 0.15 SOL protocol fee). Used for standard SPL tokens (no transfer tax). Token-2022 tokens with a tax stay on Raydium,
 * because DAMM v2 needs a Meteora "token badge" for those.
 *
 * Pools are Meteora "customizable" pools (one per token/SOL pair, address derived from the two mints): full price
 * range, a fixed 0.25% trading fee, liquidity NOT locked (so it can be removed later). Built transactions are v0 and
 * partly signed here by the new position NFT keypair; the admin's wallet signs and pays.
 * API: @meteora-ag/cp-amm-sdk (CpAmm.createCustomPool, getDepositQuote, addLiquidity / createPositionAndAddLiquidity,
 * removeLiquidity, getUserPositionByPool).
 */
import {
  ActivationType, BaseFeeMode, CollectFeeMode, CpAmm, MAX_SQRT_PRICE, MIN_SQRT_PRICE,
  deriveCustomizablePoolAddress, getBaseFeeParams, type PoolFeesParams,
} from "@meteora-ag/cp-amm-sdk";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { connection } from "@/lib/solana-launch";

export const METEORA_PROGRAM = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
const PRIORITY = Number(process.env.LAUNCH_SOLANA_PRIORITY || 100_000);
const amm = () => new CpAmm(connection() as any);
const pk = (v: string) => new PublicKey(v);

/** Can this mint go on Meteora? Standard SPL tokens only (Token-2022 tokens need a Meteora token badge). */
export async function meteoraOk(mint: string) {
  const acc = await connection().getAccountInfo(pk(mint));
  return !!acc && acc.owner.equals(TOKEN_PROGRAM_ID);
}
/** The LobbySol Meteora pool for this token (token / SOL), or null when there isn't one. */
export function meteoraPoolAddress(mint: string) {
  return deriveCustomizablePoolAddress(pk(mint), NATIVE_MINT);
}
export async function isMeteoraPool(poolId: string) {
  const acc = await connection().getAccountInfo(pk(poolId)).catch(() => null);
  return !!acc && acc.owner.equals(METEORA_PROGRAM);
}

/** v0 transaction with a priority fee, partly signed by `signers` (the payer's wallet signs the rest). */
async function toV0(payer: PublicKey, tx: Transaction, signers: Keypair[] = [], units = 400_000) {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
    ...tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)),
  ];
  const v = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  if (signers.length) v.sign(signers);
  return Buffer.from(v.serialize()).toString("base64");
}

const progOf = (flag: number) => (flag === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID);

/** Pool details in the same shape as the Raydium reader (lib/solana-launch-admin.ts), plus this wallet's share. */
export async function readMeteoraPool(mint: string, owner: string | null, decimals = 6) {
  const cp = amm();
  const pool = meteoraPoolAddress(mint);
  if (!(await cp.isPoolExist(pool))) return null;
  const s: any = await cp.fetchPoolState(pool);
  const tokenIsA = s.tokenAMint.equals(pk(mint));
  let mine = new BN(0);
  if (owner) {
    const ps = await cp.getUserPositionByPool(pool, pk(owner)).catch(() => []);
    for (const p of ps) mine = mine.add((p.positionState as any).unlockedLiquidity);
  }
  const total: BN = s.liquidity;
  const share = total.isZero() ? 0 : Number(mine.muln(10_000).div(total).toString()) / 100;
  return {
    pool: pool.toBase58(), lpMint: "", kind: "meteora" as const,
    // Whole tokens / SOL, like the Raydium reader.
    tokenReserve: String(Number((tokenIsA ? s.tokenAAmount : s.tokenBAmount).toString()) / 10 ** decimals),
    solReserve: String(Number((tokenIsA ? s.tokenBAmount : s.tokenAAmount).toString()) / 1e9),
    lpAmount: mine.toString(), lpDecimals: 0, sharePct: share,
  };
}

/** A new Meteora pool: `tokens` (base units) of the token + `lamports` of SOL from the admin's wallet. */
export async function buildMeteoraPool(owner: string, mint: string, tokens: bigint, lamports: bigint) {
  const cp = amm();
  const me = pk(owner);
  const tokenAAmount = new BN(tokens.toString()), tokenBAmount = new BN(lamports.toString());
  const { initSqrtPrice, liquidityDelta } = cp.preparePoolCreationParams({
    tokenAAmount, tokenBAmount, minSqrtPrice: MIN_SQRT_PRICE, maxSqrtPrice: MAX_SQRT_PRICE, collectFeeMode: CollectFeeMode.BothToken,
  } as any);
  // A fixed 0.25% fee (start = end, no schedule), no dynamic fee.
  const poolFees: PoolFeesParams = {
    baseFee: getBaseFeeParams({ baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear, feeTimeSchedulerParam: { startingFeeBps: 25, endingFeeBps: 25, numberOfPeriod: 0, totalDuration: 0 } }),
    compoundingFeeBps: 0, padding: 0, dynamicFee: null,
  } as any;
  const positionNft = Keypair.generate();
  const { tx, pool } = await cp.createCustomPool({
    payer: me, creator: me, positionNft: positionNft.publicKey,
    tokenAMint: pk(mint), tokenBMint: NATIVE_MINT, tokenAAmount, tokenBAmount,
    sqrtMinPrice: MIN_SQRT_PRICE, sqrtMaxPrice: MAX_SQRT_PRICE, liquidityDelta, initSqrtPrice, poolFees,
    hasAlphaVault: false, activationType: ActivationType.Timestamp, collectFeeMode: CollectFeeMode.BothToken, activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID, isLockLiquidity: false,
  } as any);
  return { tx: await toV0(me, tx, [positionNft]), pool: pool.toBase58(), lpMint: "" };
}

/** Add `lamports` of SOL (and the matching tokens at the pool's price) to the Meteora pool. */
export async function buildMeteoraAdd(owner: string, poolId: string, lamports: bigint) {
  const cp = amm();
  const me = pk(owner), pool = pk(poolId);
  const s: any = await cp.fetchPoolState(pool);
  const solIsA = s.tokenAMint.equals(NATIVE_MINT);
  const q = cp.getDepositQuote({
    inAmount: new BN(lamports.toString()), isTokenA: solIsA, minSqrtPrice: s.sqrtMinPrice, maxSqrtPrice: s.sqrtMaxPrice, sqrtPrice: s.sqrtPrice,
    collectFeeMode: s.collectFeeMode, tokenAAmount: s.tokenAAmount, tokenBAmount: s.tokenBAmount, liquidity: s.liquidity,
  } as any);
  const tokenNeed = q.outputAmount.muln(105).divn(100); // 5% room for the price moving
  const maxA = solIsA ? new BN(lamports.toString()) : tokenNeed, maxB = solIsA ? tokenNeed : new BN(lamports.toString());
  const common = {
    pool, liquidityDelta: q.liquidityDelta, maxAmountTokenA: maxA, maxAmountTokenB: maxB,
    tokenAAmountThreshold: maxA, tokenBAmountThreshold: maxB,
    tokenAMint: s.tokenAMint, tokenBMint: s.tokenBMint, tokenAProgram: progOf(s.tokenAFlag), tokenBProgram: progOf(s.tokenBFlag),
  };
  const mine = await cp.getUserPositionByPool(pool, me).catch(() => []);
  if (mine.length) {
    const tx = await cp.addLiquidity({ ...common, owner: me, position: mine[0].position, positionNftAccount: mine[0].positionNftAccount, tokenAVault: s.tokenAVault, tokenBVault: s.tokenBVault } as any);
    return { tx: await toV0(me, tx), lpMint: "" };
  }
  const positionNft = Keypair.generate();
  const tx = await cp.createPositionAndAddLiquidity({ ...common, owner: me, positionNft: positionNft.publicKey } as any);
  return { tx: await toV0(me, tx, [positionNft]), lpMint: "" };
}

/** Remove `pct`% of this wallet's liquidity from the Meteora pool (its biggest position). */
export async function buildMeteoraRemove(owner: string, poolId: string, pct: number) {
  if (!(pct > 0 && pct <= 100)) throw new Error("Percentage must be between 1 and 100.");
  const cp = amm();
  const me = pk(owner), pool = pk(poolId);
  const s: any = await cp.fetchPoolState(pool);
  const mine = (await cp.getUserPositionByPool(pool, me)).filter((p) => !(p.positionState as any).unlockedLiquidity.isZero());
  if (!mine.length) throw new Error("This wallet has no liquidity in that pool.");
  const p = mine[0];
  const unlocked: BN = (p.positionState as any).unlockedLiquidity;
  const delta = pct >= 100 ? unlocked : unlocked.muln(Math.round(pct)).divn(100);
  if (delta.isZero()) throw new Error("Amount too small.");
  const tx = await cp.removeLiquidity({
    owner: me, pool, position: p.position, positionNftAccount: p.positionNftAccount, liquidityDelta: delta,
    tokenAAmountThreshold: new BN(0), tokenBAmountThreshold: new BN(0),
    tokenAMint: s.tokenAMint, tokenBMint: s.tokenBMint, tokenAVault: s.tokenAVault, tokenBVault: s.tokenBVault,
    tokenAProgram: progOf(s.tokenAFlag), tokenBProgram: progOf(s.tokenBFlag), vestings: [], currentPoint: new BN(Math.floor(Date.now() / 1000)),
  } as any);
  return { tx: await toV0(me, tx, [], 300_000) };
}
