/**
 * Solana launches and liquidity, server side. Builds unsigned transactions for the creator's wallet to sign:
 *  1. mint: a new SPL token with a fixed supply (minting switched off for good, no freeze), on-chain name and ticker,
 *     the whole supply sent to the creator, plus the small launch fee (SOL_LAUNCH_FEE) to the AUTISTIK marketing wallet. The new mint's own key signs here and is then thrown away.
 *  2. pool: a Raydium CPMM pool (token / SOL) seeded from the creator's wallet.
 *  3. burn: the creator's LP tokens burned, so the liquidity stays in the pool forever.
 * Plus adding liquidity to any Raydium CPMM pool with SOL on one side. Nothing here can move anyone's money: every
 * transaction pays from, and pays out to, the creator's own wallet (apart from the launch fee, shown before signing),
 * and only their wallet can sign it.
 */
import BN from "bn.js";
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  AuthorityType, MINT_SIZE, NATIVE_MINT, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createBurnInstruction,
  createInitializeMint2Instruction, createMintToInstruction, createSetAuthorityInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { CREATE_CPMM_POOL_FEE_ACC, CREATE_CPMM_POOL_PROGRAM, Percent, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { SOL_DECIMALS, solFeeWallet, solLaunchFee } from "@/lib/launchpad";
import { vanityMint } from "@/lib/solana-vanity";

const RPC = process.env.LAUNCH_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/+$/, "");
/** A small priority fee so launches land when the network is busy (micro-lamports per compute unit). */
const PRIORITY = Number(process.env.LAUNCH_SOLANA_PRIORITY || 100_000);

export const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const connection = () => new Connection(RPC, "confirmed");
const pk = (v: string) => new PublicKey(v);
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

async function v0(payer: PublicKey, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  if (signers.length) tx.sign(signers);
  return tx;
}

// ---------------------------------------------------------------- token metadata (Metaplex, written by hand)

const str = (s: string) => { const b = Buffer.from(s, "utf8"); const len = Buffer.alloc(4); len.writeUInt32LE(b.length); return Buffer.concat([len, b]); };
export const metadataPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];

/** Metaplex CreateMetadataAccountV3: name, ticker and a link to the token's details; immutable afterwards. */
function createMetadataIx(mint: PublicKey, creator: PublicKey, name: string, symbol: string, uri: string) {
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3
    str(name), str(symbol), str(uri),
    Buffer.from([0, 0]), // seller fee basis points (u16)
    Buffer.from([0, 0, 0]), // creators, collection, uses: none
    Buffer.from([0]), // is_mutable: false
    Buffer.from([0]), // collection details: none
  ]);
  return new TransactionInstruction({
    programId: METADATA_PROGRAM,
    keys: [
      { pubkey: metadataPda(mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: creator, isSigner: true, isWritable: false }, // mint authority
      { pubkey: creator, isSigner: true, isWritable: true }, // payer
      { pubkey: creator, isSigner: true, isWritable: false }, // update authority
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/** Reads name, ticker and update authority back from a token's Metaplex metadata. */
export async function readMetadata(mint: PublicKey) {
  const acc = await connection().getAccountInfo(metadataPda(mint));
  if (!acc || !acc.owner.equals(METADATA_PROGRAM)) return null;
  const d = acc.data;
  const updateAuthority = new PublicKey(d.subarray(1, 33));
  let o = 65;
  const read = () => { const n = d.readUInt32LE(o); const s = d.subarray(o + 4, o + 4 + n).toString("utf8").replace(/\0+$/, ""); o += 4 + n; return s; };
  const name = read(), symbol = read();
  return { name, symbol, updateAuthority };
}

// ---------------------------------------------------------------- 1. the token

/** A new token: fixed supply to the creator, minting switched off, no freeze authority. Returns the half-signed transaction. */
export async function buildMint(creatorAddr: string, plan: { name: string; symbol: string; supply: string }) {
  const creator = pk(creatorAddr);
  // Its address ends in "tik" (lib/solana-vanity.ts), like pump.fun addresses end in "pump".
  const mint = await vanityMint();
  const conn = connection();
  const rent = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
  const ata = getAssociatedTokenAddressSync(mint.publicKey, creator);
  const amount = BigInt(plan.supply) * 10n ** BigInt(SOL_DECIMALS);
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
    SystemProgram.createAccount({ fromPubkey: creator, newAccountPubkey: mint.publicKey, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint.publicKey, SOL_DECIMALS, creator, null),
    createMetadataIx(mint.publicKey, creator, plan.name, plan.symbol, `${SITE}/api/launchpad/solana/meta/${mint.publicKey.toBase58()}`),
    createAssociatedTokenAccountIdempotentInstruction(creator, ata, creator, mint.publicKey),
    createMintToInstruction(mint.publicKey, ata, creator, amount),
    createSetAuthorityInstruction(mint.publicKey, creator, AuthorityType.MintTokens, null),
  ];
  const feeTo = solFeeWallet(), fee = BigInt(Math.round(solLaunchFee() * 1e9));
  if (feeTo && fee > 0n) ixs.push(SystemProgram.transfer({ fromPubkey: creator, toPubkey: pk(feeTo), lamports: fee }));
  const tx = await v0(creator, ixs, [mint]);
  return { tx: b64(tx), mint: mint.publicKey.toBase58() };
}

// ---------------------------------------------------------------- 2. the pool, and adding to any pool

async function raydium(owner: string) {
  const r = await Raydium.load({ connection: connection(), owner: pk(owner), cluster: "mainnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "confirmed" });
  await r.account.fetchWalletTokenAccounts();
  return r;
}
const SOL_TOKEN = { address: NATIVE_MINT.toBase58(), decimals: 9, programId: TOKEN_PROGRAM_ID.toBase58() };

/** A Raydium CPMM pool for the token, seeded with `tokens` (base units) and `lamports` from the creator's wallet. */
export async function buildPool(creator: string, mint: string, tokens: bigint, lamports: bigint) {
  const r = await raydium(creator);
  const configs = await r.api.getCpmmConfigs();
  // The standard 0.25% pool, as on raydium.io; falls back to the first config Raydium lists.
  const feeConfig = configs.find((c) => c.tradeFeeRate === 2500) ?? configs[0];
  if (!feeConfig) throw new Error("Raydium didn't return its pool settings. Try again.");
  // Raydium wants the two coins of a pool in address order (smaller first); most tokens sort after SOL.
  const conn = connection();
  const info = await conn.getParsedAccountInfo(pk(mint)).catch(() => null);
  const decimals = Number((info?.value?.data as any)?.parsed?.info?.decimals ?? SOL_DECIMALS);
  const tokenSide = { address: mint, decimals, programId: TOKEN_PROGRAM_ID.toBase58() };
  const tokenFirst = Buffer.compare(pk(mint).toBuffer(), NATIVE_MINT.toBuffer()) < 0;
  const [mintA, mintB, amountA, amountB] = tokenFirst ? [tokenSide, SOL_TOKEN, tokens, lamports] : [SOL_TOKEN, tokenSide, lamports, tokens];
  const { transaction, extInfo } = await r.cpmm.createPool({
    programId: CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
    mintA,
    mintB,
    mintAAmount: new BN(amountA.toString()),
    mintBAmount: new BN(amountB.toString()),
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    computeBudgetConfig: { units: 400_000, microLamports: PRIORITY },
    txVersion: TxVersion.V0,
  });
  return { tx: b64(transaction), pool: extInfo.address.poolId.toBase58(), lpMint: extInfo.address.lpMint.toBase58() };
}

/** Finds the token's Raydium CPMM pool paired with SOL (the deepest one), or uses the pool given. */
export async function findPool(mint: string, poolId?: string) {
  const r = await Raydium.load({ connection: connection(), cluster: "mainnet", disableFeatureCheck: true, disableLoadToken: true });
  let id = poolId;
  if (!id) {
    const res = await r.api.fetchPoolByMints({ mint1: mint, mint2: NATIVE_MINT.toBase58() }).catch(() => null);
    const cpmm = (res?.data || []).filter((p: any) => p.programId === CREATE_CPMM_POOL_PROGRAM.toBase58()).sort((a: any, b: any) => (b.tvl ?? 0) - (a.tvl ?? 0));
    id = cpmm[0]?.id;
  }
  if (!id) return null;
  const { poolInfo } = await r.cpmm.getPoolInfoFromRpc(id);
  const solIsA = poolInfo.mintA.address === NATIVE_MINT.toBase58();
  if (!solIsA && poolInfo.mintB.address !== NATIVE_MINT.toBase58()) return null;
  const token = solIsA ? poolInfo.mintB : poolInfo.mintA;
  if (token.address !== mint) return null;
  return {
    pool: id, lpMint: poolInfo.lpMint.address, symbol: token.symbol || "", decimals: token.decimals,
    tokenReserve: String(solIsA ? poolInfo.mintAmountB : poolInfo.mintAmountA), solReserve: String(solIsA ? poolInfo.mintAmountA : poolInfo.mintAmountB),
  };
}

/** Adds to a CPMM pool: `amount` (base units) of SOL or of the token; Raydium works out the other side at the pool's price. */
export async function buildAddLiquidity(owner: string, poolId: string, side: "sol" | "token", amount: bigint) {
  const r = await raydium(owner);
  const { poolInfo, poolKeys } = await r.cpmm.getPoolInfoFromRpc(poolId);
  const solIsA = poolInfo.mintA.address === NATIVE_MINT.toBase58();
  const baseIn = side === "sol" ? solIsA : !solIsA;
  const { transaction } = await r.cpmm.addLiquidity({
    poolInfo, poolKeys, inputAmount: new BN(amount.toString()), baseIn, slippage: new Percent(5, 100),
    computeBudgetConfig: { units: 300_000, microLamports: PRIORITY }, txVersion: TxVersion.V0,
  });
  return { tx: b64(transaction), lpMint: poolInfo.lpMint.address };
}

// ---------------------------------------------------------------- 3. burning the LP tokens

/** Burns every LP token of this pool in the owner's wallet. */
export async function buildBurnLp(owner: string, lpMint: string) {
  const o = pk(owner), m = pk(lpMint);
  const ata = getAssociatedTokenAddressSync(m, o);
  const bal = await connection().getTokenAccountBalance(ata).catch(() => null);
  const amount = BigInt(bal?.value.amount || "0");
  if (amount === 0n) throw new Error("There are no LP tokens in this wallet to burn yet. Wait a few seconds and try again.");
  const tx = await v0(o, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), createBurnInstruction(ata, m, o, amount)]);
  return { tx: b64(tx), amount: amount.toString() };
}

// ---------------------------------------------------------------- checking a launch before it's listed

/** Everything the Hub stores about a Solana launch, read from the chain: fixed supply, no freeze, metadata, Raydium pool. */
export async function verifyLaunch(mintAddr: string, poolAddr: string) {
  const conn = connection();
  const mint = pk(mintAddr), pool = pk(poolAddr);
  const [mintAcc, poolAcc, meta] = await Promise.all([conn.getParsedAccountInfo(mint), conn.getAccountInfo(pool), readMetadata(mint)]);
  const info: any = (mintAcc.value?.data as any)?.parsed?.info;
  if (!info || !mintAcc.value?.owner.equals(TOKEN_PROGRAM_ID)) return { error: "That isn't a token on Solana." };
  if (info.mintAuthority || info.freezeAuthority) return { error: "Only tokens with minting and freezing switched off can be listed." };
  if (!meta) return { error: "That token has no name and ticker on-chain." };
  if (!poolAcc || !poolAcc.owner.equals(CREATE_CPMM_POOL_PROGRAM)) return { error: "That isn't a Raydium pool." };
  // The pool account holds both mints; make sure this one is in it.
  if (!poolAcc.data.includes(mint.toBuffer())) return { error: "That pool isn't for this token." };
  return { name: meta.name, symbol: meta.symbol, creator: meta.updateAuthority.toBase58(), supply: (BigInt(info.supply) / 10n ** BigInt(info.decimals)).toString() };
}
