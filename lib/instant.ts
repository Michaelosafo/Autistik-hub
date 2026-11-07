import { parseAbi } from "viem";

/**
 * Instant launch: a coin that trades on PancakeSwap the moment it's made, with no liquidity from the creator and no
 * bonding curve. The whole supply goes into a one-sided PancakeSwap v3 pool (1% fee tier) starting at a small market
 * cap; buyers bring the BNB. The pool position is held by the AutistikInstantLaunch contract forever (it has no way to
 * take it out), and the pool's 1% trading fee is split between the creator and AUTISTIK. See
 * contracts/AutistikInstantLaunch.sol.
 */
export const INSTANT_ABI = parseAbi([
  "function launch(string name, string symbol, bytes32 salt, uint256 permitDeadline, bytes permitSig, uint256 deadline) payable returns (address)",
  "function collectFees(address token)",
  "function claim()",
  "function owed(address) view returns (uint256)",
  "function coinOf(address) view returns (address creator, address pool, uint256 positionId, uint16 creatorShareBps, uint64 launchedAt)",
  "function launchFee() view returns (uint256)",
  "function startFdv() view returns (uint256)",
  "function creatorShareBps() view returns (uint256)",
  "function owner() view returns (address)",
  "function feeTo() view returns (address)",
  "function positions() view returns (address)",
  "function eligibilitySigner() view returns (address)",
  "function launches() view returns (uint256)",
  "function SUPPLY() view returns (uint256)",
  "function setSettings(address feeTo, uint256 launchFee, uint256 startFdv, uint256 creatorShareBps)",
  "event Launched(address indexed token, address indexed pool, address indexed creator, uint256 positionId, uint256 creatorTokens, string name, string symbol)",
  "event FeesCollected(address indexed token, uint256 bnb, uint256 tokens, uint256 toCreatorBnb, uint256 toAutistikBnb)",
]);

export const INSTANT_CONSTRUCTOR = [
  { type: "address", name: "positions" }, { type: "address", name: "router" }, { type: "address", name: "owner" }, { type: "address", name: "feeTo" },
  { type: "uint256", name: "startFdv" }, { type: "uint256", name: "creatorShareBps" }, { type: "address", name: "signer" },
] as const;

/** PancakeSwap v3 on BNB Chain (the same addresses on mainnet and testnet, checked on-chain). */
export const PANCAKE_V3 = {
  positions: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
  router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  wbnb: { 56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 97: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" },
} as const;

/** Where Instant launch works: each network's v3 DEX (position manager + router), wrapped coin and starting market cap. */
export const INSTANT_DEX = {
  bsc: {
    dex: "PancakeSwap", positions: PANCAKE_V3.positions, router: PANCAKE_V3.router, startFdv: "6", noFirstBuy: false,
    swap: (t: string) => `https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${t}`,
  },
  ethereum: {
    dex: "Uniswap", positions: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    startFdv: "2", noFirstBuy: false,
    swap: (t: string) => `https://app.uniswap.org/swap?chain=mainnet&outputCurrency=${t}`,
  },
  // Robinhood Chain (an Arbitrum chain): Uniswap v3 from Uniswap's deployment list. It only has SwapRouter02, whose
  // swap call differs from the one the contract uses for the creator's first buy, so launches there have no first buy
  // (the contract never calls the router when the first buy is 0).
  robinhood: {
    dex: "Uniswap", positions: "0x73991a25c818bf1f1128deaab1492d45638de0d3", router: "0xcaf681a66d020601342297493863e78c959e5cb2",
    startFdv: "2", noFirstBuy: true,
    swap: (t: string) => `https://dexscreener.com/robinhood/${t}`,
  },
} as const;
export type InstantChain = keyof typeof INSTANT_DEX;
export const isInstantChain = (c: string): c is InstantChain => c in INSTANT_DEX;

export const V3_ROUTER_ABI = parseAbi([
  "struct P { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(P params) payable returns (uint256)",
]);

/** Instant coins: 1 billion supply, the creator gets this share of the pool's 1% fee (the rest goes to AUTISTIK). */
export const INSTANT_SUPPLY = 1_000_000_000;
export const INSTANT_CREATOR_BPS = 5000;
/** Starting market cap in BNB (the whole supply). About $4–6k: small enough to move, big enough to stop dust buys. */
export const INSTANT_START_FDV_BNB = "6";

// ---------------------------------------------------------------- Instant v2: optional holder rewards

/** Instant v2 (contracts/AutistikInstantLaunchV2.sol): the same launch, plus optional holder rewards. */
export const INSTANT_V2_ABI = parseAbi([
  "struct Reward { address token; uint16 holderBps; uint24 fee; }",
  "function launch(string name, string symbol, bytes32 salt, uint256 permitDeadline, bytes permitSig, uint256 deadline, Reward reward) payable returns (address)",
  "function launchAtFdv(string name, string symbol, bytes32 salt, uint256 deadline, Reward reward, uint256 fdv) payable returns (address)",
  "function curator(address) view returns (bool)",
  "function setCurator(address who, bool on)",
  "function rewardFeeFor(address token, uint256 holderBps, uint24 fee) view returns (uint24)",
  "function rewardFee(address) view returns (uint24)",
  "function rewardPending(address) view returns (uint256)",
  "function collectFees(address token)",
  "function claim()",
  "function owed(address) view returns (uint256)",
  "function coinOf(address) view returns (address creator, address pool, uint256 positionId, uint16 creatorShareBps, uint16 holderBps, uint24 rewardFee, uint64 launchedAt)",
  "function launchFee() view returns (uint256)",
  "function startFdv() view returns (uint256)",
  "function owner() view returns (address)",
  "function feeTo() view returns (address)",
  "function positions() view returns (address)",
  "function router() view returns (address)",
  "event Launched(address indexed token, address indexed pool, address indexed creator, uint256 positionId, uint256 creatorTokens, string name, string symbol)",
  "event RewardsChosen(address indexed token, address rewardToken, uint256 holderBps)",
  "event FeesCollected(address indexed token, uint256 eth, uint256 tokens, uint256 toCreatorEth, uint256 toAutistikEth, uint256 toHoldersEth)",
  "event RewardsPaid(address indexed token, address rewardToken, uint256 spentEth, uint256 rewardAmount)",
  "error NotCurator()", "error NoRewardPool()", "error RewardNotAllowed()", "error BadSettings()", "error NoFirstBuyHere()",
  "error CreatorBuyTooBig()", "error PoolTaken()", "error TooLate()", "error NotEligible()", "error PermitUsed()", "error FeeTooLow()",
]);

/** An Instant v2 coin: holders' rewards, claimed straight from the coin's own contract. */
export const INSTANT_TOKEN_V2_ABI = parseAbi([
  "function rewardToken() view returns (address)",
  "function withdrawableRewards(address) view returns (uint256)",
  "function totalRewardsDistributed() view returns (uint256)",
  "function claim() returns (uint256)",
]);

export const INSTANT_V2_CONSTRUCTOR = [
  { type: "address", name: "positions" }, { type: "address", name: "router" }, { type: "address", name: "owner" }, { type: "address", name: "feeTo" },
  { type: "uint256", name: "startFdv" }, { type: "uint256", name: "creatorShareBps" }, { type: "address", name: "signer" },
  { type: "address[]", name: "rewardTokens" }, { type: "uint24[]", name: "rewardFees" },
] as const;

/** "The chain's own coin" as a reward (BNB, ETH). */
export const NATIVE_REWARD = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export type RewardPick = { symbol: string; address: `0x${string}`; decimals: number; fee?: number; stock?: boolean };
/**
 * Top tokens offered as holder rewards on each Instant network (any other token can be pasted in). Those with a fee are
 * on the contract's ready-made list (checked on real pools in contracts/test-instant/*Fork.t.sol); the rest are bought
 * through their deepest pool with the chain's coin, found when the creator picks them. Robinhood Chain has no v3 router
 * the contract can swap with, so rewards there are paid in ETH.
 */
export const INSTANT_REWARDS: Record<InstantChain, RewardPick[]> = {
  bsc: [
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, fee: 100 },
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
    { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, fee: 2500 },
    { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
    { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
  ],
  ethereum: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, fee: 500 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, fee: 500 },
    { symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 },
    { symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18 },
    { symbol: "PEPE", address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18 },
  ],
  robinhood: [],
};

/** v3 factories and the fee tiers they offer (to find a reward token's pool with the chain's coin). */
const V3_FACTORY: Partial<Record<InstantChain, { factory: `0x${string}`; wrapped: `0x${string}`; tiers: number[] }>> = {
  bsc: { factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", wrapped: PANCAKE_V3.wbnb[56], tiers: [100, 500, 2500, 10_000] },
  ethereum: { factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984", wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", tiers: [100, 500, 3000, 10_000] },
};
const FIND_ABI = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/**
 * A token's deepest v3 pool with the chain's coin (the one the contract will buy it through), with its ticker. Null when
 * there's no pool, or (min) less than a little of the chain's coin in it: holders' rewards could never be bought.
 */
export async function findRewardPool(pub: any, chain: InstantChain, token: `0x${string}`, min = 10n ** 16n) {
  const f = V3_FACTORY[chain];
  if (!f || token.toLowerCase() === f.wrapped.toLowerCase()) return null;
  const pools: string[] = await Promise.all(f.tiers.map((fee) => pub.readContract({ address: f.factory, abi: FIND_ABI, functionName: "getPool", args: [f.wrapped, token, fee] }).catch(() => "0x0000000000000000000000000000000000000000")));
  const depth: bigint[] = await Promise.all(pools.map((p) => /^0x0{40}$/i.test(p) ? 0n : pub.readContract({ address: f.wrapped, abi: FIND_ABI, functionName: "balanceOf", args: [p] }).catch(() => 0n)));
  let best = -1;
  depth.forEach((d, i) => { if (d >= min && (best < 0 || d > depth[best])) best = i; });
  if (best < 0) return null;
  const [symbol, decimals] = await Promise.all([
    pub.readContract({ address: token, abi: FIND_ABI, functionName: "symbol" }).catch(() => "?"),
    pub.readContract({ address: token, abi: FIND_ABI, functionName: "decimals" }).catch(() => 18),
  ]);
  return { fee: f.tiers[best], symbol: String(symbol).slice(0, 16), decimals: Number(decimals), depth: depth[best] };
}
