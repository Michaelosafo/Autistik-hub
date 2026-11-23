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

// ---- balances: the chain's own coin and USDT on every network Signal supports (read straight from public nodes)
const USDT: Record<string, { c: string; d: number }> = {
  bnb: { c: "0x55d398326f99059fF775485246999027B3197955", d: 18 }, eth: { c: "0xdAC17F958D2ee523a2206206994597C13D831ec7", d: 6 },
  base: { c: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", d: 6 }, arbitrum: { c: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", d: 6 },
  matic: { c: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", d: 6 }, sol: { c: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", d: 6 },
};
const NATIVE: Record<string, { s: string; d: number }> = { bnb: { s: "BNB", d: 18 }, eth: { s: "ETH", d: 18 }, base: { s: "ETH", d: 18 }, arbitrum: { s: "ETH", d: 18 }, matic: { s: "POL", d: 18 }, sol: { s: "SOL", d: 9 } };
const RPC: Record<string, string[]> = {
  bnb: [process.env.NEXT_PUBLIC_BSC_RPC || "", "https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"],
  eth: [process.env.NEXT_PUBLIC_ETHEREUM_RPC || "", "https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  base: [process.env.NEXT_PUBLIC_BASE_RPC || "", "https://mainnet.base.org", "https://base-rpc.publicnode.com"],
  arbitrum: [process.env.NEXT_PUBLIC_ARBITRUM_RPC || "", "https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
  matic: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"],
  sol: [process.env.SOLANA_RPC_URL || "", process.env.NEXT_PUBLIC_SOLANA_RPC || "", "https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"],
};
async function rpc(chain: string, method: string, params: unknown[]) {
  for (const url of RPC[chain].filter(Boolean)) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d && !d.error && d.result !== undefined) return d.result;
    } catch { /* next node */ }
  }
  throw new Error("node unreachable");
}
const human = (raw: bigint, dec: number) => { const s = raw.toString().padStart(dec + 1, "0"); const i = s.slice(0, -dec), f = s.slice(-dec).replace(/0+$/, ""); return f ? `${i}.${f}` : i; };
async function balancesFor(evm: string, sol: string) {
  const jobs: Promise<{ chain: string; symbol: string; contract: string; amount: string } | null>[] = [];
  for (const chain of ["bnb", "eth", "base", "arbitrum", "matic"]) {
    if (!evm) break;
    jobs.push(rpc(chain, "eth_getBalance", [evm, "latest"]).then((h) => ({ chain, symbol: NATIVE[chain].s, contract: "", amount: human(BigInt(h), 18) })).catch(() => null));
    jobs.push(rpc(chain, "eth_call", [{ to: USDT[chain].c, data: "0x70a08231" + evm.toLowerCase().replace(/^0x/, "").padStart(64, "0") }, "latest"])
      .then((h) => ({ chain, symbol: "USDT", contract: USDT[chain].c, amount: human(BigInt(h === "0x" ? "0x0" : h), USDT[chain].d) })).catch(() => null));
  }
  if (sol) {
    jobs.push(rpc("sol", "getBalance", [sol]).then((r) => ({ chain: "sol", symbol: "SOL", contract: "", amount: human(BigInt(r?.value ?? 0), 9) })).catch(() => null));
    jobs.push(rpc("sol", "getTokenAccountsByOwner", [sol, { mint: USDT.sol.c }, { encoding: "jsonParsed" }]).then((r) => {
      let raw = 0n;
      for (const a of r?.value || []) raw += BigInt(a?.account?.data?.parsed?.info?.tokenAmount?.amount || "0");
      return { chain: "sol", symbol: "USDT", contract: USDT.sol.c, amount: human(raw, 6) };
    }).catch(() => null));
  }
  return (await Promise.all(jobs)).filter((x): x is NonNullable<typeof x> => !!x && Number(x.amount) > 0);
}

// Bitget's Solana orders: the unsigned transaction can sit under different keys (data.serializedTx, deriveTransaction,
// a plain string…) and be base58 (v0) or base64 (v1). Find it wherever it is and hand the page plain base64.
const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Buffer {
  let n = 0n;
  for (const ch of s) { const i = B58A.indexOf(ch); if (i < 0) throw new Error("bad base58"); n = n * 58n + BigInt(i); }
  const out: number[] = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of s) { if (ch !== "1") break; out.unshift(0); }
  return Buffer.from(out);
}
function solTxB64(t: any): string | null {
  const seen = new Set<any>();
  const hits: { v: string; enc?: string }[] = [];
  const walk = (o: any, enc?: string, depth = 0) => {
    if (!o || depth > 6 || seen.has(o)) return;
    if (typeof o === "string") { if (o.length > 150) hits.push({ v: o, enc }); return; }
    if (typeof o !== "object") return;
    seen.add(o);
    const e = typeof o.encoding === "string" ? o.encoding.toLowerCase() : enc;
    for (const k of ["serializedTx", "serializedTransaction", "tx", "transaction", "rawTx", "data"]) if (typeof o[k] === "string") walk(o[k], e, depth + 1);
    for (const v of Object.values(o)) walk(v, e, depth + 1);
  };
  walk(t);
  for (const h of hits) {
    const s = h.v.trim();
    try {
      if (h.enc === "base64" || (!h.enc && /[+/=]/.test(s) && /^[A-Za-z0-9+/=]+$/.test(s))) { if (Buffer.from(s, "base64").length > 100) return s; }
      else if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) { const b = b58decode(s); if (b.length > 100) return b.toString("base64"); }
      else if (/^[A-Za-z0-9+/=]+$/.test(s)) { if (Buffer.from(s, "base64").length > 100) return s; }
    } catch { /* try the next one */ }
  }
  return null;
}

export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "balances") {
      const evm = /^0x[0-9a-fA-F]{40}$/.test(String(b.evm ?? "")) ? String(b.evm) : "";
      const sol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(b.sol ?? "")) ? String(b.sol) : "";
      return json({ list: await balancesFor(evm, sol) });
    }
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
      const txs = o?.txs || [];
      if (f.fromChain === "sol") {
        const solTxs = txs.map(solTxB64);
        if (!txs.length || solTxs.some((x: string | null) => !x)) {
          console.error("signal sol order shape", JSON.stringify(txs).slice(0, 1500));
          return json({ error: "Bitget Wallet's Solana order came back in a shape Signal can't read. Try Jupiter via LI.FI for now." }, 502);
        }
        return json({ orderId: o?.orderId || cf.orderId, txs, solTxs, quote: cf.quoteResult || null });
      }
      return json({ orderId: o?.orderId || cf.orderId, txs, quote: cf.quoteResult || null });
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
