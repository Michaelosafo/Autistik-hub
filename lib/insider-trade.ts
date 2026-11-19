/**
 * Insider buys and sells with the owner's sniper wallets (the BSC Sniper desk keys).
 * Quotes are built together, signed, then broadcast together. Fee is 0: this is the owner's own money.
 * Solana sniper keys are not on this deploy, so a live Solana buy is refused and paper mode is used instead.
 */
import { createPublicClient, createWalletClient, erc20Abi, getAddress, http, isAddress, parseEther } from "viem";
import { LIQ_DESK } from "@/lib/ai-futures";
import { withTrader } from "@/lib/ai-trader-ctx";
import { copyKey } from "@/lib/ai-copy";
import { NATIVE, WCHAINS, type WChain } from "@/lib/wallet-chains";
import { build, quote, riskOf } from "@/lib/wallet-server";

const DESK = LIQ_DESK + 1;
const GAS: Record<string, string> = { bsc: "0.002", ethereum: "0.0015", base: "0.0004", arbitrum: "0.0004" };

export type TradeHit = { slot: number; wallet?: string; tx?: string; error?: string };

export function tradeChain(key: string): WChain | null {
  const c = (WCHAINS as Record<string, WChain | undefined>)[key];
  return c || null;
}

export async function gate(chain: string, token: string, maxTax: number): Promise<{ ok: boolean; reason: string }> {
  const c = tradeChain(chain);
  if (!c) return { ok: false, reason: `${chain} has no swap route on the sniper wallets.` };
  const r = await riskOf(c, token);
  if (r.honeypot) return { ok: false, reason: "GoPlus: honeypot." };
  if (r.buyTax > maxTax || r.sellTax > maxTax) return { ok: false, reason: `GoPlus tax ${r.buyTax}% buy / ${r.sellTax}% sell is over the ${maxTax}% limit.` };
  if (r.level === "danger") return { ok: false, reason: r.notes[0] || "GoPlus flagged this token." };
  return { ok: true, reason: "" };
}

async function nativePrice(c: WChain): Promise<number> {
  if (!c.wrapped) return 0;
  const j = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${c.wrapped}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null);
  const pairs = (j?.pairs || []) as { priceUsd?: string; liquidity?: { usd?: number } }[];
  pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  return Number(pairs[0]?.priceUsd) || 0;
}

function pub(c: WChain) {
  return createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 12_000 }) }) as any;
}

/** Quote and sign every wallet, then broadcast those signed buys together. */
export async function buyParallel(chain: string, token: string, usd: number, slots: number[]): Promise<TradeHit[]> {
  const c = tradeChain(chain);
  if (!c || c.kind !== "evm") {
    return slots.map((slot) => ({ slot, error: c ? "Live Solana buys need the sniper Solana key. This deploy records Solana only in paper mode." : "No route." }));
  }
  if (!isAddress(token)) return slots.map((slot) => ({ slot, error: "That isn't an EVM token address." }));
  const out = getAddress(token);
  const price = await nativePrice(c);
  if (!(price > 0) || !(usd > 0)) return slots.map((slot) => ({ slot, error: "No price for the chain's coin." }));
  const amountIn = parseEther((usd / price).toFixed(8));
  const gas = parseEther(GAS[chain] || "0.001");
  return withTrader(DESK, async () => {
    const client = pub(c);
    const prepared = await Promise.all(slots.map(async (slot): Promise<TradeHit & { raw?: `0x${string}` }> => {
      try {
        const a = await copyKey(slot);
        if (!a) return { slot, error: `Sniper wallet ${slot} has no key. Add it on Sniper (BSC).` };
        const bal = await client.getBalance({ address: a.address }) as bigint;
        if (bal < amountIn + gas) return { slot, wallet: a.address, error: `Wallet ${slot} needs the buy amount plus gas.` };
        const q = await quote(c, NATIVE, out, amountIn, 0);
        const tx = await build(c, q, a.address, 1500, true);
        if (tx.kind !== "evm") return { slot, wallet: a.address, error: "Unexpected route." };
        const w = createWalletClient({ account: a, chain: c.viem, transport: http(c.rpc, { timeout: 12_000 }) }) as any;
        const raw = await w.signTransaction({ account: a, chain: c.viem, to: tx.to, data: tx.data, value: BigInt(tx.value || "0") }) as `0x${string}`;
        return { slot, wallet: a.address, raw };
      } catch (e) {
        return { slot, error: (e as Error).message?.slice(0, 180) || "Quote failed." };
      }
    }));
    return Promise.all(prepared.map(async (p) => {
      if (!p.raw) return { slot: p.slot, wallet: p.wallet, error: p.error };
      try {
        const tx = await client.sendRawTransaction({ serializedTransaction: p.raw });
        return { slot: p.slot, wallet: p.wallet, tx: String(tx) };
      } catch (e) {
        return { slot: p.slot, wallet: p.wallet, error: (e as Error).message?.slice(0, 180) || "Broadcast failed." };
      }
    }));
  });
}

/** Sell `pct` of each wallet's balance of this token back to the chain's coin. */
export async function sellSlots(chain: string, token: string, slots: { slot: number }[], pct: number): Promise<TradeHit[]> {
  const c = tradeChain(chain);
  if (!c || c.kind !== "evm") return slots.map((s) => ({ slot: s.slot, error: "No live sell route for this chain." }));
  const share = Math.min(100, Math.max(1, Math.round(pct)));
  return withTrader(DESK, async () => {
    const client = pub(c);
    const signed: { slot: number; wallet: string; raw: `0x${string}` }[] = [];
    const failed: TradeHit[] = [];
    for (const { slot } of slots) {
      try {
        const a = await copyKey(slot);
        if (!a) { failed.push({ slot, error: `Wallet ${slot} has no key.` }); continue; }
        const bal = await client.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [a.address] }) as bigint;
        const amount = (bal * BigInt(share)) / 100n;
        if (amount <= 0n) { failed.push({ slot, wallet: a.address, error: "Nothing left to sell." }); continue; }
        const w = createWalletClient({ account: a, chain: c.viem, transport: http(c.rpc, { timeout: 12_000 }) }) as any;
        let q = await quote(c, token, NATIVE, amount, 0);
        let tx = await build(c, q, a.address, 2000, true);
        if (tx.kind !== "evm") { failed.push({ slot, wallet: a.address, error: "Unexpected route." }); continue; }
        if (tx.spender) {
          const allowance = await client.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [a.address, tx.spender] }) as bigint;
          if (allowance < amount) {
            const approve = await w.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [tx.spender, amount] });
            await client.waitForTransactionReceipt({ hash: approve });
            q = await quote(c, token, NATIVE, amount, 0);
            tx = await build(c, q, a.address, 2000, true);
            if (tx.kind !== "evm") { failed.push({ slot, wallet: a.address, error: "Unexpected route." }); continue; }
          }
        }
        const raw = await w.signTransaction({ account: a, chain: c.viem, to: tx.to, data: tx.data, value: BigInt(tx.value || "0") }) as `0x${string}`;
        signed.push({ slot, wallet: a.address, raw });
      } catch (e) {
        failed.push({ slot, error: (e as Error).message?.slice(0, 180) || "Sell failed." });
      }
    }
    const sent = await Promise.all(signed.map(async (p) => {
      try {
        const tx = await client.sendRawTransaction({ serializedTransaction: p.raw });
        return { slot: p.slot, wallet: p.wallet, tx: String(tx) };
      } catch (e) {
        return { slot: p.slot, wallet: p.wallet, error: (e as Error).message?.slice(0, 180) || "Broadcast failed." };
      }
    }));
    return [...failed, ...sent];
  });
}
