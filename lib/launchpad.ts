import { defineChain, parseAbi, parseEther, type PublicClient } from "viem";

/** Matches AutistikLaunchpadV2 in contracts/AutistikLaunchpadV2.sol. */
export const LAUNCHPAD_ABI = parseAbi([
  "struct LaunchParams { string name; string symbol; uint256 supply; uint256 creatorBps; uint256 devBuyNative; uint256 buyTax; uint256 sellTax; address taxWallet; address[] whitelist; uint256 whitelistNative; uint8 lockOption; uint256 permitDeadline; uint256 maxFeeAccepted; uint256 deadline; }",
  "function launch(LaunchParams p, bytes permitSig) payable returns (address token)",
  "function launchFee() view returns (uint256)",
  "function minLiquidity() view returns (uint256)",
  "function maxWhitelistNative() view returns (uint256)",
  "function platformFee() view returns (uint256)",
  "function owner() view returns (address)",
  "function locker() view returns (address)",
  "function router() view returns (address)",
  "function stablecoin() view returns (address)",
  "function plans(uint256) view returns (uint256 price, uint256 duration)",
  "function launchOf(address) view returns (address creator, address pair, uint256 lockId, uint8 lockOption, bool released)",
  "function promote(address token, uint256 planId, uint256 maxPrice)",
  "function releaseLiquidity(address token)",
  "function syncPrices(uint256 launchFee, uint256 maxWhitelistNative)",
  "event Launched(address indexed token, address indexed pair, address indexed creator, uint256 creatorTokens, uint256 devBuyTokens, uint8 lockOption, uint256 lockId)",
  "event LiquidityAdded(address indexed token, uint256 tokens, uint256 native, uint256 lp)",
  "event Promoted(address indexed token, address indexed payer, uint256 indexed planId, uint256 price, uint256 duration)",
  "error NotOwner()", "error ZeroAddress()", "error InvalidName()", "error InvalidSymbol()", "error InvalidSupply()", "error InvalidLock()",
  "error CreatorShareTooHigh()", "error NotEnoughLiquidity()", "error FeeTooHigh()", "error TooLate()", "error NotEligible()", "error PermitExpired()",
  "error PermitUsed()", "error TooManyWhitelisted()", "error WhitelistTooBig()", "error NotLaunchedHere()", "error NotLocked()", "error AlreadyReleased()",
  "error UnknownPlan()", "error PriceTooHigh()", "error TransferFailed()", "error TaxTooHigh()",
]);

/** Every token launched on the Launch Pad (AutistikToken in contracts/AutistikLaunchpadV2.sol). */
export const LAUNCH_TOKEN_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pair() view returns (address)",
  "function buyTax() view returns (uint256)",
  "function sellTax() view returns (uint256)",
  "function platformFee() view returns (uint256)",
  "function taxWallet() view returns (address)",
  "function tradingOpen() view returns (bool)",
  "function openTime() view returns (uint256)",
  "function owedToTaxWallet() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function openTrading()",
  "function lowerTaxes(uint256 newBuy, uint256 newSell)",
  "function setTaxWallet(address wallet)",
  "function renounceOwnership()",
  "function claimTax()",
  "error NotOwner()", "error AlreadyOpen()", "error TaxTooHigh()", "error ZeroAddress()",
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

export type ChainKey = "bsc" | "ethereum" | "base" | "arbitrum" | "robinhood";

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
  /** The chain's V2 DEX router and the stablecoin promotions are paid in (used when the team deploys the launchpad). */
  router?: `0x${string}`;
  stablecoin?: `0x${string}`;
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
    router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    stablecoin: "0x55d398326f99059fF775485246999027B3197955",
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
    router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    stablecoin: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    suggestedLiquidity: "0.5",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${t}`,
  },
  base: {
    key: "base",
    name: "Base",
    dex: "Uniswap",
    coin: "ETH",
    chainId: 8453,
    rpc: process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org",
    explorer: "https://basescan.org",
    dexscreener: "base",
    router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    stablecoin: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    suggestedLiquidity: "0.2",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=base&outputCurrency=${t}`,
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum",
    dex: "Uniswap",
    coin: "ETH",
    chainId: 42161,
    rpc: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    dexscreener: "arbitrum",
    router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    stablecoin: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    suggestedLiquidity: "0.2",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=arbitrum&outputCurrency=${t}`,
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
    router: addr(process.env.NEXT_PUBLIC_ROBINHOOD_ROUTER),
    stablecoin: addr(process.env.NEXT_PUBLIC_ROBINHOOD_STABLECOIN),
    suggestedLiquidity: "0.5",
    swapUrl: (t) => (process.env.NEXT_PUBLIC_ROBINHOOD_SWAP_URL || "").replace("{token}", t),
  },
};

/** Where the launchpad is deployed on each chain (saved by the team's deploy, read from the database). */
export type Pads = Partial<Record<ChainKey, `0x${string}`>>;

/** Reads the launch contribution, minimum liquidity and whitelist limit straight from the contract. */
export async function readLimits(client: PublicClient, pad: `0x${string}`) {
  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const read = (functionName: "launchFee" | "minLiquidity" | "maxWhitelistNative" | "platformFee") =>
    client.readContract({ address: pad, abi: LAUNCHPAD_ABI, functionName } as any) as Promise<bigint>;
  const [fee, minLiquidity, maxWhitelistNative, platformFee] = await Promise.all([read("launchFee"), read("minLiquidity"), read("maxWhitelistNative"), read("platformFee")]);
  return { fee, minLiquidity, maxWhitelistNative, platformFee };
}

export const isLive = (c: LaunchChain, pads: Pads) => !!(pads[c.key] && c.chainId && c.rpc && c.explorer);
export const liveChains = (pads: Pads) => Object.values(CHAINS).filter((c) => isLive(c, pads));
/** Chains the team can deploy the launchpad on (a known V2 router and stablecoin). */
export const deployable = (c: LaunchChain) => !!(c.router && c.stablecoin && c.chainId && c.rpc);

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
  /** Creator tax in percent (0–10) on buys and sells, paid to taxWallet. */
  buyTax: number;
  sellTax: number;
  taxWallet: string;
  /** Up to 3 wallets that may buy (about $40 each) before trading opens. */
  whitelist: string[];
  /** Coin for the creator's first buy at launch price (decimal string, "0" for none). */
  devBuy: string;
  description: string;
  website: string;
  x: string;
  telegram: string;
};

/** The creator's free share plus their first buy can be at most 30% of the supply. */
export const MAX_CREATOR_PERCENT = 30;
export const MAX_TAX_PERCENT = 10;

/** What happens to the pool's LP tokens. The number is the contract's lockOption. */
export type LiquidityLock = "burn" | "6m" | "1y";
export const LOCKS: Record<LiquidityLock, { option: number; label: string; short: string; explain: string }> = {
  burn: { option: 0, label: "Burn", short: "Burned forever", explain: "The LP tokens are sent to the dead address at launch. The liquidity stays in the pool forever and nobody can take it out, including you." },
  "6m": { option: 1, label: "Lock 6 months", short: "Locked 6 months", explain: "The LP tokens are locked in the AUTISTIK Locker for 6 months. Nobody can touch them before then, including you and the AUTISTIK team. After that, write to the AUTISTIK team and they release them to you (only ever to you)." },
  "1y": { option: 2, label: "Lock 1 year", short: "Locked 1 year", explain: "The LP tokens are locked in the AUTISTIK Locker for 1 year. Nobody can touch them before then, including you and the AUTISTIK team. After that, write to the AUTISTIK team and they release them to you (only ever to you)." },
};
export const isLock = (v: unknown): v is LiquidityLock => typeof v === "string" && v in LOCKS;

/** AI launch sessions (with Autistik) per member per day. The quick launch form has no limit and uses no AI. */
export const AI_LAUNCH_SESSIONS = 2;

/** Creators must hold at least this much AUTISTIK (in US dollars), on BNB Chain, in the wallet they launch from. */
export const MIN_HOLD_USD = Number(process.env.NEXT_PUBLIC_LAUNCH_MIN_HOLD_USD || 20);

/** Same limits as the contract, so problems show up before anyone opens their wallet. */
export function checkPlan(p: Partial<LaunchPlan> | null | undefined, pads: Pads): { plan: LaunchPlan } | { error: string } {
  if (!p) return { error: "No plan yet." };
  const chain = CHAINS[p.chain as ChainKey];
  if (!chain) return { error: "Pick one of the open chains." };
  if (!isLive(chain, pads)) return { error: `${chain.name} launches aren't open yet.` };
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
  const buyTax = Number(p.buyTax ?? 0), sellTax = Number(p.sellTax ?? 0);
  if (!(buyTax >= 0 && buyTax <= MAX_TAX_PERCENT) || !(sellTax >= 0 && sellTax <= MAX_TAX_PERCENT)) return { error: `Tax can be 0–${MAX_TAX_PERCENT}% on buys and on sells.` };
  const taxWallet = String(p.taxWallet || "").trim();
  if ((buyTax > 0 || sellTax > 0) && !/^0x[0-9a-fA-F]{40}$/.test(taxWallet)) return { error: "Add the wallet that should receive the tax (0x…)." };
  const whitelist = [...new Set((Array.isArray(p.whitelist) ? p.whitelist : []).map((w) => String(w).trim()).filter(Boolean))];
  if (whitelist.length > 3) return { error: "You can whitelist at most 3 wallets." };
  if (whitelist.some((w) => !/^0x[0-9a-fA-F]{40}$/.test(w))) return { error: "Each whitelisted wallet must be a 0x… address." };
  const devBuy = String(p.devBuy || "0").trim() || "0";
  let devWei = 0n;
  try { devWei = parseEther(devBuy); } catch { return { error: `Your first buy must be an amount of ${chain.coin}, or 0.` }; }
  if (devWei < 0n) return { error: `Your first buy must be an amount of ${chain.coin}, or 0.` };
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
      buyTax: Math.round(buyTax * 100) / 100,
      sellTax: Math.round(sellTax * 100) / 100,
      taxWallet: buyTax > 0 || sellTax > 0 ? taxWallet : "",
      whitelist,
      devBuy,
      description: String(p.description || "").trim().slice(0, 500),
      website: link(p.website),
      x: link(p.x),
      telegram: link(p.telegram),
    },
  };
}
