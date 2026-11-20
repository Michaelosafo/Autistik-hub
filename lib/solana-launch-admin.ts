/**
 * Admin-specific Solana helpers used by the Rage API route.
 * These wrap the core solana-launch functions so pasting any CA works.
 */
import { PublicKey } from "@solana/web3.js";
import { connection, findPool, readMetadata } from "@/lib/solana-launch";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getTokenMetadata } from "@solana/spl-token";

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
      const tm = await getTokenMetadata(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
      if (tm) feeBps = 0; // placeholder; real fee would come from transfer fee config
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
  return buildMint(owner, { name: plan.name, symbol: plan.symbol, supply: plan.supply, buyTax: plan.feeBps / 100 });
}

export async function buildAdminWithdraw(owner: string, poolId: string, pct: number) {
  // Placeholder – full withdraw logic lives in the main solana-launch module
  throw new Error("Withdraw not yet wired. Use the pool tools directly for now.");
}

export async function buildAdminCollect(owner: string, mint: string) {
  throw new Error("Collect not yet wired. Use the pool tools directly for now.");
}
