/**
 * Tells the admin's activity view about a finished on-chain action (a swap, added liquidity, burned LP tokens).
 * Fire and forget: never waits, never throws, and sends only the chain, the transaction and a short description.
 */
export function reportActivity(kind: "swap" | "liquidity" | "lp-burn", chain: string, tx: string, label: string) {
  try {
    const body = JSON.stringify({ kind, chain, tx, label });
    fetch("/api/activity", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {}
}
