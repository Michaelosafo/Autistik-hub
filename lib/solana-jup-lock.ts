/**
 * Solana token locks on the Lockers page, through Jupiter Lock (LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn): free,
 * open source and audited, run by Jupiter. Everything happens on the Hub; Jupiter's program only holds the tokens.
 *
 * Each lock is a Jupiter "vesting escrow" set up as a plain time lock:
 *  - the whole amount unlocks at one date (the cliff), nothing before it
 *  - nobody can cancel it (cancel_mode 0) and nobody can change who gets it (update_recipient_mode 0)
 *  - after the date, only the recipient's wallet can claim it
 * Tested on devnet against the live program (lock, nothing out early, someone else refused, full claim after).
 * Builds unsigned transactions for the member's own wallet; the server never holds anyone's tokens. Server only.
 */
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection, readMetadata } from "@/lib/solana-launch";

export const JUP_LOCK = new PublicKey("LocpQgucEQHbqNABEYvBvwoxCPsSbG91A1QaQhQQqjn");
const IX_CREATE = Buffer.from([23, 100, 197, 94, 222, 153, 38, 90]); // create_vesting_escrow
const IX_CLAIM = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]); // claim(max_amount)
const ACCOUNT_ESCROW = Buffer.from([244, 119, 183, 4, 73, 116, 135, 195]); // VestingEscrow
const ESCROW_SIZE = 296;
const PRIORITY = Number(process.env.LAUNCH_SOLANA_PRIORITY || 100_000);
/** The longest lock offered (10 years). */
export const MAX_LOCK_SECONDS = 10 * 366 * 86_400;
const [EVENT_AUTHORITY] = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], JUP_LOCK);

const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
const escrowOf = (base: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("escrow"), base.toBuffer()], JUP_LOCK)[0];

async function v0(payer: PublicKey, ixs: TransactionInstruction[], signers: Keypair[] = []) {
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  if (signers.length) tx.sign(signers);
  return Buffer.from(tx.serialize()).toString("base64");
}

/** A token's decimals, ticker and the wallet's balance of it. Only classic SPL tokens (Jupiter Lock v1). */
export async function tokenInfo(ownerAddr: string, mintAddr: string) {
  const conn = connection();
  const mint = new PublicKey(mintAddr);
  const acc = await conn.getParsedAccountInfo(mint);
  const info: any = (acc.value?.data as any)?.parsed?.info;
  if (!acc.value) return { error: "That token doesn't exist on Solana." };
  if (!acc.value.owner.equals(TOKEN_PROGRAM_ID) || !info) return { error: "Only standard Solana tokens can be locked here (not Token-2022 tokens)." };
  const ata = getAssociatedTokenAddressSync(mint, new PublicKey(ownerAddr));
  const [bal, meta] = await Promise.all([conn.getTokenAccountBalance(ata).catch(() => null), readMetadata(mint).catch(() => null)]);
  return { decimals: Number(info.decimals), symbol: meta?.symbol || "", name: meta?.name || "", balance: bal?.value.amount ?? "0" };
}

/** Locks `amount` (base units) of `mint` from the owner's wallet until `unlockAt` (unix seconds). Returns the half-signed transaction. */
export async function buildJupLock(ownerAddr: string, mintAddr: string, amount: bigint, unlockAt: number) {
  const owner = new PublicKey(ownerAddr), mint = new PublicKey(mintAddr);
  const now = Math.floor(Date.now() / 1000);
  if (amount <= 0n) throw new Error("Type an amount above zero.");
  if (unlockAt <= now + 60) throw new Error("Pick an unlock date in the future.");
  if (unlockAt - now > MAX_LOCK_SECONDS) throw new Error("Locks can be at most 10 years.");
  const info = await tokenInfo(ownerAddr, mintAddr);
  if ("error" in info) throw new Error(info.error);
  if (BigInt(info.balance) < amount) throw new Error("This wallet doesn't hold that many of this token.");

  // The escrow's address comes from a fresh one-time key; it signs here and is then thrown away.
  const base = Keypair.generate();
  const escrow = escrowOf(base.publicKey);
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true);
  const ownerToken = getAssociatedTokenAddressSync(mint, owner);
  const data = Buffer.concat([
    IX_CREATE,
    u64(BigInt(now)), // vesting_start_time
    u64(BigInt(unlockAt)), // cliff_time: the unlock date
    u64(1n), // frequency (must not be 0; unused with no periods)
    u64(amount), // cliff_unlock_amount: everything unlocks at the date
    u64(0n), // amount_per_period
    u64(0n), // number_of_period
    Buffer.from([0]), // update_recipient_mode: nobody can change who gets it
    Buffer.from([0]), // cancel_mode: nobody can cancel
  ]);
  const ix = new TransactionInstruction({
    programId: JUP_LOCK,
    keys: [
      { pubkey: base.publicKey, isSigner: true, isWritable: true },
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: escrowToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ownerToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false }, // recipient: the same wallet
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: JUP_LOCK, isSigner: false, isWritable: false },
    ],
    data,
  });
  const tx = await v0(owner, [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
    createAssociatedTokenAccountIdempotentInstruction(owner, escrowToken, escrow, mint),
    ix,
  ], [base]);
  return { tx, escrow: escrow.toBase58() };
}

export type JupLock = {
  escrow: string; recipient: string; creator: string; mint: string; unlockAt: number; amount: string; claimed: string;
  /** A true time lock: no cancelling, no changing the recipient, everything at one date. */
  strict: boolean;
};

function decode(address: PublicKey, d: Buffer): JupLock | null {
  if (d.length < ESCROW_SIZE || !d.subarray(0, 8).equals(ACCOUNT_ESCROW)) return null;
  const key = (o: number) => new PublicKey(d.subarray(o, o + 32)).toBase58();
  const cliff = d.readBigUInt64LE(160), perPeriod = d.readBigUInt64LE(168), periods = d.readBigUInt64LE(176);
  return {
    escrow: address.toBase58(), recipient: key(8), mint: key(40), creator: key(72),
    unlockAt: Number(d.readBigUInt64LE(144)),
    amount: (cliff + perPeriod * periods).toString(),
    claimed: d.readBigUInt64LE(184).toString(),
    strict: d[137] === 0 && d[138] === 0 && periods === 0n && d.readBigUInt64LE(200) === 0n,
  };
}

/** Jupiter Lock escrows for a wallet (as recipient) or for a token, newest unlock last. */
export async function listJupLocks(by: { recipient?: string; mint?: string }) {
  const filters: any[] = [{ dataSize: ESCROW_SIZE }, { memcmp: { offset: 0, bytes: ACCOUNT_ESCROW.toString("base64"), encoding: "base64" } }];
  if (by.recipient) filters.push({ memcmp: { offset: 8, bytes: new PublicKey(by.recipient).toBase58() } });
  if (by.mint) filters.push({ memcmp: { offset: 40, bytes: new PublicKey(by.mint).toBase58() } });
  const accs = await connection().getProgramAccounts(JUP_LOCK, { filters, commitment: "confirmed" });
  return accs.map((a) => decode(a.pubkey, a.account.data as Buffer)).filter((x): x is JupLock => !!x).sort((a, b) => a.unlockAt - b.unlockAt);
}

/** After the date: everything still in the escrow goes to the recipient's own wallet. */
export async function buildJupClaim(ownerAddr: string, escrowAddr: string) {
  const owner = new PublicKey(ownerAddr), escrow = new PublicKey(escrowAddr);
  const acc = await connection().getAccountInfo(escrow, "confirmed");
  if (!acc || !acc.owner.equals(JUP_LOCK)) throw new Error("That lock wasn't found.");
  const l = decode(escrow, acc.data as Buffer);
  if (!l) throw new Error("That lock wasn't found.");
  if (l.recipient !== owner.toBase58()) throw new Error("Only the wallet the lock belongs to can claim it.");
  if (l.unlockAt * 1000 > Date.now()) throw new Error(`Still locked until ${new Date(l.unlockAt * 1000).toLocaleDateString("en-GB")}.`);
  if (BigInt(l.claimed) >= BigInt(l.amount)) throw new Error("This lock has already been claimed.");
  const mint = new PublicKey(l.mint);
  const escrowToken = getAssociatedTokenAddressSync(mint, escrow, true);
  const ownerToken = getAssociatedTokenAddressSync(mint, owner);
  const ix = new TransactionInstruction({
    programId: JUP_LOCK,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: escrowToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ownerToken, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: JUP_LOCK, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([IX_CLAIM, u64(18446744073709551615n)]),
  });
  return {
    tx: await v0(owner, [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY }),
      createAssociatedTokenAccountIdempotentInstruction(owner, ownerToken, owner, mint),
      ix,
    ]),
  };
}
