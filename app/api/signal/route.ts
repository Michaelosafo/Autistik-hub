import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { bgwCall } from "@/lib/bitget-swap";
import { lifiRoute, lifiStatus, okxReady, okxRoute, type ChainKey } from "@/lib/signal-routers";

/**
 * Signal (owner only): swaps and bridges routed through Bitget Wallet's swap service. This route only talks to
 * Bitget (quotes, the order to sign, its status); the owner's own wallet signs and sends in the browser, and the
 * coins go to the address the owner picks. No keys here.
 *
 * POST { action: "search" | "quote" | "order" | "status", ... }
 */
export const dynamic = "force-dynamic";

const CHAINS = new Set(["bnb", "eth", "base", "arbitrum", "matic", "sol"]);
const okAddr = (chain: string, a: unknown) => typeof a === "string" && (chain === "sol" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) : /^0x[0-9a-fA-F]{40}$/.test(a));
const okToken = (chain: string, c: unknown) => c === "" || okAddr(chain, c);
const amt = (v: unknown) => { const s = String(v ?? "").trim(); return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? s : null; };
const str = (v: unknown, max = 24) => String(v ?? "").slice(0, max);

export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "search") {
      const keyword = str(b.keyword, 64).trim();
      if (!keyword) return json({ list: [] });
      const chain = CHAINS.has(b.chain) ? b.chain : undefined;
      const d = await bgwCall("/market/v2/search/tokens", chain ? { keyword, chain } : { keyword });
      const list = (d?.list || []).filter((t: any) => CHAINS.has(t.chain)).slice(0, 20).map((t: any) => ({
        chain: t.chain, contract: t.contract || "", symbol: t.symbol, name: t.name, icon: t.icon || t.logo || "", price: Number(t.price) || 0,
      }));
      return json({ list });
    }

    // Quote and order share these fields; every one is checked before it goes to Bitget.
    const f = {
      fromChain: str(b.fromChain), fromSymbol: str(b.fromSymbol), fromContract: str(b.fromContract, 64), fromAmount: amt(b.fromAmount), fromAddress: str(b.fromAddress, 64),
      toChain: str(b.toChain), toSymbol: str(b.toSymbol), toContract: str(b.toContract, 64), toAddress: str(b.toAddress, 64),
    };
    if (b.action === "quote" || b.action === "order") {
      if (!CHAINS.has(f.fromChain) || !CHAINS.has(f.toChain)) return json({ error: "That network isn't supported here." }, 400);
      if (!f.fromAmount) return json({ error: "Enter an amount." }, 400);
      if (!okToken(f.fromChain, f.fromContract) || !okToken(f.toChain, f.toContract)) return json({ error: "That token address doesn't look right." }, 400);
      if (!okAddr(f.fromChain, f.fromAddress)) return json({ error: "Connect a wallet on the network you're paying from." }, 400);
      if (!okAddr(f.toChain, f.toAddress)) return json({ error: `The receiving address isn't a ${f.toChain === "sol" ? "Solana" : "EVM"} address.` }, 400);
    }
    const slip = String(Math.min(49, Math.max(0.1, Number(b.slippage) || 1)));

    if (b.action === "routers") return json({ okx: okxReady() });
    // LI.FI and OKX: the route comes with its transaction ready to sign.
    if (b.action === "quote" && (b.router === "lifi" || b.router === "okx")) {
      const q = { fromChain: f.fromChain as ChainKey, fromContract: f.fromContract, fromAmount: f.fromAmount!, fromAddress: f.fromAddress, toChain: f.toChain as ChainKey, toContract: f.toContract, toAddress: f.toAddress, slippage: Number(slip) };
      const r = b.router === "lifi" ? await lifiRoute(q) : await okxRoute(q);
      return json({ routes: [r] });
    }
    if (b.action === "quote") {
      const d = await bgwCall("/swap-go/swapx/quote", { ...f, tab_type: "swap", publicKey: "", slippage: "", requestId: String(Date.now()) });
      const routes = (d?.quoteResults || []).map((q: any) => ({
        market: q.market?.id, protocol: q.market?.protocol || q.protocol || "", label: q.market?.label || q.market?.id,
        out: q.outAmount, min: q.minAmount, gasUsd: q.gasFees?.gasTotalAmountUsd ?? q.gasFees?.gasTotalUsd ?? null,
        slip: q.slippageInfo?.recommendSlippage ?? null, features: q.features || [],
      })).filter((r: any) => r.market);
      return json({ routes });
    }

    if (b.action === "order") {
      const market = str(b.market, 64), protocol = str(b.protocol, 96);
      if (!market) return json({ error: "Pick a route first." }, 400);
      const cf = await bgwCall("/swap-go/swapx/confirm", {
        ...f, market, protocol, slippage: slip, recommendSlippage: slip, gasLevel: "fast", features: ["user_gas"], lastOutAmount: str(b.lastOut, 40),
        mevProtection: { chain: f.fromChain, mevFee: "0", amountMin: f.fromAmount, mevTarget: true, mode: "smart" },
      });
      if (!cf?.orderId) return json({ error: "Bitget Wallet didn't give an order. Get a new quote." }, 502);
      // makeOrder comes back signed by Bitget; bgwCall checks those signatures before anything is shown to sign.
      const o = await bgwCall("/swap-go/swapx/makeOrder", { orderId: cf.orderId, ...f, slippage: slip, market, protocol, source: "agent" }, true);
      return json({ orderId: o?.orderId || cf.orderId, txs: o?.txs || [], quote: cf.quoteResult || null });
    }

    if (b.action === "status" && b.router === "lifi") return json(await lifiStatus(str(b.txHash, 120), str(b.fromChain), str(b.toChain)));
    if (b.action === "status") {
      const d = await bgwCall("/swap-go/swapx/getOrderDetails", { orderId: str(b.orderId, 96) });
      const det = d?.details || {};
      return json({ status: det.status || "pending", fromTx: det.fromTxId || null, toTx: det.toTxId || null, tips: d?.tips || null });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message.slice(0, 300) }, 502);
  }
}
