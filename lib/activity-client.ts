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

/**
 * After liquidity goes in through the Hub: puts the token on the Hub's list (Trending, New listings). The server
 * checks the transaction on-chain first. Quietly does nothing if it can't (the liquidity is in either way).
 */
export async function autoList(chain: string, token: string, tx: string, pool?: string): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch("/api/launchpad/auto-list", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token, tx, pool }) });
      if (r.ok) return true;
      if (r.status !== 502) return false;
    } catch {}
    await new Promise((res) => setTimeout(res, 4000));
  }
  return false;
}
