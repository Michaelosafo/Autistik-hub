/** Explorer links for any supported chain. Solscan (Solana) has its own address format; the others are Etherscan-style. */
export const isSolscan = (explorer: string) => explorer.includes("solscan.io");
export const walletUrl = (explorer: string, token: string, wallet: string) =>
  isSolscan(explorer) ? `${explorer}/account/${wallet}` : `${explorer}/token/${token}?a=${wallet}`;
export const tokenUrl = (explorer: string, token: string) => `${explorer}/token/${token}`;
export const txUrl = (explorer: string, hash: string) => `${explorer}/tx/${hash}`;
