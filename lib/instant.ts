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

export const V3_ROUTER_ABI = parseAbi([
  "struct P { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(P params) payable returns (uint256)",
]);

/** Instant coins: 1 billion supply, the creator gets this share of the pool's 1% fee (the rest goes to AUTISTIK). */
export const INSTANT_SUPPLY = 1_000_000_000;
export const INSTANT_CREATOR_BPS = 5000;
/** Starting market cap in BNB (the whole supply). About $4–6k: small enough to move, big enough to stop dust buys. */
export const INSTANT_START_FDV_BNB = "6";
