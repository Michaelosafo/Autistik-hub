import { defineChain, parseAbi, parseEther, type PublicClient } from "viem";

/** Matches AutistikLaunchpadV2 in contracts/AutistikLaunchpadV2.sol (most calls are the same on v3). */
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
  "function eligibilitySigner() view returns (address)",
  "function setEligibilitySigner(address signer)",
  "event Launched(address indexed token, address indexed pair, address indexed creator, uint256 creatorTokens, uint256 devBuyTokens, uint8 lockOption, uint256 lockId)",
  "event LiquidityAdded(address indexed token, uint256 tokens, uint256 native, uint256 lp)",
  "event Promoted(address indexed token, address indexed payer, uint256 indexed planId, uint256 price, uint256 duration)",
  "error NotOwner()", "error ZeroAddress()", "error InvalidName()", "error InvalidSymbol()", "error InvalidSupply()", "error InvalidLock()",
  "error CreatorShareTooHigh()", "error NotEnoughLiquidity()", "error FeeTooHigh()", "error TooLate()", "error NotEligible()", "error PermitExpired()",
  "error PermitUsed()", "error TooManyWhitelisted()", "error WhitelistTooBig()", "error NotLaunchedHere()", "error NotLocked()", "error AlreadyReleased()",
  "error UnknownPlan()", "error PriceTooHigh()", "error TransferFailed()", "error TaxTooHigh()",
]);

/**
 * Launch Pad v3 (contracts/AutistikLaunchpadV3.sol): the same as v2, except launch() takes a salt that picks the token's
 * address (every address ends in "aaaaa") and the permit covers that salt. Everything else uses LAUNCHPAD_ABI.
 */
export const LAUNCHPAD_V3_ABI = parseAbi([
  "struct LaunchParams { string name; string symbol; uint256 supply; uint256 creatorBps; uint256 devBuyNative; uint256 buyTax; uint256 sellTax; address taxWallet; address[] whitelist; uint256 whitelistNative; uint8 lockOption; uint256 permitDeadline; uint256 maxFeeAccepted; uint256 deadline; bytes32 salt; }",
  "function launch(LaunchParams p, bytes permitSig) payable returns (address token)",
  "function tokenFor(bytes32 salt) view returns (address)",
  "function deployer() view returns (address)",
  "event Launched(address indexed token, address indexed pair, address indexed creator, uint256 creatorTokens, uint256 devBuyTokens, uint8 lockOption, uint256 lockId)",
  "error NotOwner()", "error ZeroAddress()", "error InvalidName()", "error InvalidSymbol()", "error InvalidSupply()", "error InvalidLock()",
  "error CreatorShareTooHigh()", "error NotEnoughLiquidity()", "error FeeTooHigh()", "error TooLate()", "error NotEligible()", "error PermitExpired()",
  "error PermitUsed()", "error TooManyWhitelisted()", "error WhitelistTooBig()", "error TransferFailed()", "error TaxTooHigh()",
]);

/**
 * Launch Pad v4 (contracts/AutistikLaunchpadV4.sol): v3 plus optional holder rewards. The creator picks a reward token
 * (the chain's coin, or BTC/ETH/another token the team allowed) and how much of their tax goes to holders.
 */
export const LAUNCHPAD_V4_ABI = parseAbi([
  "struct LaunchParams { string name; string symbol; uint256 supply; uint256 creatorBps; uint256 devBuyNative; uint256 buyTax; uint256 sellTax; address taxWallet; address[] whitelist; uint256 whitelistNative; uint8 lockOption; address rewardToken; uint256 holderBps; uint256 permitDeadline; uint256 maxFeeAccepted; uint256 deadline; bytes32 salt; }",
  "function launch(LaunchParams p, bytes permitSig) payable returns (address token)",
  "function tokenFor(bytes32 salt) view returns (address)",
  "function rewardAllowed(address token) view returns (bool)",
  "function setRewardToken(address token, bool allowed)",
  "event Launched(address indexed token, address indexed pair, address indexed creator, uint256 creatorTokens, uint256 devBuyTokens, uint8 lockOption, uint256 lockId)",
  "error NotOwner()", "error ZeroAddress()", "error InvalidName()", "error InvalidSymbol()", "error InvalidSupply()", "error InvalidLock()",
  "error CreatorShareTooHigh()", "error NotEnoughLiquidity()", "error FeeTooHigh()", "error TooLate()", "error NotEligible()", "error PermitExpired()",
  "error PermitUsed()", "error TooManyWhitelisted()", "error WhitelistTooBig()", "error TransferFailed()", "error TaxTooHigh()", "error RewardNotAllowed()",
]);

/** The address v4 uses for "the chain's own coin" as the holders' reward. */
export const NATIVE_REWARD = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

/** Holder-reward tokens creators can pick on each chain (the pad allows them at deploy). The chain's coin is always there. */
export const REWARD_TOKENS: Partial<Record<ChainKey, { symbol: string; name: string; address: `0x${string}`; decimals: number }[]>> = {
  bsc: [
    { symbol: "BTC", name: "Bitcoin (BTCB)", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
    { symbol: "ETH", name: "Ethereum (Binance-Peg ETH)", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
  ],
  ethereum: [{ symbol: "BTC", name: "Bitcoin (WBTC)", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 }],
};

/** What a creator can pick as the holders' reward on a chain: none, the coin, the listed tokens, or another allowed token. */
export function rewardChoices(c: LaunchChain) {
  return [{ key: "native", symbol: c.coin, name: `${c.coin} (the chain's coin)` }, ...(REWARD_TOKENS[c.key] ?? []).map((t) => ({ key: t.address, symbol: t.symbol, name: t.name }))];
}

/**
 * Solana holder rewards: what the AUTISTIK rewards wallet buys with the holders' part of a coin's fee and sends to its
 * holders (lib/solana-rewards.ts). Keys are what plans store.
 */
export const SOL_REWARD_TOKENS: Record<string, { symbol: string; name: string; mint: string; decimals: number }> = {
  sol: { symbol: "SOL", name: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
  btc: { symbol: "BTC", name: "Bitcoin (cbBTC)", mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", decimals: 8 },
  eth: { symbol: "ETH", name: "Ethereum (Wormhole ETH)", mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", decimals: 8 },
};

/** Holder rewards on a launched v4 token. */
export const REWARD_TOKEN_ABI = parseAbi([
  "function rewardToken() view returns (address)",
  "function holderBps() view returns (uint256)",
  "function withdrawableRewards(address) view returns (uint256)",
  "function totalRewardsEarned(address) view returns (uint256)",
  "function totalRewardsDistributed() view returns (uint256)",
  "function rewardHolders() view returns (uint256)",
  "function excludedFromRewards(address) view returns (bool)",
  "function claimRewards()",
]);

/** The ending every Launch Pad v3 token address has (BNB Chain, Ethereum, Robinhood Chain…), shown in capitals ("AAAAA"). */
export const EVM_VANITY_SUFFIX = "aaaaa";

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

export type ChainKey = "bsc" | "ethereum" | "base" | "arbitrum" | "polygon" | "avalanche" | "optimism" | "robinhood" | "solana";

export type LaunchChain = {
  key: ChainKey;
  /** EVM chains launch through the AUTISTIK Launch Pad contract; Solana creates an SPL token and a Raydium pool. */
  kind?: "evm" | "solana";
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
  /** Example amount shown as a hint only: creators put in any amount. The contract enforces its own small minimum (about $25 + $3). */
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
    suggestedLiquidity: "0.1",
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
    suggestedLiquidity: "0.1",
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
    suggestedLiquidity: "0.05",
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
    suggestedLiquidity: "0.05",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=arbitrum&outputCurrency=${t}`,
  },
  polygon: {
    key: "polygon",
    name: "Polygon",
    dex: "Uniswap",
    coin: "POL",
    chainId: 137,
    rpc: process.env.NEXT_PUBLIC_POLYGON_RPC || "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    dexscreener: "polygon",
    router: "0xedf6066a2b290C185783862C7F4776A2C8077AD1",
    stablecoin: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    suggestedLiquidity: "100",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=polygon&outputCurrency=${t}`,
  },
  avalanche: {
    key: "avalanche",
    name: "Avalanche",
    dex: "Uniswap",
    coin: "AVAX",
    chainId: 43114,
    rpc: process.env.NEXT_PUBLIC_AVALANCHE_RPC || "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
    dexscreener: "avalanche",
    router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
    stablecoin: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    suggestedLiquidity: "3",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=avalanche&outputCurrency=${t}`,
  },
  optimism: {
    key: "optimism",
    name: "Optimism",
    dex: "Uniswap",
    coin: "ETH",
    chainId: 10,
    rpc: process.env.NEXT_PUBLIC_OPTIMISM_RPC || "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io",
    dexscreener: "optimism",
    router: "0x4A7b5Da61326A6379179b40d00F57E5bbDC962c2",
    stablecoin: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    suggestedLiquidity: "0.05",
    swapUrl: (t) => `https://app.uniswap.org/swap?chain=optimism&outputCurrency=${t}`,
  },
  robinhood: {
    key: "robinhood",
    name: "Robinhood Chain",
    dex: process.env.NEXT_PUBLIC_ROBINHOOD_DEX_NAME || "Uniswap V2",
    coin: "ETH",
    // Robinhood Chain mainnet (an Arbitrum chain). Uniswap V2 router from Uniswap's deployments list (factory
    // 0x8BCe…937f, WETH 0x0bd7…aD73). Stablecoin: Paxos USDG (6 decimals), which has a deep USDG/WETH pool there.
    chainId: Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID || 4663),
    rpc: process.env.NEXT_PUBLIC_ROBINHOOD_RPC || "https://rpc.mainnet.chain.robinhood.com",
    explorer: (process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER || "https://robinhoodchain.blockscout.com").replace(/\/+$/, ""),
    dexscreener: process.env.NEXT_PUBLIC_ROBINHOOD_DEXSCREENER_SLUG || "robinhood",
    router: addr(process.env.NEXT_PUBLIC_ROBINHOOD_ROUTER) ?? "0x89E5Db8B5aA49aa85AC63f691524311aeb649EBA",
    stablecoin: addr(process.env.NEXT_PUBLIC_ROBINHOOD_STABLECOIN) ?? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    suggestedLiquidity: "0.1",
    swapUrl: (t) => (process.env.NEXT_PUBLIC_ROBINHOOD_SWAP_URL || "").replace("{token}", t),
  },
  solana: {
    key: "solana",
    kind: "solana",
    name: "Solana",
    dex: "Raydium",
    coin: "SOL",
    chainId: 0,
    rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com",
    explorer: "https://solscan.io",
    dexscreener: "solana",
    suggestedLiquidity: "0.5",
    swapUrl: (t) => `https://raydium.io/swap/?inputMint=sol&outputMint=${t}`,
  },
};

export const isSolana = (c: LaunchChain | null | undefined) => c?.kind === "solana";
/** Solana launches: 6 decimals (like most Solana memecoins), and a supply that fits in a u64. */
export const SOL_DECIMALS = 6;
export const SOL_MAX_SUPPLY = 10n ** 13n;
/** What Raydium charges to create a pool (about 0.15 SOL), plus room for rent and network fees. Shown before signing. */
export const SOL_POOL_COST = 0.2;

/**
 * The AUTISTIK marketing wallet on Solana (NEXT_PUBLIC_SOLANA_FEE_WALLET). It receives the Solana launch fee and the
 * 0.5% fee on Solana swaps made on the Hub. Without it, Solana launches and swaps carry no AUTISTIK fee.
 */
export const solFeeWallet = () => {
  const v = (process.env.NEXT_PUBLIC_SOLANA_FEE_WALLET || process.env.SOLANA_FEE_WALLET || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null;
};
/** The small fee for launching on Solana, in SOL, paid to the marketing wallet with the token step. */
export const SOL_LAUNCH_FEE = (() => {
  const n = Number(process.env.NEXT_PUBLIC_SOLANA_LAUNCH_FEE_SOL || 0.02);
  return isFinite(n) && n >= 0 && n <= 1 ? n : 0.02;
})();
/** The launch fee as it applies right now (0 until the marketing wallet is set). */
export const solLaunchFee = () => (solFeeWallet() ? SOL_LAUNCH_FEE : 0);
/**
 * The fee on every trade of a new Solana coin launched here, in basis points (50 = 0.5%). It is built into the coin
 * itself (a Token-2022 transfer fee), so it applies wherever the coin is traded; only the marketing wallet can collect
 * it, and nobody can change it after launch. 0 until the marketing wallet is set.
 */
export const SOL_TRADE_FEE_BPS = (() => {
  const n = Number(process.env.NEXT_PUBLIC_SOLANA_TRADE_FEE_BPS || 50);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : 50;
})();
export const solTradeFeeBps = () => (solFeeWallet() ? SOL_TRADE_FEE_BPS : 0);

/**
 * The AUTISTIK Solana Locker's program address (programs/autistik-locker), once deployed. Without it Solana launches
 * can only burn their LP tokens; with it they can also lock them for 6 months or 1 year, like on the EVM chains.
 */
export const solLockerProgram = () => {
  const v = (process.env.NEXT_PUBLIC_SOLANA_LOCKER_PROGRAM || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) ? v : null;
};
/** Lock lengths, the same as the EVM Launch Pad's (182 and 365 days). */
export const LOCK_SECONDS: Record<"6m" | "1y", number> = { "6m": 182 * 86_400, "1y": 365 * 86_400 };

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

// Solana needs no contract of ours (the token program and Raydium do the work), so it is live whenever it has an RPC.
export const isLive = (c: LaunchChain, pads: Pads) => (isSolana(c) ? !!c.rpc : !!(pads[c.key] && c.chainId && c.rpc && c.explorer));
export const liveChains = (pads: Pads) => Object.values(CHAINS).filter((c) => isLive(c, pads));
/** Chains the team can deploy the launchpad on (a known V2 router and stablecoin). */
export const deployable = (c: LaunchChain) => !isSolana(c) && !!(c.router && c.stablecoin && c.chainId && c.rpc);

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
  /**
   * Holder rewards (Launch Pad v4): "" none, "native" for the chain's coin, or a token address (BTC, ETH… allowed
   * by the team). Paid from the tax.
   */
  reward?: string;
  /** Share of the tax that goes to holders, percent (1–100). The rest goes to the tax (marketing) wallet. */
  holderPercent?: number;
  description: string;
  website: string;
  x: string;
  telegram: string;
  /** The token's picture, uploaded to the Hub's token-logos storage. */
  logo?: string;
};

/** Token pictures can only come from the Hub's own storage (the member's folder is checked where it's saved). */
export const LOGO_RE = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/token-logos\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/;

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
/** On Solana the creator claims the LP tokens back themselves after the date (AUTISTIK Solana Locker). */
export const SOL_LOCK_EXPLAIN: Record<"6m" | "1y", string> = {
  "6m": "The LP tokens are locked in the AUTISTIK Solana Locker for 6 months. Nobody can touch them before then, including you and the AUTISTIK team. After that, only your wallet can claim them back, from the token page.",
  "1y": "The LP tokens are locked in the AUTISTIK Solana Locker for 1 year. Nobody can touch them before then, including you and the AUTISTIK team. After that, only your wallet can claim them back, from the token page.",
};
export const lockExplain = (lock: LiquidityLock, solana: boolean) => (solana && lock !== "burn" ? SOL_LOCK_EXPLAIN[lock] : LOCKS[lock].explain);
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
  const sol = isSolana(chain);
  // Solana launches have no tax, whitelist or first buy (a plain SPL token). The LP tokens are burned, or locked in the
  // AUTISTIK Solana Locker once it's set up (solLockerProgram).
  // Solana holder rewards: one fee on every transfer (Token-2022), split between holders and the creator's wallet.
  const solReward = sol && typeof p.reward === "string" && p.reward in SOL_REWARD_TOKENS ? p.reward : "";
  if (sol) p = { ...p, lock: solLockerProgram() ? p.lock : "burn", buyTax: solReward ? p.buyTax : 0, sellTax: solReward ? p.buyTax : 0, taxWallet: solReward ? p.taxWallet : "", whitelist: [], devBuy: "0", reward: solReward };
  const maxSupply = sol ? SOL_MAX_SUPPLY : 10n ** 15n;
  if (!/^\d+$/.test(supply) || BigInt(supply) < 1000n || BigInt(supply) > maxSupply) return { error: `Total supply must be a whole number from 1,000 to ${maxSupply.toLocaleString("en-US")}.` };
  const creatorPercent = Number(p.creatorPercent ?? 0);
  if (!(creatorPercent >= 0 && creatorPercent <= MAX_CREATOR_PERCENT)) return { error: `Your share can be 0–${MAX_CREATOR_PERCENT}% of the supply.` };
  const liquidity = String(p.liquidity || "").trim();
  let wei = 0n;
  try { wei = parseEther(liquidity); } catch {}
  if (wei <= 0n) return { error: `Liquidity must be an amount of ${chain.coin}, like ${chain.suggestedLiquidity}.` };
  if (sol && !/^\d*(\.\d{1,9})?$/.test(liquidity)) return { error: "SOL amounts can have at most 9 decimals." };
  if (!isLock(p.lock)) return { error: "Choose what happens to the liquidity: lock 6 months, lock 1 year, or burn." };
  const buyTax = Number(p.buyTax ?? 0), sellTax = Number(p.sellTax ?? 0);
  if (!(buyTax >= 0 && buyTax <= MAX_TAX_PERCENT) || !(sellTax >= 0 && sellTax <= MAX_TAX_PERCENT)) return { error: `Tax can be 0–${MAX_TAX_PERCENT}% on buys and on sells.` };
  const taxWallet = String(p.taxWallet || "").trim();
  if (sol && solReward) {
    if (!(buyTax >= 1 && buyTax <= MAX_TAX_PERCENT)) return { error: `Holder rewards on Solana come from a fee on every trade: set it to 1–${MAX_TAX_PERCENT}%.` };
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(taxWallet)) return { error: "Add the Solana wallet that should receive your part of the fee." };
  } else if ((buyTax > 0 || sellTax > 0) && !/^0x[0-9a-fA-F]{40}$/.test(taxWallet)) return { error: "Add the wallet that should receive the tax (0x…)." };
  const whitelist = [...new Set((Array.isArray(p.whitelist) ? p.whitelist : []).map((w) => String(w).trim()).filter(Boolean))];
  if (whitelist.length > 3) return { error: "You can whitelist at most 3 wallets." };
  if (whitelist.some((w) => !/^0x[0-9a-fA-F]{40}$/.test(w))) return { error: "Each whitelisted wallet must be a 0x… address." };
  const reward = sol ? solReward : String(p.reward || "").trim();
  if (!sol && reward && reward !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(reward)) return { error: "The reward token must be a 0x… address." };
  const holderPercent = reward ? Number(p.holderPercent ?? 0) : 0;
  if (reward && !(holderPercent >= 1 && holderPercent <= 100)) return { error: "Choose how much of the tax goes to holders (1–100%)." };
  if (reward && !(buyTax > 0 || sellTax > 0)) return { error: "Holder rewards come from the tax: set a buy or sell tax first." };
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
      ...(reward ? { reward, holderPercent: Math.round(holderPercent * 100) / 100 } : {}),
      description: String(p.description || "").trim().slice(0, 500),
      website: link(p.website),
      x: link(p.x),
      telegram: link(p.telegram),
      ...(typeof p.logo === "string" && LOGO_RE.test(p.logo) ? { logo: p.logo } : {}),
    },
  };
}
