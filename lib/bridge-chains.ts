/**
 * Swap across networks: every network the swap can move coins between. Shared by the page and the server.
 * Cross-network routes (bridges plus the DEX on each side) come from LI.FI. Swaps on one of the Wallet's own five
 * networks still use the Wallet engine (KyberSwap / Jupiter), see wallet-chains.ts.
 */
import * as V from "viem/chains";
import type { WChainKey } from "@/lib/wallet-chains";

export type XChain = {
  /** LI.FI's chain id (the EVM chain id; Solana has its own big number). */
  id: number; key: string; name: string; kind: "evm" | "solana";
  /** Badge color when the network logo can't load. */
  color: string;
  native: { symbol: string; decimals: number };
  explorer: string; rpc: string; viem?: any;
  /** The Wallet network with the same chain, for same-network swaps. */
  wchain?: WChainKey;
};

export const SOLANA_ID = 1151111081099710;
/** How LI.FI writes a chain's own coin. */
export const X_NATIVE_EVM = "0x0000000000000000000000000000000000000000";
export const X_NATIVE_SOL = "11111111111111111111111111111111";

/**
 * The LI.FI contract every cross-network swap goes through. The server refuses a route to anything else, and the
 * page checks again before asking the wallet to sign.
 */
export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const LIFI_DIAMOND_BY_CHAIN: Record<number, string> = { 324: "0x341e94069f53234fE6DabeF707aD424830525715" };
export const lifiDiamond = (id: number) => LIFI_DIAMOND_BY_CHAIN[id] || LIFI_DIAMOND;

const evm = (v: any, key: string, name: string, color: string, wchain?: WChainKey, rpc?: string): XChain => ({
  id: v.id, key, name, kind: "evm", color, viem: v, wchain,
  native: { symbol: v.nativeCurrency.symbol, decimals: v.nativeCurrency.decimals },
  explorer: String(v.blockExplorers?.default?.url || "").replace(/\/$/, ""),
  rpc: rpc || v.rpcUrls.default.http[0],
});

/** Biggest networks first, then the rest by name. */
export const XCHAIN_LIST: XChain[] = [
  evm(V.bsc, "bsc", "BNB Chain", "#F0B90B", "bsc", process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.bnbchain.org"),
  evm(V.mainnet, "ethereum", "Ethereum", "#627EEA", "ethereum", process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com"),
  { id: SOLANA_ID, key: "solana", name: "Solana", kind: "solana", color: "#9945FF", native: { symbol: "SOL", decimals: 9 }, explorer: "https://solscan.io",
    rpc: process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com", wchain: "solana" },
  evm(V.base, "base", "Base", "#0052FF", "base", process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org"),
  evm(V.arbitrum, "arbitrum", "Arbitrum", "#28A0F0", "arbitrum", process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc"),
  evm(V.optimism, "optimism", "Optimism", "#FF0420"),
  evm(V.polygon, "polygon", "Polygon", "#8247E5", undefined, "https://polygon-bor-rpc.publicnode.com"),
  evm(V.avalanche, "avalanche", "Avalanche", "#E84142"),
  evm(V.sonic, "sonic", "Sonic", "#FE9A4C"),
  evm(V.hyperEvm, "hyperevm", "HyperEVM", "#50D2C1"),
  evm(V.linea, "linea", "Linea", "#61DFFF"),
  evm(V.zksync, "zksync", "zkSync", "#8C8DFC"),
  evm(V.scroll, "scroll", "Scroll", "#FFDBB0"),
  evm(V.blast, "blast", "Blast", "#FCFC03"),
  evm(V.mantle, "mantle", "Mantle", "#65B3AE"),
  evm(V.unichain, "unichain", "Unichain", "#F50DB4"),
  evm(V.berachain, "berachain", "Berachain", "#814625"),
  evm(V.monad, "monad", "Monad", "#836EF9"),
  evm(V.plasma, "plasma", "Plasma", "#1C9C7F"),
  evm(V.worldchain, "worldchain", "World Chain", "#DDDDDD"),
  evm(V.gnosis, "gnosis", "Gnosis", "#3E6957"),
  evm(V.celo, "celo", "Celo", "#FCFF52"),
  evm(V.sei, "sei", "Sei", "#9E1F19"),
  evm(V.ink, "ink", "Ink", "#7132F5"),
  evm(V.mode, "mode", "Mode", "#DFFE00"),
  evm(V.soneium, "soneium", "Soneium", "#B5B5B5"),
  evm(V.katana, "katana", "Katana", "#F6FF0D"),
  evm(V.apeChain, "apechain", "ApeChain", "#0054FA"),
  evm(V.cronos, "cronos", "Cronos", "#1199FA"),
  evm(V.fraxtal, "fraxtal", "Fraxtal", "#8E8E8E"),
  evm(V.lisk, "lisk", "Lisk", "#4070F4"),
  evm(V.moonbeam, "moonbeam", "Moonbeam", "#E1147B"),
  evm(V.metis, "metis", "Metis", "#00DACC"),
  evm(V.kaia, "kaia", "Kaia", "#BFF009"),
  evm(V.ronin, "ronin", "Ronin", "#1273EA"),
  evm(V.flare, "flare", "Flare", "#E62058"),
  evm(V.bob, "bob", "BOB", "#F25D00"),
  evm(V.hemi, "hemi", "Hemi", "#FF6C15"),
  evm(V.plumeMainnet, "plume", "Plume", "#FF3D00"),
  evm(V.flowMainnet, "flow", "Flow EVM", "#00EF8B"),
  evm(V.rootstock, "rootstock", "Rootstock", "#FF9100"),
  evm(V.xLayer, "xlayer", "X Layer", "#CCCCCC"),
];
export const XCHAINS: Record<number, XChain> = Object.fromEntries(XCHAIN_LIST.map((c) => [c.id, c]));
export const XCHAIN_BY_KEY: Record<string, XChain> = Object.fromEntries(XCHAIN_LIST.map((c) => [c.key, c]));
export const isXChain = (id: unknown): id is number => typeof id === "number" && id in XCHAINS;
export const xNative = (c: XChain) => (c.kind === "solana" ? X_NATIVE_SOL : X_NATIVE_EVM);

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
/** A token or wallet address on that network. */
export const isXAddress = (c: XChain, a: unknown): a is string => typeof a === "string" && (c.kind === "solana" ? SOL_RE.test(a) : EVM_RE.test(a));
/** Is this the chain's own coin, however it is written (LI.FI's zero address, the aggregators' 0xEeee…, or wSOL)? */
export const isXNative = (c: XChain, a: string) => c.kind === "solana"
  ? a === X_NATIVE_SOL || a === "So11111111111111111111111111111111111111112"
  : /^0x0{40}$/i.test(a) || a.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export type XToken = { address: string; symbol: string; name: string; decimals: number; logo?: string | null; priceUsd?: number | null };

/** A cross-network quote, cut down to what the page shows and signs. Built fresh by the server for each request. */
export type XQuote = {
  fromChain: number; toChain: number; fromToken: string; toToken: string; fromAddress: string; toAddress: string;
  fromAmount: string; toAmount: string; toAmountMin: string; fromUsd: number | null; toUsd: number | null;
  gasUsd: number | null; feeUsd: number | null; feeBps: number; seconds: number | null;
  tool: string; toolName: string; toolLogo: string | null; steps: { kind: string; name: string; logo: string | null }[];
  /** EVM: the transaction, and who must be allowed to spend the token first (null for the chain's own coin). */
  evm: { to: `0x${string}`; data: `0x${string}`; value: string; spender: `0x${string}` | null } | null;
  /** Solana: the transaction (base64) for the wallet to sign. */
  sol: string | null;
  at: number;
};
