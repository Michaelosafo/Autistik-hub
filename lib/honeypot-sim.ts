/**
 * A second, independent honeypot check: honeypot.is simulates a real buy and sell of the token (free, no key) and
 * tests whether recent holders could sell. EVM only (Ethereum, BNB Chain, Base). Cached for 10 minutes; null when
 * the chain isn't covered or the service doesn't answer, so the scanner never depends on it.
 */
const CHAIN_ID: Record<string, number> = { ethereum: 1, bsc: 56, base: 8453 };

export type HoneypotSim = {
  honeypot: boolean | null; buyTax: number | null; sellTax: number | null; transferTax: number | null;
  /** Recent holders tested: how many could sell, how many couldn't. */
  holdersTested: number | null; holdersFailed: number | null; highestTax: number | null;
  reason: string | null; risk: string | null;
};

const num = (v: unknown) => { const n = Number(v); return v === null || v === undefined || v === "" || !isFinite(n) ? null : n; };

export async function simulateHoneypot(chain: string, token: string): Promise<HoneypotSim | null> {
  const id = CHAIN_ID[chain];
  if (!id || !/^0x[0-9a-fA-F]{40}$/.test(token)) return null;
  try {
    const r = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${id}`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000), next: { revalidate: 600 },
    } as RequestInit);
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.simulationSuccess === false && !d?.honeypotResult) return null;
    const h = d?.holderAnalysis || {};
    return {
      honeypot: typeof d?.honeypotResult?.isHoneypot === "boolean" ? d.honeypotResult.isHoneypot : null,
      buyTax: num(d?.simulationResult?.buyTax), sellTax: num(d?.simulationResult?.sellTax), transferTax: num(d?.simulationResult?.transferTax),
      holdersTested: num(h.holders), holdersFailed: num(h.failed), highestTax: num(h.highestTax),
      reason: typeof d?.honeypotResult?.honeypotReason === "string" ? d.honeypotResult.honeypotReason.slice(0, 160) : null,
      risk: typeof d?.summary?.risk === "string" ? d.summary.risk : null,
    };
  } catch { return null; }
}
