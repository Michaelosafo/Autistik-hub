import { parseAbi } from "viem";

/**
 * Token drops in live rooms: the host sends coins to listeners who connected a wallet in the room. Sent in one
 * transaction per batch through Disperse (disperse.app, an open, widely used contract at the same address on these
 * networks; checked on-chain). Listeners' addresses are never shown in the room.
 */
export const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150" as const;
export const DROP_CHAINS = ["bsc", "ethereum", "base", "arbitrum", "polygon"] as const;
export type DropChain = (typeof DROP_CHAINS)[number];
export const isDropChain = (c: unknown): c is DropChain => typeof c === "string" && (DROP_CHAINS as readonly string[]).includes(c);
export const DISPERSE_ABI = parseAbi([
  "function disperseEther(address[] recipients, uint256[] values) payable",
  "function disperseToken(address token, address[] recipients, uint256[] values)",
]);
export const ERC20_DROP_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
/** Most wallets per transaction (keeps each one well under block gas limits). */
export const DROP_BATCH = 150;
