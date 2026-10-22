import type { LpLock } from "@/lib/locker-server";

export type TrustCheck = { key: string; name: string; state: "ok" | "warn" | "bad"; text: string };
export type Trust = {
  score: number | null; level: "good" | "some" | "bad" | "unknown"; title: string;
  checks: TrustCheck[]; known: number; total: number;
};

type Sec = {
  honeypot?: boolean | null; buyTax?: number | null; sellTax?: number | null; mintable?: boolean | null; openSource?: boolean | null;
  canTakeBack?: boolean | null; hiddenOwner?: boolean | null; freezable?: boolean | null; lp?: LpLock | null;
};

/**
 * One 0–100 trust score from the scan's safety checks. Each check earns part of its weight (full, half or none);
 * checks we couldn't read are left out and the rest scaled up, so a Solana token isn't punished for having no tax data.
 * A honeypot always scores very low, whatever else looks fine.
 */
export function trustScore({ security, topShare, bundle }: { security: Sec | null; topShare: number | null; bundle: "low" | "some" | "high" | null }): Trust {
  const s = security || {};
  const items: (TrustCheck & { weight: number; earn: number })[] = [];
  const add = (key: string, name: string, weight: number, earn: number, text: string) =>
    items.push({ key, name, weight, earn, text, state: earn >= 1 ? "ok" : earn > 0 ? "warn" : "bad" });

  if (s.honeypot != null) add("honeypot", "Honeypot", 25, s.honeypot ? 0 : 1, s.honeypot ? "You may not be able to sell" : "You can sell");
  const tax = s.buyTax == null && s.sellTax == null ? null : Math.max(s.buyTax ?? 0, s.sellTax ?? 0);
  if (tax != null) add("tax", "Taxes", 15, tax <= 5 ? 1 : tax <= 10 ? 0.5 : 0, `${Math.round(s.buyTax ?? 0)}% buy / ${Math.round(s.sellTax ?? 0)}% sell`);
  const owner = s.canTakeBack == null && s.hiddenOwner == null ? null : !!(s.canTakeBack || s.hiddenOwner);
  if (owner != null) add("owner", "Ownership", 10, owner ? 0 : 1, owner ? (s.hiddenOwner ? "Has a hidden owner" : "Can be taken back") : "Can't be taken back");
  if (s.mintable != null) add("mint", "Mint", 15, s.mintable ? 0 : 1, s.mintable ? "Owner can make new tokens" : "No new tokens can be made");
  if (s.freezable != null) add("freeze", "Freeze", 10, s.freezable ? 0 : 1, s.freezable ? "Owner can freeze wallets" : "Wallets can't be frozen");
  if (s.openSource != null) add("code", "Code", 5, s.openSource ? 1 : 0, s.openSource ? "Public" : "Hidden");
  if (s.lp) {
    const safe = Math.min(100, s.lp.locked + s.lp.burned);
    add("lp", "Liquidity lock", 15, safe >= 90 ? 1 : safe >= 50 ? 0.5 : 0, `${Math.round(safe)}% locked or burned`);
  }
  if (topShare != null && topShare > 0) add("holders", "Top holders", 15, topShare <= 30 ? 1 : topShare <= 50 ? 0.5 : 0, `Top wallets hold ${Math.round(topShare)}%`);
  if (bundle) add("bundle", "Bundled wallets", 10, bundle === "low" ? 1 : bundle === "some" ? 0.5 : 0, bundle === "low" ? "None to worry about" : bundle === "some" ? "Some linked wallets" : "Many linked wallets");

  const max = items.reduce((a, c) => a + c.weight, 0);
  const checks = items.map(({ weight, earn, ...c }) => c);
  // Too little to go on: say so instead of showing a number that means nothing.
  if (items.length < 3 || max === 0) return { score: null, level: "unknown", title: "Not enough data yet", checks, known: items.length, total: 9 };
  let score = Math.round((items.reduce((a, c) => a + c.weight * c.earn, 0) / max) * 100);
  if (s.honeypot) score = Math.min(score, 10);
  const level = score >= 75 ? "good" : score >= 45 ? "some" : "bad";
  const title = level === "good" ? "Looks safe" : level === "some" ? "Some risks" : "High risk";
  return { score, level, title, checks, known: items.length, total: 9 };
}
