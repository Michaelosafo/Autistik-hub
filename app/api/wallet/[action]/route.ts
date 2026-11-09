import { json } from "@/lib/ai";
import { detectChain } from "@/lib/analytics-detect";
import { rateLimit } from "@/lib/ratelimit";
import { isMomentumChain } from "@/lib/momentum";
import { discover } from "@/lib/momentum-server";
import { FEE_BPS, MAX_SLIPPAGE_BPS, WCHAINS, isTokenAddress, isWChain } from "@/lib/wallet-chains";
import { megafuelCheck, megafuelSend, ultraExecute, ultraSwap } from "@/lib/gasless";
import { CHAT_FEE_BPS, balances, build, market, quote, solBroadcast, solStatus, solTransfer, tokenInfo, type Quote } from "@/lib/wallet-server";
import { XCHAINS, isXAddress, isXChain } from "@/lib/bridge-chains";
import { xChainLogos, xDetect, xQuote, xStatus, xTokens } from "@/lib/bridge-server";
import { fundingChoices, planSwap, type SwapAsk } from "@/lib/swap-plan";
import { relayStatus } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITS: Record<string, [number, number]> = {
  token: [60, 60], market: [90, 60], discover: [60, 60], balances: [40, 60], quote: [60, 60], build: [20, 60], "sol-transfer": [10, 60], "sol-send": [15, 60], "sol-status": [90, 60], "sol-ultra": [15, 60], "gas-check": [40, 60], "gas-send": [20, 60],
  detect: [40, 60], "x-chains": [30, 60], "x-tokens": [60, 60], "x-quote": [40, 60], "x-status": [90, 60], "x-detect": [40, 60], "x-plan": [15, 60], "x-fund": [15, 60], "x-relay-status": [90, 60],
};

/**
 * AUTISTIK Wallet API. Read-only lookups (token, balances, quote) and transaction building. Nothing here can move
 * anyone's money: every transaction is signed in the member's own wallet, and swaps always pay out to that wallet.
 */
export async function POST(req: Request, { params }: { params: { action: string } }) {
  const action = params.action;
  if (!LIMITS[action]) return json({ error: "Not found." }, 404);
  const limited = await rateLimit(req, `wallet-${action}`, ...LIMITS[action]);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  if (action.startsWith("x-")) return cross(action, b);
  // A pasted contract address: which network it's on, what it is, its price and safety check (the trading bot).
  if (action === "detect") {
    const raw = String(b?.address || "").trim().slice(0, 64);
    try {
      const k = await detectChain(raw);
      if (!k || !isWChain(k)) return json({ error: "Couldn't find that coin on BNB Chain, Base, Ethereum, Arbitrum or Solana. Check the address." }, 404);
      const c = WCHAINS[k as keyof typeof WCHAINS];
      const [t, m] = await Promise.all([tokenInfo(c, raw), market(c, raw).catch(() => null)]);
      if (!t) return json({ error: `No token found at that address on ${c.name}.` }, 404);
      return json({ chain: c.key, token: t, market: m });
    } catch (e) { return json({ error: (e as Error).message || "Couldn't look that coin up. Try again." }, 502); }
  }
  const chain = isWChain(b?.chain) ? WCHAINS[b.chain as keyof typeof WCHAINS] : null;
  if (!chain && !["sol-send", "sol-status", "sol-ultra", "gas-send"].includes(action)) return json({ error: "Pick a network." }, 400);

  try {
    switch (action) {
      case "token": {
        if (!isTokenAddress(chain!, b.address)) return json({ error: `That isn't a ${chain!.name} token address.` }, 400);
        const t = await tokenInfo(chain!, b.address);
        return t ? json({ token: t }) : json({ error: `No token found at that address on ${chain!.name}.` }, 404);
      }
      case "discover": {
        if (!isMomentumChain(chain!.key)) return json({ trending: [], fresh: [], listed: [] });
        return json(await discover(chain!.key));
      }
      case "market": {
        if (!isTokenAddress(chain!, b.token)) return json({ error: "Pick a token." }, 400);
        return json({ market: await market(chain!, b.token) });
      }
      case "balances": {
        if (!isTokenAddress(chain!, b.owner)) return json({ error: "That isn't a wallet address." }, 400);
        const extra = Array.isArray(b.extra) ? b.extra.filter((a: unknown) => isTokenAddress(chain!, a)).slice(0, 25) : [];
        return json({ holdings: await balances(chain!, b.owner, extra) });
      }
      case "quote": {
        if (!isTokenAddress(chain!, b.tokenIn) || !isTokenAddress(chain!, b.tokenOut)) return json({ error: "Pick both tokens." }, 400);
        if (b.tokenIn.toLowerCase() === b.tokenOut.toLowerCase()) return json({ error: "Pick two different tokens." }, 400);
        if (!/^\d{1,78}$/.test(String(b.amount)) || BigInt(b.amount) <= 0n) return json({ error: "Enter an amount." }, 400);
        // From the AI chat (b.chat): the chat's fee to the marketing wallet.
        return json({ quote: await quote(chain!, b.tokenIn, b.tokenOut, BigInt(b.amount), b.chat === true ? CHAT_FEE_BPS : FEE_BPS) });
      }
      case "build": {
        const q = b.quote as Quote;
        if (!q || q.chain !== chain!.key || !isTokenAddress(chain!, b.from)) return json({ error: "Get a new quote and try again." }, 400);
        const slip = Math.round(Number(b.slippageBps));
        if (!(slip >= 10 && slip <= MAX_SLIPPAGE_BPS)) return json({ error: `Slippage must be between 0.1% and ${MAX_SLIPPAGE_BPS / 100}%.` }, 400);
        // Solana with no AUTISTIK fee: Jupiter Ultra, so the network fee can be paid by Jupiter or by AUTISTIK.
        if (chain!.kind === "solana" && FEE_BPS === 0 && !q.feeBps) return json({ tx: await ultraSwap(q.tokenIn, q.tokenOut, BigInt(q.amountIn), b.from) });
        return json({ tx: await build(chain!, q, b.from, slip) });
      }
      case "sol-ultra": {
        if (typeof b.tx !== "string" || b.tx.length > 4000 || !/^[A-Za-z0-9+/=]+$/.test(b.tx) || typeof b.requestId !== "string" || b.requestId.length > 200) return json({ error: "Bad transaction." }, 400);
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(b.from || ""))) return json({ error: "Bad wallet." }, 400);
        return json({ signature: await ultraExecute(b.tx, b.requestId, !!b.sponsored, b.from) });
      }
      case "gas-check": {
        const t = b.tx || {};
        const hex = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{0,64000}$/.test(v);
        if (chain!.key !== "bsc" || !isTokenAddress(chain!, t.from) || !isTokenAddress(chain!, t.to) || !hex(t.data) || !hex(t.value) || !hex(t.gas)) return json({ sponsorable: false });
        return json(await megafuelCheck(t));
      }
      case "gas-send": {
        if (typeof b.raw !== "string" || !/^0x[0-9a-fA-F]{100,200000}$/.test(b.raw)) return json({ error: "Bad transaction." }, 400);
        return json({ hash: await megafuelSend(b.raw) });
      }
      case "sol-transfer": {
        if (chain!.kind !== "solana") return json({ error: "Solana only." }, 400);
        if (!isTokenAddress(chain!, b.mint) || !/^\d{1,30}$/.test(String(b.amount)) || BigInt(b.amount) <= 0n) return json({ error: "Enter an amount." }, 400);
        const dec = Number(b.decimals);
        if (!(dec >= 0 && dec <= 18)) return json({ error: "Unknown token." }, 400);
        return json({ tx: await solTransfer(b.from, b.to, b.mint, BigInt(b.amount), dec) });
      }
      case "sol-send": {
        if (typeof b.tx !== "string" || b.tx.length > 3000 || !/^[A-Za-z0-9+/=]+$/.test(b.tx)) return json({ error: "Bad transaction." }, 400);
        return json({ signature: await solBroadcast(b.tx) });
      }
      case "sol-status": {
        if (typeof b.sig !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(b.sig)) return json({ error: "Bad signature." }, 400);
        return json({ status: await solStatus(b.sig) });
      }
    }
  } catch (e: any) {
    const msg = String(e?.message || "");
    console.error(`wallet ${action}:`, msg.slice(0, 300));
    // Show the swap services' plain messages; hide anything technical.
    const friendly = /route|liquidity|amount|insufficient|slippage|price|token|swap|found|Solana|address/i.test(msg) && msg.length < 160 ? msg : "Something went wrong. Please try again.";
    return json({ error: friendly }, 502);
  }
  return json({ error: "Not found." }, 404);
}

/** Swaps across networks (LI.FI). Same rules: read-only, and every route pays out to the address the member picked. */
async function cross(action: string, b: any) {
  try {
    switch (action) {
      case "x-chains": return json({ logos: await xChainLogos() });
      case "x-detect": {
        const d = await xDetect(String(b.address || "").slice(0, 64));
        return d ? json(d) : json({ error: "Couldn't find that coin on any network. Check the address." }, 404);
      }
      case "x-tokens": {
        if (!isXChain(b.chain)) return json({ error: "Pick a network." }, 400);
        return json({ tokens: await xTokens(XCHAINS[b.chain], String(b.q || "").slice(0, 64)) });
      }
      case "x-quote": {
        if (!isXChain(b.fromChain) || !isXChain(b.toChain)) return json({ error: "Pick both networks." }, 400);
        const from = XCHAINS[b.fromChain], to = XCHAINS[b.toChain];
        if (!isXAddress(from, b.fromToken) || !isXAddress(to, b.toToken)) return json({ error: "Pick both coins." }, 400);
        if (from.id === to.id && b.fromToken.toLowerCase() === b.toToken.toLowerCase()) return json({ error: "Pick two different coins." }, 400);
        if (!isXAddress(from, b.fromAddress)) return json({ error: `Connect a ${from.name} wallet.` }, 400);
        if (!isXAddress(to, b.toAddress)) return json({ error: `Enter a ${to.name} address to receive the coins.` }, 400);
        if (!/^\d{1,78}$/.test(String(b.amount)) || BigInt(b.amount) <= 0n) return json({ error: "Enter an amount." }, 400);
        const slip = Math.round(Number(b.slippageBps));
        if (!(slip >= 10 && slip <= MAX_SLIPPAGE_BPS)) return json({ error: `Slippage must be between 0.1% and ${MAX_SLIPPAGE_BPS / 100}%.` }, 400);
        return json({ quote: await xQuote({ from, to, fromToken: b.fromToken, toToken: b.toToken, amount: BigInt(b.amount), fromAddress: b.fromAddress, toAddress: b.toAddress, slippageBps: slip }) });
      }
      case "x-plan": {
        // Swap by message: every route for what the member typed, cheapest first, paying out only to their own wallets.
        const text = String(b.text || "").slice(0, 400);
        const evm = typeof b.evm === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.evm) ? b.evm : null;
        const sol = typeof b.sol === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.sol) ? b.sol : null;
        if (!evm && !sol) return json({ error: "Connect a wallet first." }, 400);
        // A request worked out already (a buy, after the member picked what to pay with), or the text to read.
        if (b.ask) {
          const a = b.ask, sym = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9.]{1,12}$/.test(v) ? v.toUpperCase() : null);
          const key = (v: unknown) => (typeof v === "string" && /^[a-z]{2,12}$/.test(v) ? v : null);
          const amount = Number(a.amount);
          if (!(amount > 0 && amount <= 1_000_000) || !["coin", "usd"].includes(a.unit) || !sym(a.from)) return json({ error: "Bad request." }, 400);
          if (a.toAddress != null && !/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(String(a.toAddress))) return json({ error: "Bad coin address." }, 400);
          const ask: SwapAsk = { amount, unit: a.unit, from: sym(a.from)!, fromChain: key(a.fromChain), to: sym(a.to) || "", toChain: key(a.toChain), toAddress: a.toAddress ?? null };
          return json({ plan: await planSwap(ask, { evm, sol }) });
        }
        if (!text.trim()) return json({ error: "Tell me what to swap." }, 400);
        return json({ plan: await planSwap(text, { evm, sol }) });
      }
      case "x-fund": {
        const evm = typeof b.evm === "string" && /^0x[0-9a-fA-F]{40}$/.test(b.evm) ? b.evm : null;
        const sol = typeof b.sol === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.sol) ? b.sol : null;
        const usd = Number(b.usd);
        if (!evm && !sol) return json({ error: "Connect a wallet first." }, 400);
        if (!(usd > 0 && usd <= 1_000_000) || !/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(String(b.ca))) return json({ error: "Bad request." }, 400);
        return json(await fundingChoices(String(b.ca), usd, { evm, sol }));
      }
      case "x-relay-status": {
        if (typeof b.requestId !== "string" || !/^[0-9a-zA-Z]{10,100}$/.test(b.requestId)) return json({ error: "Bad request." }, 400);
        return json({ status: await relayStatus(b.requestId) });
      }
      case "x-status": {
        if (!isXChain(b.fromChain) || !isXChain(b.toChain) || typeof b.hash !== "string" || !/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/.test(b.hash)) return json({ error: "Bad transfer." }, 400);
        return json({ status: await xStatus(b.hash, b.fromChain, b.toChain, String(b.tool || "")) });
      }
    }
  } catch (e: any) {
    const msg = String(e?.message || "");
    console.error(`wallet ${action}:`, msg.slice(0, 300));
    return json({ error: msg && msg.length < 160 ? msg : "Something went wrong. Please try again." }, 502);
  }
  return json({ error: "Not found." }, 404);
}
