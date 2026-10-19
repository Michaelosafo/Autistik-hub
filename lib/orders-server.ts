/**
 * Orders, server side: saving signed orders, cancelling, and the keeper that fills them when the price is right.
 * The keeper only ever calls the AUTISTIK Orders contract, which checks every fill pays the member at least their own
 * minimum. The keeper's key (ORDERS_KEEPER_KEY) pays gas only; it can't move anyone's tokens anywhere else. Server only.
 */
import { createWalletClient, decodeEventLog, getAddress, hashTypedData, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORDERS_ABI } from "@/lib/orders-build";
import { MAX_OPEN_ORDERS, ORDER_TYPES, orderDomain, triggered, type OrderKind, type OrderMsg } from "@/lib/orders";
import { KYBER_ROUTER, NATIVE, WCHAINS, isWChain, type WChain } from "@/lib/wallet-chains";
import { kyberRoute, riskOf, v2AmountOut, walletChainClient } from "@/lib/wallet-server";
import { supabaseService } from "@/lib/supabase/server";

const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"]);

export function keeperAccount() {
  const k = process.env.ORDERS_KEEPER_KEY;
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k.trim())) return null;
  return privateKeyToAccount(k.trim() as `0x${string}`);
}

/** The Orders contract on each chain (saved by the admin after deploying). */
export async function orderContracts(): Promise<Record<string, `0x${string}`>> {
  const { data } = await supabaseService().from("order_contracts").select("chain,address");
  const out: Record<string, `0x${string}`> = {};
  for (const r of data || []) if (isWChain(r.chain) && isAddress(r.address)) out[r.chain] = getAddress(r.address);
  return out;
}

const big = (v: unknown) => { try { const b = BigInt(String(v)); return b >= 0n ? b : null; } catch { return null; } };

export type NewOrder = {
  chain: string; kind: OrderKind; side: "buy" | "sell"; price: string; triggerOut: string; signature: `0x${string}`;
  symbolIn: string; symbolOut: string; decimalsIn: number; decimalsOut: number;
  order: { maker: string; tokenIn: string; tokenOut: string; amountIn: string; minOut: string; expiry: string; nonce: string };
};

/** Checks a signed order (signature, funds, approval) and saves it for the keeper. */
export async function createOrder(b: NewOrder): Promise<{ id: string } | { error: string }> {
  if (!isWChain(b?.chain)) return { error: "Pick a network." };
  const c = WCHAINS[b.chain];
  if (c.kind !== "evm") return { error: "Orders on Solana work differently." };
  const contract = (await orderContracts())[c.key];
  if (!contract) return { error: `Limit and stop orders aren't open on ${c.name} yet.` };
  if (b.kind !== "limit" && b.kind !== "stop") return { error: "Pick Limit or Stop-loss." };
  if (b.side !== "buy" && b.side !== "sell") return { error: "Pick Buy or Sell." };
  const o = b.order || ({} as any);
  if (![o.maker, o.tokenIn].every((a) => isAddress(a)) || !(isAddress(o.tokenOut) || o.tokenOut === NATIVE)) return { error: "Bad order." };
  if (getAddress(o.tokenIn) === getAddress(o.tokenOut === NATIVE ? c.wrapped! : o.tokenOut)) return { error: "Pick two different tokens." };
  const amountIn = big(o.amountIn), minOut = big(o.minOut), expiry = big(o.expiry), nonce = big(o.nonce), triggerOut = big(b.triggerOut);
  if (!amountIn || !minOut || !expiry || nonce == null || !triggerOut) return { error: "Bad order amounts." };
  const nowS = BigInt(Math.floor(Date.now() / 1000));
  if (expiry < nowS + 300n || expiry > nowS + 91n * 86400n) return { error: "Pick an expiry between 1 and 90 days." };
  if (b.kind === "stop" && minOut > triggerOut) return { error: "The lowest price you accept must be at or below the stop price." };
  if (!/^[\d.]{1,40}$/.test(String(b.price))) return { error: "Bad price." };
  const msg: OrderMsg = { maker: getAddress(o.maker), tokenIn: getAddress(o.tokenIn), tokenOut: (o.tokenOut === NATIVE ? NATIVE : getAddress(o.tokenOut)) as `0x${string}`, amountIn, minOut, expiry, nonce };

  const pc = walletChainClient(c);
  const okSig = await pc.verifyTypedData({ address: msg.maker, domain: orderDomain(c.chainId!, contract), types: ORDER_TYPES, primaryType: "Order", message: msg, signature: b.signature }).catch(() => false);
  if (!okSig) return { error: "The order signature doesn't match your wallet. Try again." };
  const [balance, allowance] = await Promise.all([
    pc.readContract({ address: msg.tokenIn, abi: ERC20, functionName: "balanceOf", args: [msg.maker] }),
    pc.readContract({ address: msg.tokenIn, abi: ERC20, functionName: "allowance", args: [msg.maker, contract] }),
  ]);
  if (balance < amountIn) return { error: `Not enough ${b.symbolIn} for this order.` };
  if (allowance < amountIn) return { error: "The order contract isn't approved for this amount yet." };

  const sb = supabaseService();
  const { count } = await sb.from("trade_orders").select("id", { count: "exact", head: true }).ilike("maker", msg.maker).in("status", ["open", "filling"]);
  if ((count ?? 0) >= MAX_OPEN_ORDERS) return { error: `You can have up to ${MAX_OPEN_ORDERS} open orders. Cancel one first.` };
  const clip = (s: unknown, n: number) => String(s ?? "").replace(/[^\w.$-]/g, "").slice(0, n) || "?";
  const { data, error } = await sb.from("trade_orders").insert({
    chain: c.key, contract, maker: msg.maker, kind: b.kind, side: b.side, token_in: msg.tokenIn, token_out: msg.tokenOut,
    symbol_in: clip(b.symbolIn, 20), symbol_out: clip(b.symbolOut, 20), decimals_in: Math.min(36, Math.max(0, Number(b.decimalsIn) | 0)), decimals_out: Math.min(36, Math.max(0, Number(b.decimalsOut) | 0)),
    amount_in: amountIn.toString(), min_out: minOut.toString(), trigger_out: triggerOut.toString(), price: String(b.price),
    expiry: Number(expiry), nonce: nonce.toString(), signature: b.signature,
  }).select("id").single();
  if (error) return { error: /duplicate/i.test(error.message) ? "That order is already saved." : "Couldn't save the order. Try again." };
  return { id: data.id };
}

export async function listOrders(chain: string, maker: string) {
  if (!isAddress(maker)) return [];
  const { data } = await supabaseService().from("trade_orders")
    .select("id,chain,kind,side,token_in,token_out,symbol_in,symbol_out,decimals_in,decimals_out,amount_in,min_out,trigger_out,price,expiry,status,note,tx_hash,out_amount,created_at,filled_at,contract,nonce,maker")
    .eq("chain", chain).ilike("maker", getAddress(maker)).order("created_at", { ascending: false }).limit(60);
  return data || [];
}

/** Cancels an order once the member signs a short message proving it's theirs. */
export async function cancelOrder(id: string, signature: `0x${string}`): Promise<{ ok: true } | { error: string }> {
  const sb = supabaseService();
  const { data: row } = await sb.from("trade_orders").select("id,chain,maker,status").eq("id", id).maybeSingle();
  if (!row) return { error: "Order not found." };
  if (row.status !== "open") return { error: row.status === "filling" ? "This order is filling right now." : "This order is already closed." };
  const pc = walletChainClient(WCHAINS[row.chain as keyof typeof WCHAINS]);
  const { cancelMessage } = await import("@/lib/orders");
  const ok = await pc.verifyMessage({ address: getAddress(row.maker), message: cancelMessage(id), signature }).catch(() => false);
  if (!ok) return { error: "That signature isn't from the order's wallet." };
  await sb.from("trade_orders").update({ status: "cancelled", note: "Cancelled by you.", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
  return { ok: true };
}

// ---------------------------------------------------------------- Keeper

type Row = { id: string; chain: string; contract: string; maker: string; kind: OrderKind; token_in: string; token_out: string; amount_in: string; min_out: string; trigger_out: string; expiry: number; nonce: string; signature: string; attempts: number; note: string | null };

/** Called every minute: checks open orders and fills the ones whose price has been reached. */
export async function runKeeper(deadline: number) {
  const account = keeperAccount();
  if (!account) return { skipped: "ORDERS_KEEPER_KEY isn't set" };
  const sb = supabaseService();
  const contracts = await orderContracts();
  const nowS = Math.floor(Date.now() / 1000);
  await sb.from("trade_orders").update({ status: "expired", note: "Expired.", updated_at: new Date().toISOString() }).eq("status", "open").lt("expiry", nowS);
  // An order stuck in "filling" (the run stopped mid-way) goes back to open after 3 minutes; the contract blocks double fills.
  await sb.from("trade_orders").update({ status: "open" }).eq("status", "filling").lt("updated_at", new Date(Date.now() - 180_000).toISOString());
  const { data: rows } = await sb.from("trade_orders").select("*").eq("status", "open").order("updated_at", { ascending: true }).limit(40);
  const stats = { checked: 0, filled: 0, failed: 0 };
  for (const r of (rows || []) as Row[]) {
    if (Date.now() > deadline) break;
    const c = WCHAINS[r.chain as keyof typeof WCHAINS];
    if (!c || c.kind !== "evm" || contracts[r.chain] !== getAddress(r.contract)) continue;
    stats.checked++;
    try {
      const res = await checkOne(c, r, account);
      if (res === "filled") stats.filled++;
    } catch (e) {
      stats.failed++;
      const attempts = r.attempts + 1;
      await sb.from("trade_orders").update({ status: attempts >= 5 ? "failed" : "open", attempts, note: `Couldn't fill: ${String((e as Error).message).slice(0, 140)}`, updated_at: new Date().toISOString() }).eq("id", r.id);
    }
  }
  return stats;
}

async function checkOne(c: WChain, r: Row, account: ReturnType<typeof privateKeyToAccount>): Promise<"waiting" | "filled"> {
  const sb = supabaseService();
  const note = (n: string) => sb.from("trade_orders").update({ note: n, updated_at: new Date().toISOString() }).eq("id", r.id);
  const pc = walletChainClient(c);
  const contract = getAddress(r.contract);
  const order = { maker: getAddress(r.maker), tokenIn: getAddress(r.token_in), tokenOut: (r.token_out === NATIVE ? NATIVE : getAddress(r.token_out)) as `0x${string}`, amountIn: BigInt(r.amount_in), minOut: BigInt(r.min_out), expiry: BigInt(r.expiry), nonce: BigInt(r.nonce) };
  const hash = hashTypedData({ domain: orderDomain(c.chainId!, contract), types: ORDER_TYPES, primaryType: "Order", message: order });
  const [done, balance, allowance, fee] = await Promise.all([
    pc.readContract({ address: contract, abi: ORDERS_ABI, functionName: "done", args: [hash] }),
    pc.readContract({ address: order.tokenIn, abi: ERC20, functionName: "balanceOf", args: [order.maker] }),
    pc.readContract({ address: order.tokenIn, abi: ERC20, functionName: "allowance", args: [order.maker, contract] }),
    pc.readContract({ address: contract, abi: ORDERS_ABI, functionName: "feeBps" }),
  ]);
  if (done) { await sb.from("trade_orders").update({ status: "cancelled", note: "Cancelled on-chain.", updated_at: new Date().toISOString() }).eq("id", r.id); return "waiting"; }
  if (balance < order.amountIn) { await note("Waiting: the wallet no longer has enough to fill this order."); return "waiting"; }
  if (allowance < order.amountIn) { await note("Waiting: the approval for this order was removed."); return "waiting"; }

  // Tokens with a transfer tax go straight through the DEX (the aggregator would expect the full amount).
  const risk = await riskOf(c, order.tokenIn);
  const taxed = risk.sellTax > 0 && !!c.v2Router;
  const afterTax = taxed ? (order.amountIn * BigInt(Math.round((100 - risk.sellTax) * 100))) / 10_000n : order.amountIn;
  const wrappedOut = order.tokenOut === NATIVE ? c.wrapped! : order.tokenOut;
  let router: `0x${string}`, data: `0x${string}` = "0x", path: `0x${string}`[] = [], est: bigint;
  if (taxed) {
    router = c.v2Router!;
    path = (order.tokenIn === getAddress(c.wrapped!) || wrappedOut === getAddress(c.wrapped!) ? [order.tokenIn, getAddress(wrappedOut)] : [order.tokenIn, getAddress(c.wrapped!), getAddress(wrappedOut)]) as `0x${string}`[];
    est = await v2AmountOut(c, afterTax, path);
  } else {
    const k = await kyberRoute(c, order.tokenIn, order.tokenOut, order.amountIn, contract, contract, r.kind === "stop" ? 300 : 50);
    router = KYBER_ROUTER; data = k.data; est = k.amountOut;
  }
  const estAfterFee = (est * (10_000n - BigInt(fee))) / 10_000n;
  if (!triggered(r.kind, estAfterFee, BigInt(r.trigger_out), order.minOut)) {
    const below = r.kind === "stop" && estAfterFee < order.minOut;
    await note(below ? "Waiting: the price is below the lowest price you accept." : "Waiting for your price.");
    return "waiting";
  }

  // Claim the order, simulate, then send. The contract re-checks everything on-chain.
  const { data: claimed } = await sb.from("trade_orders").update({ status: "filling", note: "Filling…", updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "open").select("id");
  if (!claimed?.length) return "waiting";
  const args = [order, r.signature as `0x${string}`, router, data, path] as const;
  try {
    await pc.simulateContract({ account, address: contract, abi: ORDERS_ABI, functionName: "fill", args });
  } catch (e) {
    await sb.from("trade_orders").update({ status: "open", note: "Waiting: the price moved before it could fill.", updated_at: new Date().toISOString() }).eq("id", r.id);
    return "waiting";
  }
  const w = createWalletClient({ account, chain: c.viem, transport: http(c.rpc, { timeout: 15_000 }) }) as any;
  const tx = await w.writeContract({ address: contract, abi: ORDERS_ABI, functionName: "fill", args });
  await sb.from("trade_orders").update({ tx_hash: tx, updated_at: new Date().toISOString() }).eq("id", r.id);
  const receipt = await pc.waitForTransactionReceipt({ hash: tx, timeout: 45_000 });
  if (receipt.status !== "success") throw new Error("the fill transaction reverted");
  let out: string | null = null;
  for (const l of receipt.logs) { try { const ev: any = decodeEventLog({ abi: ORDERS_ABI, data: l.data, topics: l.topics }); if (ev.eventName === "Filled") out = String(ev.args.amountOut); } catch { /* other logs */ } }
  await sb.from("trade_orders").update({ status: "filled", note: "Filled.", out_amount: out, filled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", r.id);
  return "filled";
}
