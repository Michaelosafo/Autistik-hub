import { defineChain, parseAbi, parseEther, type PublicClient } from "viem";

/** Matches contracts/AutistikLaunchpad.sol. */
export const LAUNCHPAD_ABI = parseAbi([
  "function launch(string name_, string symbol_, uint256 supply, uint256 creatorBps, uint8 lockOption, uint256 permitDeadline, bytes permitSig) payable returns (address token, address pair)",
  "function unlockLiquidity(address token)",
  "function locks(address) view returns (address pair, address creator, uint256 amount, uint256 unlockAt)",
  "function eligibilitySigner() view returns (address)",
  "function launchFee() view returns (uint256)",
  "function minLiquidity() view returns (uint256)",
  "function stablecoin() view returns (address)",
  "function plans(uint256) view returns (uint256 price, uint256 duration)",
  "function promote(address token, uint256 planId)",
  "event Launched(address indexed token, address indexed pair, address indexed creator, uint256 supply, uint256 creatorTokens, uint256 liquidityTokens, uint256 liquidityNative, uint256 lp)",
  "event LiquidityLocked(address indexed token, address indexed pair, address indexed creator, uint256 amount, uint256 unlockAt)",
  "event LiquidityUnlocked(address indexed token, address indexed creator, uint256 amount)",
  "error InvalidLock()",
  "error NotEligible()",
  "error PermitExpired()",
  "error NotCreator()",
  "error StillLocked()",
  "error NothingLocked()",
  "error InvalidName()",
  "error InvalidSymbol()",
  "error InvalidSupply()",
  "error CreatorShareTooHigh()",
  "error NotEnoughLiquidity()",
  "event Promoted(address indexed token, address indexed payer, uint256 indexed planId, uint256 price, uint256 duration)",
  "error FeeTransferFailed()",
  "error NotLaunchedHere()",
  "error UnknownPlan()",
]);

/** Enough of ERC-20 to pay for a promotion in USDT/USDC. */
export const STABLE_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

/** Trending plans the contract starts with (plan id → label). Prices are read from the contract. */
export const PLANS = [
  { id: 0, label: "5 hours" },
  { id: 1, label: "24 hours" },
] as const;

export const ERC20_META_ABI = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)"]);

export type ChainKey = "bsc" | "ethereum" | "robinhood";

export type LaunchChain = {
  key: ChainKey;
  name: string;
  dex: string;
  coin: string;
  chainId: number;
  rpc: string;
  explorer: string;
  /** Path segment DexScreener uses for this chain, e.g. dexscreener.com/bsc/<pair>. */
  dexscreener: string;
  launchpad?: `0x${string}`;
  /** Suggested liquidity, shown to creators and Autistik. The contract enforces its own minimum. */
  suggestedLiquidity: string;
  swapUrl: (token: string) => string;
};

const addr = (v: string | undefined) => (v && /^0x[0-9a-fA-F]{40}$/.test(v.trim()) ? (v.trim() as `0x${string}`) : undefined);

// NEXT_PUBLIC_ values are written out in full so Next.js can put them into the browser bundle.
export const CHAINS: Record<ChainKey, LaunchChain> = {
  bsc: {
    key: "bsc",
    name: "BNB Chain",
    dex: "PancakeSwap",
    coin: "BNB",
    chainId: 56,
    rpc: process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.bnbchain.org",
    explorer: "https://bscscan.com",
    dexscreener: "bsc",
    launchpad: addr(process.env.NEXT_PUBLIC_LAUNCHPAD_BSC),
    suggestedLiquidity: "0.5",
    swapUrl: (t) => `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${t}`,
  },
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    dex: "Uniswap",
    coin: "ETH",
    chainId: 1,
    rpc: process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com",
    explorer: "https://etherscan.io",
    dexscreener: "ethereum",
    launchpad: addr(process.env.NEXT_PUBLIC_LAUNCHPAD_ETHEREUM),
    suggestedLiquidity: "0.5",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${t}`,
  },
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    dex: process.env.NEXT_PUBLIC_ROBINHOOD_DEX_NAME || "Robinhood Chain DEX",
    coin: "ETH",
    chainId: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID || 0),
    rpc: process.env.NEXT_PUBLIC_ROBINHOOD_RPC || "",
    explorer: (process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER || "").replace(/\/+$/, ""),
    dexscreener: process.env.NEXT_PUBLIC_ROBINHOOD_DEXSCREENER_SLUG || "",
    launchpad: addr(process.env.NEXT_PUBLIC_LAUNCHPAD_ROBINHOOD),
    suggestedLiquidity: "0.5",
    swapUrl: (t) => (process.env.NEXT_PUBLIC_ROBINHOOD_SWAP_URL || "").replace("{token}", t),
  },
};

/** Reads the launch fee and minimum liquidity straight from the contract. */
export async function readLimits(client: PublicClient, c: LaunchChain) {
  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const read = (functionName: "launchFee" | "minLiquidity") =>
    client.readContract({ address: c.launchpad!, abi: LAUNCHPAD_ABI, functionName } as any) as Promise<bigint>;
  const [fee, minLiquidity] = await Promise.all([read("launchFee"), read("minLiquidity")]);
  return { fee, minLiquidity };
}

export const isLive = (c: LaunchChain) => !!(c.launchpad && c.chainId && c.rpc && c.explorer);
export const liveChains = () => Object.values(CHAINS).filter(isLive);

export function viemChain(c: LaunchChain) {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: { name: c.coin, symbol: c.coin, decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } },
    blockExplorers: { default: { name: "Explorer", url: c.explorer } },
  });
}

export function dexscreenerUrl(c: LaunchChain, pair: string, token: string) {
  return c.dexscreener ? `https://dexscreener.com/${c.dexscreener}/${pair}` : `https://dexscreener.com/search?q=${token}`;
}

export type LaunchPlan = {
  chain: ChainKey;
  name: string;
  symbol: string;
  /** Whole tokens, digits only. */
  supply: string;
  /** 0–20 */
  creatorPercent: number;
  /** Native coin (BNB/ETH) to put in the pool, decimal string. */
  liquidity: string;
  /** Burn the LP tokens, or lock them for 6 months or 1 year. */
  lock: LiquidityLock;
  description: string;
  website: string;
  x: string;
  telegram: string;
};

export const MAX_CREATOR_PERCENT = 20;

/** What happens to the pool's LP tokens. The number is the contract's lockOption. */
export type LiquidityLock = "burn" | "6m" | "1y";
export const LOCKS: Record<LiquidityLock, { option: number; label: string; short: string; explain: string }> = {
  burn: { option: 0, label: "Burn", short: "Burned forever", explain: "The LP tokens are sent to the dead address at launch. The liquidity stays in the pool forever and nobody can take it out, including you." },
  "6m": { option: 1, label: "Lock 6 months", short: "Locked 6 months", explain: "The LP tokens are locked in the Launch Pad contract for 6 months. After that only you can take them back. Nobody can touch them before then, including you and the AUTISTIK team." },
  "1y": { option: 2, label: "Lock 1 year", short: "Locked 1 year", explain: "The LP tokens are locked in the Launch Pad contract for 1 year. After that only you can take them back. Nobody can touch them before then, including you and the AUTISTIK team." },
};
export const isLock = (v: unknown): v is LiquidityLock => typeof v === "string" && v in LOCKS;

/** AI launch sessions (with Autistik) per member per day. The quick launch form has no limit and uses no AI. */
export const AI_LAUNCH_SESSIONS = 2;

/** Creators must hold at least this much AUTISTIK (in US dollars), on BNB Chain, in the wallet they launch from. */
export const MIN_HOLD_USD = Number(process.env.NEXT_PUBLIC_LAUNCH_MIN_HOLD_USD || 20);

/** Same limits as the contract, so problems show up before anyone opens their wallet. */
export function checkPlan(p: Partial<LaunchPlan> | null | undefined): { plan: LaunchPlan } | { error: string } {
  if (!p) return { error: "No plan yet." };
  const chain = CHAINS[p.chain as ChainKey];
  if (!chain) return { error: "Pick BNB Chain, Ethereum or Robinhood Chain." };
  if (!isLive(chain)) return { error: `${chain.name} launches aren't open yet.` };
  const name = String(p.name || "").trim();
  const symbol = String(p.symbol || "").trim().replace(/^\$/, "").toUpperCase();
  if (!name || new TextEncoder().encode(name).length > 32) return { error: "The name must be 1–32 characters." };
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) return { error: "The ticker must be 1–12 letters or numbers." };
  const supply = String(p.supply || "").replace(/[,_\s]/g, "");
  if (!/^\d+$/.test(supply) || BigInt(supply) < 1000n || BigInt(supply) > 10n ** 15n) return { error: "Total supply must be a whole number from 1,000 to 1,000,000,000,000,000." };
  const creatorPercent = Number(p.creatorPercent ?? 0);
  if (!(creatorPercent >= 0 && creatorPercent <= MAX_CREATOR_PERCENT)) return { error: `Your share can be 0–${MAX_CREATOR_PERCENT}% of the supply.` };
  const liquidity = String(p.liquidity || "").trim();
  let wei = 0n;
  try { wei = parseEther(liquidity); } catch {}
  if (wei <= 0n) return { error: `Liquidity must be an amount of ${chain.coin}, like ${chain.suggestedLiquidity}.` };
  if (!isLock(p.lock)) return { error: "Choose what happens to the liquidity: lock 6 months, lock 1 year, or burn." };
  const link = (v: unknown) => {
    const s = String(v || "").trim();
    return /^https:\/\/[^\s"'<>]{3,200}$/.test(s) ? s : "";
  };
  return {
    plan: {
      chain: chain.key,
      name,
      symbol,
      supply,
      creatorPercent: Math.round(creatorPercent * 100) / 100,
      liquidity,
      lock: p.lock,
      description: String(p.description || "").trim().slice(0, 500),
      website: link(p.website),
      x: link(p.x),
      telegram: link(p.telegram),
    },
  };
}
