/**
 * The AUTISTIK Wallet: chains, starter tokens and the trade fee. Shared by the page and the server.
 * Self-custody: each person's keys stay in their own wallet; the Hub only finds prices and builds the swap for them
 * to approve. Swaps on EVM chains go through KyberSwap's aggregator (every DEX, best price), Solana through Jupiter.
 */
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { TOKEN_ADDRESS } from "@/lib/groups";

export type WChainKey = "bsc" | "base" | "ethereum" | "arbitrum" | "solana";
export type WToken = { address: string; symbol: string; name: string; decimals: number; logo?: string | null };
export type WChain = {
  key: WChainKey; name: string; short: string; kind: "evm" | "solana"; chainId?: number; viem?: any;
  rpc: string; explorer: string; native: WToken; tokens: WToken[];
  /** KyberSwap's name for the chain. */
  kyber?: string;
  /** The chain's V2 DEX router: a fallback for brand-new tokens the aggregator hasn't found yet. */
  v2Router?: `0x${string}`;
  wrapped?: `0x${string}`;
};

/** The swap fee that goes to the AUTISTIK treasury: 0.5%. */
export const FEE_BPS = 50;
export const FEE_PERCENT = FEE_BPS / 100;
/** How the aggregators write "the chain's own coin" (BNB, ETH). */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** KyberSwap's router (the same on every chain). Swaps built by the server must go here, nowhere else. */
export const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
export const WSOL = "So11111111111111111111111111111111111111112";
export const SOL_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const t = (address: string, symbol: string, name: string, decimals: number): WToken => ({ address, symbol, name, decimals });
const eth = (name = "Ether") => t(NATIVE, "ETH", name, 18);

export const WCHAINS: Record<WChainKey, WChain> = {
  bsc: {
    key: "bsc", name: "BNB Chain", short: "BNB", kind: "evm", chainId: 56, viem: bsc, kyber: "bsc",
    rpc: process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.bnbchain.org", explorer: "https://bscscan.com",
    native: t(NATIVE, "BNB", "BNB", 18),
    v2Router: "0x10ED43C718714eb63d5aA57B78B54704E256024E", wrapped: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    tokens: [
      t(TOKEN_ADDRESS, "AUTISTIK", "AUTISTIK", 18),
      t("0x55d398326f99059fF775485246999027B3197955", "USDT", "Tether USD", 18),
      t("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", "USDC", "USD Coin", 18),
      t("0x2170Ed0880ac9A755fd29B2688956BD959F933F8", "ETH", "Ethereum", 18),
      t("0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", "BTCB", "Bitcoin", 18),
    ],
  },
  base: {
    key: "base", name: "Base", short: "Base", kind: "evm", chainId: 8453, viem: base, kyber: "base",
    rpc: process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org", explorer: "https://basescan.org",
    native: eth(), v2Router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", wrapped: "0x4200000000000000000000000000000000000006",
    tokens: [
      t("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "USDC", "USD Coin", 6),
      t("0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", "cbBTC", "Coinbase Bitcoin", 8),
    ],
  },
  ethereum: {
    key: "ethereum", name: "Ethereum", short: "ETH", kind: "evm", chainId: 1, viem: mainnet, kyber: "ethereum",
    rpc: process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io",
    native: eth(), v2Router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", wrapped: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    tokens: [
      t("0xdAC17F958D2ee523a2206206994597C13D831ec7", "USDT", "Tether USD", 6),
      t("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 6),
      t("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", "WBTC", "Wrapped Bitcoin", 8),
      t("0x6982508145454Ce325dDbE47a25d4ec3d2311933", "PEPE", "Pepe", 18),
    ],
  },
  arbitrum: {
    key: "arbitrum", name: "Arbitrum", short: "ARB", kind: "evm", chainId: 42161, viem: arbitrum, kyber: "arbitrum",
    rpc: process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io",
    native: eth(), tokens: [
      t("0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "USDC", "USD Coin", 6),
      t("0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", "USDT", "Tether USD", 6),
      t("0x912CE59144191C1204E64559FE8253a0e49E6548", "ARB", "Arbitrum", 18),
    ],
  },
  solana: {
    key: "solana", name: "Solana", short: "SOL", kind: "solana",
    rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com", explorer: "https://solscan.io",
    native: t(WSOL, "SOL", "Solana", 9),
    tokens: [
      t(SOL_USDC, "USDC", "USD Coin", 6),
      t("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT", "Tether USD", 6),
      t("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", "JUP", "Jupiter", 6),
      t("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "BONK", "Bonk", 5),
      t("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", "WIF", "dogwifhat", 6),
    ],
  },
};
export const WCHAIN_LIST = Object.values(WCHAINS);
export const isWChain = (c: unknown): c is WChainKey => typeof c === "string" && c in WCHAINS;
export const isNative = (c: WChain, address: string) => address.toLowerCase() === c.native.address.toLowerCase();

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
export const isTokenAddress = (c: WChain, a: unknown): a is string => typeof a === "string" && (c.kind === "solana" ? SOL_RE.test(a) : EVM_RE.test(a));

/** Raw units to a readable number string, and back. */
export function fromUnits(raw: string | bigint, decimals: number): number {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  return Number(`${s.slice(0, -decimals || undefined)}.${decimals ? s.slice(-decimals) : "0"}`);
}
export function toUnits(amount: string, decimals: number): bigint | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] || "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt((m[1] || "0") + frac);
}

/** Slippage: how far the price may move before the swap is cancelled. */
export const MAX_SLIPPAGE_BPS = 1500;
/** Price impact (how much this trade itself moves the price): warn, ask again, refuse. */
export const IMPACT_WARN = 3, IMPACT_CONFIRM = 10, IMPACT_BLOCK = 30;
