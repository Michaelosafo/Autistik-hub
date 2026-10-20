/**
 * Limit and stop-loss orders (EVM). Shared by the trade screen and the server.
 *
 * The member signs an order and approves the AUTISTIK Orders contract for exactly its amount; nothing leaves their
 * wallet until it fills. `minOut` is the least they accept (the contract enforces it on-chain, after the fee).
 * - Limit: fills when the best price pays at least `minOut` (their limit price).
 * - Stop-loss: fills when the price falls to the stop (the output drops to `triggerOut`), accepting down to `minOut`.
 *   For a buy, "stop" is a breakout buy: it fills once the price rises to the stop.
 */
import { NATIVE, type WChain } from "@/lib/wallet-chains";

export const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" }, { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "expiry", type: "uint256" }, { name: "nonce", type: "uint256" },
  ],
} as const;
export const orderDomain = (chainId: number, contract: string) => ({ name: "AUTISTIK Orders", version: "1", chainId, verifyingContract: contract as `0x${string}` });

export type OrderMsg = { maker: `0x${string}`; tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountIn: bigint; minOut: bigint; expiry: bigint; nonce: bigint };
export type OrderKind = "limit" | "stop";
/** The fee the contract takes from what the member receives (basis points). */
export const ORDER_FEE_BPS = 50;
/** Default room below the stop price so a stop-loss still fills in a fast drop. */
export const STOP_SLIPPAGE_DEFAULT = 5;
export const MAX_OPEN_ORDERS = 20;
export const EXPIRY_DAYS = [1, 7, 30, 90] as const;

/** Orders can't spend the chain's coin directly (it can't be approved), so buys with BNB/ETH use WBNB/WETH. */
export const orderTokenIn = (c: WChain, address: string) => (address.toLowerCase() === NATIVE.toLowerCase() ? c.wrapped! : address);
export const cancelMessage = (id: string) => `Cancel AUTISTIK order ${id}`;

/** Should this order fill now? `estOut` is what the member would get right now, after the fee. */
export function triggered(kind: OrderKind, estOut: bigint, triggerOut: bigint, minOut: bigint): boolean {
  return kind === "limit" ? estOut >= minOut : estOut <= triggerOut && estOut >= minOut;
}
