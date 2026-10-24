/**
 * The AUTISTIK Solana Locker (programs/autistik-locker): Raydium LP tokens locked for 6 months or 1 year, after which
 * only the creator can claim them back. No admin, no early release. Server only.
 *
 * The program's address goes in NEXT_PUBLIC_SOLANA_LOCKER_PROGRAM once it's deployed. Until then Solana launches stay
 * burn-only. Locks are only offered while the program is final (no upgrade authority), so nobody can change its code.
 */
import { createHash } from "crypto";
import {
  ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { solLockerProgram } from "@/lib/launchpad";
import { connection } from "@/lib/solana-launch";

const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const PRIORITY = Number(process.env.LAUNCH_SOLANA_PRIORITY || 100_000);
/** Launches lock with id 0: one lock per creator per LP token. */
export const LAUNCH_LOCK_ID = 0n;

const disc = (s: string) => createHash("sha256").update(s).digest().subarray(0, 8);
const IX_LOCK = disc("global:lock");
const IX_CLAIM = disc("global:claim");
const ACCOUNT_LOCK = disc("account:TokenLock");

export function lockerId() {
  const id = solLockerProgram();
  return id ? new PublicKey(id) : null;
}

const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const i64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(v); return b; };

export function lockPda(program: PublicKey, mint: PublicKey, owner: PublicKey, id = LAUNCH_LOCK_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from("lock"), mint.toBuffer(), owner.toBuffer(), u64(id)], program)[0];
}
export function vaultPda(program: PublicKey, lock: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), lock.toBuffer()], program)[0];
}

/** True when the locker's code can never change again (its upgrade authority was removed). */
export async function lockerIsFinal(): Promise<boolean> {
  const program = lockerId();
  if (!program) return false;
  const conn = connection();
  const acc = await conn.getAccountInfo(program);
  if (!acc || !acc.executable || !acc.owner.equals(UPGRADEABLE_LOADER) || acc.data.length < 36) return false;
  const programData = new PublicKey(acc.data.subarray(4, 36));
  const pd = await conn.getAccountInfo(programData);
  // ProgramData: u32 tag (3), u64 slot, Option<Pubkey> upgrade authority (tag byte at offset 12).
  return !!pd && pd.data.length >= 13 && pd.data.readUInt32LE(0) === 3 && pd.data[12] === 0;
}

export type LockInfo = { address: string; owner: string; mint: string; amount: bigint; lockedAt: number; unlockAt: number };

/** Reads a lock account, or null when there is none (never locked, or already claimed). */
export async function readLock(address: PublicKey): Promise<LockInfo | null> {
  const program = lockerId();
  if (!program) return null;
  const acc = await connection().getAccountInfo(address);
  if (!acc || !acc.owner.equals(program) || acc.data.length < 8 + 97 || !acc.data.subarray(0, 8).equals(ACCOUNT_LOCK)) return null;
  const d = acc.data;
  return {
    address: address.toBase58(),
    owner: new PublicKey(d.subarray(8, 40)).toBase58(),
    mint: new PublicKey(d.subarray(40, 72)).toBase58(),
    amount: d.readBigUInt64LE(80),
    lockedAt: Number(d.readBigInt64LE(88)),
    unlockAt: Number(d.readBigInt64LE(96)),
  };
}

async function v0(payer: PublicKey, ixs: TransactionInstruction[]) {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  return Buffer.from(tx.serialize()).toString("base64");
}

/** Locks every LP token of `lpMint` in the owner's wallet until `unlockAt` (unix seconds). */
export async function buildLockLp(ownerAddr: string, lpMintAddr: string, unlockAt: number) {
  const program = lockerId();
  if (!program) throw new Error("The AUTISTIK Solana Locker isn't set up yet.");
  if (!(await lockerIsFinal())) throw new Error("The AUTISTIK Solana Locker isn't final yet, so locks are off for now. Burn the LP tokens, or try later.");
  const owner = new PublicKey(ownerAddr), mint = new PublicKey(lpMintAddr);
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner);
  const bal = await connection().getTokenAccountBalance(ownerTokens).catch(() => null);
  const amount = BigInt(bal?.value.amount || "0");
  if (amount === 0n) throw new Error("There are no LP tokens in this wallet to lock yet. Wait a few seconds and try again.");
  const lock = lockPda(program, mint, owner);
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: ownerTokens, isSigner: false, isWritable: true },
      { pubkey: lock, isSigner: false, isWritable: true },
      { pubkey: vaultPda(program, lock), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([IX_LOCK, u64(LAUNCH_LOCK_ID), u64(amount), i64(BigInt(unlockAt))]),
  });
  return { tx: await v0(owner, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }), ix]), lock: lock.toBase58(), amount: amount.toString() };
}

/** After the date: the creator takes their LP tokens back (into their own wallet). */
export async function buildClaimLp(ownerAddr: string, lpMintAddr: string) {
  const program = lockerId();
  if (!program) throw new Error("The AUTISTIK Solana Locker isn't set up yet.");
  const owner = new PublicKey(ownerAddr), mint = new PublicKey(lpMintAddr);
  const lock = lockPda(program, mint, owner);
  const info = await readLock(lock);
  if (!info) throw new Error("There's no lock for this wallet. It may have been claimed already.");
  if (info.unlockAt * 1000 > Date.now()) throw new Error(`Still locked until ${new Date(info.unlockAt * 1000).toLocaleDateString("en-GB")}.`);
  const ownerTokens = getAssociatedTokenAddressSync(mint, owner);
  const ix = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: ownerTokens, isSigner: false, isWritable: true },
      { pubkey: lock, isSigner: false, isWritable: true },
      { pubkey: vaultPda(program, lock), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: IX_CLAIM,
  });
  return {
    tx: await v0(owner, [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
      createAssociatedTokenAccountIdempotentInstruction(owner, ownerTokens, owner, mint),
      ix,
    ]),
  };
}
