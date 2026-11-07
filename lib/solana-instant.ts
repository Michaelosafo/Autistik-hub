/**
 * Solana Instant launch, server side: no liquidity from the creator and no bonding curve, like Instant on BNB Chain.
 *  1. mint: the coin (lib/solana-launch.ts buildMint), its whole supply to the creator.
 *  2. pool: a Raydium concentrated (CLMM) pool, coin / SOL, 1% fee, starting at a small market cap; then the whole
 *     supply goes in one-sided (no SOL needed), across a range from the starting price up to 100,000x.
 *  3. lock: that pool position is locked forever with Raydium's own lock program. The creator gets a fee-claim NFT:
 *     they can collect the pool's trading fees, but nobody can ever take the liquidity out.
 * Every transaction is built here and signed in the creator's own wallet. Tested end to end on Solana devnet
 * (mint, pool, one-sided position, lock, then a buy) before it was switched on.
 */
import BN from "bn.js";
import Decimal from "decimal.js";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { CLMM_LOCK_AUTH_ID, CLMM_LOCK_PROGRAM_ID, CLMM_PROGRAM_ID, Raydium, TxVersion, getPdaPersonalPositionAddress } from "@raydium-io/raydium-sdk-v2";
import { SOL_DECIMALS } from "@/lib/launchpad";
import { connection, readMetadata } from "@/lib/solana-launch";

/** Starting market cap in SOL (the whole supply). About $4–6k: small enough to move, big enough to stop dust buys. */
export const SOL_INSTANT_FDV = Number(process.env.SOL_INSTANT_FDV_SOL || 30);
export const SOL_INSTANT_SUPPLY = 1_000_000_000;
/** The pool's trading fee tier (Raydium CLMM): 1%. */
const FEE_RATE = 10_000;
const PRIORITY = Number(process.env.LAUNCH_SOLANA_PRIORITY || 100_000);
const MAX_TICK = 443_636;

const pk = (v: string) => new PublicKey(v);
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
/** Builder output as a base64 transaction, signed by any one-time keys the builder made (e.g. the position NFT). */
function ready(built: any) {
  const tx: VersionedTransaction = built.transaction;
  if (built.signers?.length) tx.sign(built.signers);
  return b64(tx);
}

async function raydium(owner: string) {
  const r = await Raydium.load({ connection: connection() as Connection, owner: pk(owner), cluster: "mainnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "confirmed" });
  await r.account.fetchWalletTokenAccounts();
  return r;
}

/**
 * Step 2: the pool and the one-sided position, as two transactions signed one after the other (pool first).
 * The whole balance of the coin in the creator's wallet goes in.
 */
export async function buildInstantPool(creator: string, mint: string) {
  const conn = connection();
  const mintAcc = await conn.getAccountInfo(pk(mint));
  if (!mintAcc) throw new Error("Your coin isn't on Solana yet. Wait a few seconds and try again.");
  const program = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const ata = getAssociatedTokenAddressSync(pk(mint), pk(creator), false, program);
  const bal = await conn.getTokenAccountBalance(ata).catch(() => null);
  const amount = BigInt(bal?.value?.amount || "0");
  if (amount === 0n) throw new Error("This wallet doesn't hold the coin. Use the wallet that created it.");

  const r = await raydium(creator);
  const cfgs = await r.api.getClmmConfigs();
  const cfg: any = cfgs.find((c: any) => c.tradeFeeRate === FEE_RATE);
  if (!cfg) throw new Error("Raydium didn't return its 1% pool setting. Try again in a minute.");
  const tokenInfo: any = { chainId: 101, address: mint, programId: program.toBase58(), logoURI: "", symbol: "", name: "", decimals: SOL_DECIMALS, tags: [], extensions: {} };
  const solInfo: any = { chainId: 101, address: NATIVE_MINT.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), logoURI: "", symbol: "WSOL", name: "Wrapped SOL", decimals: 9, tags: [], extensions: {} };

  // Price of one coin in SOL at the start: the starting market cap spread over the whole supply.
  const created: any = await r.clmm.createPool({
    programId: CLMM_PROGRAM_ID, mint1: tokenInfo, mint2: solInfo,
    ammConfig: { ...cfg, id: pk(cfg.id), fundOwner: "", description: "" },
    initialPrice: new Decimal(SOL_INSTANT_FDV).div(SOL_INSTANT_SUPPLY),
    computeBudgetConfig: { units: 400_000, microLamports: PRIORITY },
    txVersion: TxVersion.V0,
  } as any);
  const info: any = created.extInfo.mockPoolInfo;
  const address: any = created.extInfo.address;
  const spacing: number = info.config.tickSpacing;
  // The pool's current tick from its price (in raw units), then a range on the coin's side only, so no SOL is needed:
  // from just past the starting price up to 100,000x. Bounded, so every wallet and router can quote it.
  const cur = Math.floor(Math.log(Number(info.price) * 10 ** (info.mintB.decimals - info.mintA.decimals)) / Math.log(1.0001));
  const maxT = Math.floor(MAX_TICK / spacing) * spacing;
  const span = Math.floor(Math.log(100_000) / Math.log(1.0001) / spacing) * spacing;
  const tokenIsA = info.mintA.address === mint;
  const edge = tokenIsA ? (Math.floor(cur / spacing) + 1) * spacing : Math.floor(cur / spacing) * spacing;
  const tickLower = tokenIsA ? edge : Math.max(-maxT, edge - span);
  const tickUpper = tokenIsA ? Math.min(maxT, edge + span) : edge;

  const opened: any = await r.clmm.openPositionFromBase({
    poolInfo: info,
    poolKeys: { vault: { A: address.vault?.A ?? address.mintAVault, B: address.vault?.B ?? address.mintBVault } },
    tickLower, tickUpper, base: tokenIsA ? "MintA" : "MintB",
    baseAmount: new BN(amount.toString()), otherAmountMax: new BN(0),
    ownerInfo: { useSOLBalance: true }, nft2022: true,
    computeBudgetConfig: { units: 600_000, microLamports: PRIORITY },
    txVersion: TxVersion.V0,
  } as any);
  return {
    txs: [ready(created), ready(opened)],
    pool: (address.id ?? address.poolId).toString() as string,
    nftMint: opened.extInfo.nftMint.toBase58() as string,
  };
}

/** Step 3: lock the pool position forever (Raydium's lock program). The creator keeps a fee-claim NFT. */
export async function buildInstantLock(creator: string, nftMint: string) {
  const r = await raydium(creator);
  const built: any = await r.clmm.lockPosition({
    programId: CLMM_LOCK_PROGRAM_ID, authProgramId: CLMM_LOCK_AUTH_ID, poolProgramId: CLMM_PROGRAM_ID,
    ownerPosition: { nftMint: pk(nftMint) } as any,
    computeBudgetConfig: { units: 300_000, microLamports: PRIORITY },
    txVersion: TxVersion.V0,
  } as any);
  return { tx: ready(built) };
}

/**
 * Checks a Solana Instant launch on-chain before it goes on the Board: the coin (minting and freezing off, a name),
 * its Raydium CLMM pool, and the pool position holding the coin, locked by Raydium's lock program.
 */
export async function verifyInstant(mintAddr: string, poolAddr: string, nftMintAddr: string) {
  const conn = connection();
  const mint = pk(mintAddr), pool = pk(poolAddr), nft = pk(nftMintAddr);
  const [mintAcc, poolAcc, meta] = await Promise.all([conn.getParsedAccountInfo(mint), conn.getAccountInfo(pool), readMetadata(mint)]);
  const minfo: any = (mintAcc.value?.data as any)?.parsed?.info;
  if (!minfo) return { error: "That isn't a token on Solana." };
  if (minfo.mintAuthority || minfo.freezeAuthority) return { error: "Only coins with minting and freezing switched off can be listed." };
  if (!meta) return { error: "That coin has no name and ticker on-chain." };
  if (!poolAcc || !poolAcc.owner.equals(CLMM_PROGRAM_ID) || !poolAcc.data.includes(mint.toBuffer())) return { error: "That isn't this coin's Raydium pool." };
  // The pool position for this NFT must exist in this pool…
  const position = getPdaPersonalPositionAddress(CLMM_PROGRAM_ID, nft).publicKey;
  const posAcc = await conn.getAccountInfo(position);
  if (!posAcc || !posAcc.data.includes(pool.toBuffer())) return { error: "Couldn't find the pool position yet. Wait a few seconds and try again." };
  // …and its NFT must sit with Raydium's lock program (its authority's account holds it), so nobody can take the
  // liquidity out. A light check: one account read, no scans.
  const lockAta = getAssociatedTokenAddressSync(nft, CLMM_LOCK_AUTH_ID, true, TOKEN_2022_PROGRAM_ID);
  const held = await conn.getTokenAccountBalance(lockAta).catch(() => null);
  if (held?.value?.amount !== "1") return { error: "The pool position isn't locked yet. Finish the last step, then try again." };
  return { name: meta.name, symbol: meta.symbol, creator: meta.updateAuthority.toBase58(), supply: (BigInt(minfo.supply) / 10n ** BigInt(minfo.decimals)).toString() };
}
