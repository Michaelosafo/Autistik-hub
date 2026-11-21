/**
 * RugCheck (free, no key) for Solana tokens: mint / freeze authority, transfer fee, how much of the pool is locked,
 * top holders and RugCheck's own risk flags. Brought over from the safemoon.ai scanner. Cached 5 minutes.
 */
export type RugReport = {
  mintAuthority: boolean; freezeAuthority: boolean; transferFeePct: number; lpLockedPct: number | null;
  top10Pct: number | null; risks: { name: string; level: "danger" | "warn"; detail: string }[];
};
const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };

export async function rugcheck(mint: string): Promise<RugReport | null> {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (!j || typeof j !== "object") return null;
    const markets: any[] = Array.isArray(j.markets) ? j.markets : [];
    const top: any[] = Array.isArray(j.topHolders) ? j.topHolders : [];
    return {
      mintAuthority: !!j.mintAuthority,
      freezeAuthority: !!j.freezeAuthority,
      transferFeePct: num(j.transferFee?.pct),
      lpLockedPct: markets.length ? markets.reduce((a, m) => Math.max(a, num(m?.lp?.lpLockedPct)), 0) : null,
      top10Pct: top.length ? top.slice(0, 10).reduce((a, h) => a + num(h?.pct), 0) : null,
      risks: (Array.isArray(j.risks) ? j.risks : [])
        .filter((x: any) => x?.name && !/mint authority|freeze authority/i.test(String(x.name)))
        .slice(0, 8)
        .map((x: any) => ({ name: String(x.name).slice(0, 60), level: x.level === "danger" ? "danger" : "warn", detail: String(x.description || x.value || "").slice(0, 140) })),
    };
  } catch { return null; }
}
