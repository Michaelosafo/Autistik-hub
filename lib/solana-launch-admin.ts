/**
 * Admin-specific Solana helpers used by the Rage API route.
 * These wrap the core solana-launch functions so pasting any CA works.
 */
import { PublicKey } from "@solana/web3.js";
import { connection, findPool, readMetadata } from "@/lib/solana-launch";
import {
  TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getTokenMetadata, getTransferFeeConfig, unpackMint,
  createAssociatedTokenAccountIdempotentInstruction, createWithdrawWithheldTokensFromAccountsInstruction,
  createWithdrawWithheldTokensFromMintInstruction, getAssociatedTokenAddressSync, getTransferFeeAmount, unpackAccount,
} from "@solana/spl-token";
import { ComputeBudgetProgram, TransactionInstruction } from "@solana/web3.js";
import { Raydium, TxVersion, Percent } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

export async function readAdminToken(owner: string | null, mintAddr: string, poolId?: string) {
  const mint = new PublicKey(mintAddr);
  const conn = connection();
  const acc = await conn.getAccountInfo(mint);
  if (!acc) throw new Error("That token wasn't found on Solana.");
  const program = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const meta = await readMetadata(mint);
  const parsed = await conn.getParsedAccountInfo(mint).catch(() => null);
  const info: any = (parsed?.value?.data as any)?.parsed?.info;
  const decimals = Number(info?.decimals ?? 6);
  const pool = await findPool(mintAddr, poolId);
  let tokenBal = "0", solBal = "0", feeBps: number | null = null;
  if (owner) {
    try {
      const ata = await conn.getTokenAccountsByOwner(new PublicKey(owner), { mint });
      if (ata.value[0]) {
        const bal = await conn.getTokenAccountBalance(ata.value[0].pubkey);
        tokenBal = bal.value.amount;
      }
      const sol = await conn.getBalance(new PublicKey(owner));
      solBal = String(sol);
    } catch { /* ignore */ }
  }
  if (program.equals(TOKEN_2022_PROGRAM_ID)) {
    try {
      const mintInfo = unpackMint(mint, acc, TOKEN_2022_PROGRAM_ID);
      const cfg = getTransferFeeConfig(mintInfo);
      if (cfg) feeBps = Number(cfg.newerTransferFee.transferFeeBasisPoints);
    } catch { /* ignore */ }
  }
  return {
    symbol: meta?.symbol || info?.symbol || "",
    name: meta?.name || info?.name || "",
    decimals,
    tokenBal,
    solBal,
    feeBps,
    pool: pool ? {
      pool: pool.pool,
      lpMint: pool.lpMint,
      tokenReserve: pool.tokenReserve,
      solReserve: pool.solReserve,
      lpAmount: "0",
      lpDecimals: 9,
    } : null,
  };
}

export async function buildAdminMint(owner: string, plan: { name: string; symbol: string; supply: string; feeBps: number }) {
  const { buildMint } = await import("@/lib/solana-launch");
  if (plan.feeBps <= 0) {
    return buildMint(owner, { name: plan.name, symbol: plan.symbol, supply: plan.supply });
  }
  return buildMint(owner, { name: plan.name, symbol: plan.symbol, supply: plan.supply, forceFeeBps: plan.feeBps });
}

export async function buildAdminWithdraw(owner: string, poolId: string, pct: number) {
  if (pct <= 0 || pct > 100) throw new Error("Percentage must be between 1 and 100.");
  const r = await Raydium.load({
    connection: connection(),
    owner: new PublicKey(owner),
    cluster: "mainnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
  await r.account.fetchWalletTokenAccounts();
  const { poolInfo, poolKeys } = await r.cpmm.getPoolInfoFromRpc(poolId);
  const lpMint = poolInfo.lpMint.address;
  const lpAta = getAssociatedTokenAddressSync(new PublicKey(lpMint), new PublicKey(owner));
  const bal = await connection().getTokenAccountBalance(lpAta).catch(() => null);
  const totalLp = BigInt(bal?.value.amount || "0");
  if (totalLp === 0n) throw new Error("No LP tokens in this wallet for that pool.");
  const removeAmount = (totalLp * BigInt(pct)) / 100n;
  if (removeAmount === 0n) throw new Error("Amount too small.");
  const { transaction } = await r.cpmm.removeLiquidity({
    poolInfo,
    poolKeys,
    lpAmount: new BN(removeAmount.toString()),
    slippage: new Percent(5, 100),
    computeBudgetConfig: { units: 300_000, microLamports: 100_000 },
    txVersion: TxVersion.V0,
  });
  return { tx: Buffer.from(transaction.serialize()).toString("base64") };
}

export async function buildAdminCollect(owner: string, mint: string) {
  const authority = new PublicKey(owner);
  const mintPk = new PublicKey(mint);
  const conn = connection();
  const acc = await conn.getAccountInfo(mintPk);
  if (!acc || !acc.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error("Not a Token-2022 mint with a transfer fee.");
  const cfg = getTransferFeeConfig(unpackMint(mintPk, acc, TOKEN_2022_PROGRAM_ID));
  if (!cfg || !cfg.withdrawWithheldAuthority.equals(authority)) throw new Error("This wallet is not the fee authority.");
  const holders = await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, { filters: [{ memcmp: { offset: 0, bytes: mint } }] }).catch(() => []);
  const sources: PublicKey[] = [];
  let total = cfg.withheldAmount;
  for (const h of holders) {
    try {
      const w = getTransferFeeAmount(unpackAccount(h.pubkey, h.account, TOKEN_2022_PROGRAM_ID))?.withheldAmount ?? 0n;
      if (w > 0n) { sources.push(h.pubkey); total += w; }
    } catch { /* skip */ }
  }
  if (total === 0n) return { txs: [], amount: "0" };
  const dest = getAssociatedTokenAddressSync(mintPk, authority, false, TOKEN_2022_PROGRAM_ID);
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    createAssociatedTokenAccountIdempotentInstruction(authority, dest, authority, mintPk, TOKEN_2022_PROGRAM_ID),
  ];
  if (cfg.withheldAmount > 0n) {
    ixs.push(createWithdrawWithheldTokensFromMintInstruction(mintPk, dest, authority, [], TOKEN_2022_PROGRAM_ID));
  }
  if (sources.length) {
    ixs.push(createWithdrawWithheldTokensFromAccountsInstruction(mintPk, dest, authority, [], sources, TOKEN_2022_PROGRAM_ID));
  }
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const tx = new (await import("@solana/web3.js")).VersionedTransaction(
    new (await import("@solana/web3.js")).TransactionMessage({ payerKey: authority, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message()
  );
  return { txs: [Buffer.from(tx.serialize()).toString("base64")], amount: total.toString() };
}
