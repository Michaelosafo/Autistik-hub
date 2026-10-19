import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { isMomentumChain } from "@/lib/momentum";
import { discover } from "@/lib/momentum-server";
import { MAX_SLIPPAGE_BPS, WCHAINS, isTokenAddress, isWChain } from "@/lib/wallet-chains";
import { balances, build, market, quote, solBroadcast, solStatus, solTransfer, tokenInfo, type Quote } from "@/lib/wallet-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIMITS: Record<string, [number, number]> = {
  token: [60, 60], market: [90, 60], discover: [60, 60], balances: [40, 60], quote: [60, 60], build: [20, 60], "sol-transfer": [10, 60], "sol-send": [15, 60], "sol-status": [90, 60],
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
  const chain = isWChain(b?.chain) ? WCHAINS[b.chain as keyof typeof WCHAINS] : null;
  if (!chain && !["sol-send", "sol-status"].includes(action)) return json({ error: "Pick a network." }, 400);

  try {
    switch (action) {
      case "token": {
        if (!isTokenAddress(chain!, b.address)) return json({ error: `That isn't a ${chain!.name} token address.` }, 400);
        const t = await tokenInfo(chain!, b.address);
        return t ? json({ token: t }) : json({ error: `No token found at that address on ${chain!.name}.` }, 404);
      }
      case "discover": {
        if (!isMomentumChain(chain!.key)) return json({ trending: [], fresh: [] });
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
        return json({ quote: await quote(chain!, b.tokenIn, b.tokenOut, BigInt(b.amount)) });
      }
      case "build": {
        const q = b.quote as Quote;
        if (!q || q.chain !== chain!.key || !isTokenAddress(chain!, b.from)) return json({ error: "Get a new quote and try again." }, 400);
        const slip = Math.round(Number(b.slippageBps));
        if (!(slip >= 10 && slip <= MAX_SLIPPAGE_BPS)) return json({ error: `Slippage must be between 0.1% and ${MAX_SLIPPAGE_BPS / 100}%.` }, 400);
        return json({ tx: await build(chain!, q, b.from, slip) });
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
