import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { ACHAINS, goplus, isAChain, isChainAddress } from "@/lib/analytics";
import { detectChain } from "@/lib/analytics-detect";
import { solGoplus } from "@/lib/analytics-solana";
import { audit } from "@/lib/analytics-audit";
import { simulateHoneypot } from "@/lib/honeypot-sim";
import { rugcheck } from "@/lib/rugcheck";
import { getPairStats } from "@/lib/market";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The live scanner dashboard (components/HyperScanner.tsx): one quick, read-only scan of any token, no sign-in.
 * GoPlus + honeypot.is simulation + RugCheck (Solana) + DexScreener, graded by the same advanced audit the full
 * analysis uses. Nothing is saved; "Open full analysis" does the tracked scan (holders, dev, alerts).
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "scanner-quick", 30, 600);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const token = String(b?.token || "").trim();
  let chain = String(b?.chain || "auto");
  if (!token) return json({ error: "Paste a token address." }, 400);
  if (chain === "auto") {
    const found = await detectChain(token);
    if (!found) return json({ error: "Couldn't find that token on any network we scan. Check the address, or pick the network." }, 400);
    chain = found;
  }
  if (isAChain(chain) && !isChainAddress(chain, token) && isChainAddress("solana", token)) chain = "solana";
  if (!isAChain(chain) || !isChainAddress(chain, token)) return json({ error: "That address doesn't match the network. Check it, or pick Auto." }, 400);
  const c = ACHAINS[chain];
  const sol = c.kind === "solana";
  const [gp, move, sim, rug] = await Promise.all([
    (sol ? solGoplus(token) : goplus(chain, token)).catch(() => null),
    getPairStats(c.dex, token).catch(() => null),
    sol ? Promise.resolve(null) : simulateHoneypot(chain, token).catch(() => null),
    sol ? rugcheck(token) : Promise.resolve(null),
  ]);
  if (!gp && !move && !sim && !rug) return json({ error: `No data found for this address on ${c.name}. Check the network and the address.` }, 404);
  const s: any = gp?.security || {};
  const sec = { ...s, honeypot: s.honeypot === true || sim?.honeypot === true ? true : s.honeypot ?? sim?.honeypot ?? null, buyTax: sim?.buyTax ?? s.buyTax, sellTax: sim?.sellTax ?? s.sellTax };
  const holders = ((gp?.holders || []) as any[]).slice(0, 10);
  const people = holders.filter((h) => !h.isContract && !h.locked && h.pct != null);
  const topShare = people.length ? people.reduce((a, h) => a + (h.pct || 0), 0) : null;
  const creator = gp?.creator ? String(gp.creator).toLowerCase() : null;
  const report = audit({ security: sec, sim, move, topShare, devPct: s.creatorPct ?? null, solana: sol, rug });
  return json({
    chain, chainName: c.name, std: sol ? "SPL" : chain === "bsc" ? "BEP-20" : "ERC-20", token,
    name: move?.name || (gp as any)?.name || null, symbol: move?.symbol || (gp as any)?.symbol || null, logo: move?.imageUrl || null,
    move, report,
    holders: holders.slice(0, 7).map((h) => ({
      wallet: h.wallet, label: h.label || null, pct: h.pct ?? null,
      kind: h.locked ? "Locked" : h.isContract ? (h.label || "Contract") : creator && String(h.wallet).toLowerCase() === creator ? "Creator" : "Wallet",
    })),
  });
}
