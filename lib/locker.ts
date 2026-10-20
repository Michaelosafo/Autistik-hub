/**
 * AUTISTIK Locker (contracts/AutistikLocker.sol): lock liquidity or tokens until a date. Safe to use in the browser.
 * Where the locker lives on each chain is saved in the database (locker_contracts) when the admin deploys it.
 */
import { fallback, http, parseAbi } from "viem";
import { arbitrum, avalanche, base, berachain, blast, bsc, linea, mainnet, monad, optimism, polygon, robinhood, sonic, unichain } from "viem/chains";

export const LOCKER_ABI = parseAbi([
  "struct Lock { uint256 id; address token; address owner; uint256 amount; uint256 lockDate; uint256 tgeDate; uint256 tgeBps; uint256 cycle; uint256 cycleBps; uint256 unlockedAmount; bool isLpToken; string description; }",
  "function lock(address owner, address token, bool isLpToken, uint256 amount, uint256 unlockDate, string description) returns (uint256 id)",
  "function vestingLock(address owner, address token, bool isLpToken, uint256 amount, uint256 tgeDate, uint256 tgeBps, uint256 cycle, uint256 cycleBps, string description) returns (uint256 id)",
  "function editLock(uint256 lockId, uint256 newAmount, uint256 newUnlockDate)",
  "function unlock(uint256 lockId)",
  "function transferLockOwnership(uint256 lockId, address newOwner)",
  "function renounceLockOwnership(uint256 lockId)",
  "function withdrawableTokens(uint256 lockId) view returns (uint256)",
  "function getTotalLockCount() view returns (uint256)",
  "function getLockById(uint256 lockId) view returns (Lock)",
  "function getLocks(uint256 start, uint256 end) view returns (Lock[])",
  "function lockIdsForToken(address token) view returns (uint256[])",
  "function lockIdsForUser(address user) view returns (uint256[])",
  "function totalLockedForToken(address token) view returns (uint256)",
  "function isPair(address token) view returns (bool)",
  "event LockAdded(uint256 indexed id, address token, address owner, uint256 amount, uint256 unlockDate)",
  "error InvalidOwner()", "error InvalidAmount()", "error InvalidDate()", "error InvalidVesting()", "error NotLpToken()", "error IsLpToken()",
  "error DescriptionTooLong()", "error NotLockOwner()", "error UnknownLock()", "error StillLocked()", "error NothingToUnlock()", "error IsVestingLock()", "error AlreadyUnlocked()",
]);

export const TOKEN_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

/** Chains the locker can go on (same keys as Analytics, so token pages link up). zkSync-style chains need a different build. */
export const LOCKER_CHAINS = {
  bsc: { name: "BNB Chain", viem: bsc, rpc: process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com" },
  ethereum: { name: "Ethereum", viem: mainnet, rpc: process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io" },
  base: { name: "Base", viem: base, rpc: "https://mainnet.base.org", explorer: "https://basescan.org" },
  robinhood: { name: "Robinhood Chain", viem: robinhood, rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: robinhood.blockExplorers.default.url },
  arbitrum: { name: "Arbitrum", viem: arbitrum, rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io" },
  polygon: { name: "Polygon", viem: polygon, rpc: "https://polygon-bor-rpc.publicnode.com", explorer: "https://polygonscan.com" },
  avalanche: { name: "Avalanche", viem: avalanche, rpc: "https://avalanche-c-chain-rpc.publicnode.com", explorer: "https://snowtrace.io" },
  optimism: { name: "Optimism", viem: optimism, rpc: "https://mainnet.optimism.io", explorer: "https://optimistic.etherscan.io" },
  sonic: { name: "Sonic", viem: sonic, rpc: "https://sonic-rpc.publicnode.com", explorer: sonic.blockExplorers.default.url },
  berachain: { name: "Berachain", viem: berachain, rpc: "https://berachain-rpc.publicnode.com", explorer: berachain.blockExplorers.default.url },
  monad: { name: "Monad", viem: monad, rpc: monad.rpcUrls.default.http[0], explorer: monad.blockExplorers?.default.url || "" },
  unichain: { name: "Unichain", viem: unichain, rpc: "https://mainnet.unichain.org", explorer: unichain.blockExplorers.default.url },
  linea: { name: "Linea", viem: linea, rpc: "https://rpc.linea.build", explorer: "https://lineascan.build" },
  blast: { name: "Blast", viem: blast, rpc: "https://blast-rpc.publicnode.com", explorer: blast.blockExplorers.default.url },
} as const;
export type LockerChain = keyof typeof LOCKER_CHAINS;

// Backup nodes, so one busy or blocked node doesn't break locking.
const MORE_RPCS: Partial<Record<LockerChain, string[]>> = {
  bsc: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed1.defibit.io", "https://bsc-dataseed1.ninicoin.io"],
  ethereum: ["https://eth.llamarpc.com"],
  base: ["https://base-rpc.publicnode.com"],
  arbitrum: ["https://arbitrum-one-rpc.publicnode.com"],
};
/** Reads that try the chain's nodes one after another. */
export function lockerTransport(chain: LockerChain) {
  const c = LOCKER_CHAINS[chain];
  const urls = [...new Set([c.rpc, ...(MORE_RPCS[chain] || []), ...c.viem.rpcUrls.default.http])].filter(Boolean);
  return fallback(urls.map((u) => http(u, { timeout: 10_000 })));
}
export const isLockerChain = (c: unknown): c is LockerChain => typeof c === "string" && c in LOCKER_CHAINS;

/** A deployed locker, as the page passes it to the browser. */
export type LockerSite = { chain: LockerChain; address: `0x${string}`; verified: boolean };

/** Quick picks for how long to lock. */
export const LOCK_PRESETS = [
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
  { label: "6 months", days: 182 },
  { label: "1 year", days: 365 },
  { label: "2 years", days: 730 },
] as const;

/** Friendly words for the locker's error codes. */
export const LOCKER_ERRORS: Record<string, string> = {
  InvalidOwner: "Pick a valid owner wallet.",
  InvalidAmount: "Enter an amount above zero that you hold.",
  InvalidDate: "The unlock date must be in the future (and can only move later, never earlier).",
  InvalidVesting: "The release steps don't add up. Each step and the first release together can't be more than 100%.",
  NotLpToken: "That isn't a liquidity (LP) token. Choose \"Token\" instead.",
  IsLpToken: "That's a liquidity (LP) token. Choose \"Liquidity\" instead.",
  DescriptionTooLong: "The note can be at most 200 characters.",
  NotLockOwner: "Only the lock's owner can do that.",
  UnknownLock: "That lock doesn't exist.",
  StillLocked: "It's still locked. You can unlock it after the unlock date.",
  NothingToUnlock: "Nothing to unlock right now.",
  IsVestingLock: "Step-by-step locks can't be changed.",
  AlreadyUnlocked: "This lock has already been unlocked.",
};

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "in 3 months", "in 12 days", "unlocked". */
export function untilText(unix: number, now = Date.now() / 1000) {
  const s = unix - now;
  if (s <= 0) return "unlockable now";
  const d = s / 86400;
  if (d >= 730) return `in ${Math.floor(d / 365)} years`;
  if (d >= 60) return `in ${Math.floor(d / 30.4)} months`;
  if (d >= 2) return `in ${Math.floor(d)} days`;
  if (s >= 7200) return `in ${Math.floor(s / 3600)} hours`;
  return `in ${Math.max(1, Math.floor(s / 60))} minutes`;
}
