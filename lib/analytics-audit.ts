/**
 * The Scanner's advanced audit: every contract, holder and market check in plain words, grouped, with an A–F grade.
 * Inputs: GoPlus security (lib/analytics.ts), the honeypot.is simulation (lib/honeypot-sim.ts), DexScreener pool
 * stats (lib/market.ts getPairStats) and our holder list. Checks we couldn't read are shown as "unknown" and don't
 * count for or against the grade.
 */
import type { HoneypotSim } from "@/lib/honeypot-sim";
import type { PairStats } from "@/lib/market";

export type AuditLevel = "ok" | "warn" | "bad" | "unknown";
export type AuditCheck = { level: AuditLevel; label: string; detail: string };
export type AuditGroup = { title: string; checks: AuditCheck[] };
export type Audit = { grade: "A" | "B" | "C" | "D" | "F" | "?"; score: number | null; headline: string; groups: AuditGroup[]; bad: number; warn: number; ok: number };

const pct = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10) + "%";
const usd = (n: number) => "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const age = (ms: number) => { const d = (Date.now() - ms) / 86_400_000; return d < 1 / 24 ? "under an hour" : d < 1 ? `${Math.round(d * 24)} hours` : d < 60 ? `${Math.round(d)} days` : `${Math.round(d / 30)} months`; };

export function audit({ security, sim, move, topShare, devPct, solana }: {
  security: any; sim: HoneypotSim | null; move: PairStats | null; topShare: number | null; devPct: number | null; solana?: boolean;
}): Audit {
  const s = security || {};
  const groups: AuditGroup[] = [];
  const g = (title: string) => { const x: AuditGroup = { title, checks: [] }; groups.push(x); return x; };
  const add = (grp: AuditGroup, level: AuditLevel, label: string, detail: string) => grp.checks.push({ level, label, detail });
  // A yes/no flag where "yes" is the risk.
  const risk = (grp: AuditGroup, v: boolean | null | undefined, label: string, yes: string, no: string, yesLevel: AuditLevel = "bad") => {
    if (v == null) return;
    add(grp, v ? yesLevel : "ok", label, v ? yes : no);
  };

  // ---------------------------------------------------------------- can you sell?
  const sell = g("Can you sell?");
  const hp = s.honeypot === true || sim?.honeypot === true;
  if (s.honeypot != null || sim?.honeypot != null) {
    const both = s.honeypot != null && sim?.honeypot != null;
    add(sell, hp ? "bad" : "ok", "Honeypot test",
      hp ? `Selling looks blocked${sim?.reason ? `: ${sim.reason}` : ""}.` : both ? "Passed two separate tests (GoPlus and a live buy/sell simulation)." : "Passed: buying and selling both work.");
  }
  const buyTax = sim?.buyTax ?? s.buyTax, sellTax = sim?.sellTax ?? s.sellTax;
  if (buyTax != null || sellTax != null) {
    const top = Math.max(buyTax ?? 0, sellTax ?? 0);
    add(sell, top > 25 ? "bad" : top > 10 ? "warn" : "ok", "Taxes", `${pct(buyTax ?? 0)} to buy, ${pct(sellTax ?? 0)} to sell${top > 10 ? ": high, you lose that much on every trade" : ""}.`);
  }
  if (sim?.holdersTested) {
    const failed = sim.holdersFailed ?? 0;
    add(sell, failed / sim.holdersTested > 0.2 ? "bad" : failed > 0 ? "warn" : "ok", "Real holders selling",
      failed ? `${failed} of ${sim.holdersTested} recent holders tested couldn't sell.` : `All ${sim.holdersTested} recent holders tested could sell.`);
  }
  risk(sell, s.cannotSellAll, "Sell everything", "You can't sell your whole balance at once.", "You can sell your whole balance.");
  risk(sell, s.cannotBuy, "Buying", "Buying is blocked.", "Anyone can buy.");
  risk(sell, s.cooldown, "Trading cooldown", "There's a wait between trades, so you may not be able to sell fast.", "No wait between trades.", "warn");
  risk(sell, s.pausable, "Pause trading", "The owner can pause all transfers, which stops selling.", "Transfers can't be paused.");
  risk(sell, s.blacklist, "Blacklist", "The owner can block wallets from selling.", "No blacklist.", "warn");

  // ---------------------------------------------------------------- owner powers
  const own = g("Owner powers");
  if (s.ownerRenounced != null) add(own, s.ownerRenounced ? "ok" : "warn", "Ownership", s.ownerRenounced ? "Renounced: nobody controls the contract." : "Someone still owns the contract. Check what they can do below.");
  risk(own, s.mintable, "Mint new tokens", "The owner can create more tokens and dilute you.", "No new tokens can be made.");
  risk(own, s.changeBalance, "Edit balances", "The owner can change anyone's balance.", "Balances can't be edited by the owner.");
  risk(own, s.taxChangeable, "Change taxes", "The owner can raise taxes at any time (even to 100%).", "Taxes are fixed.", "warn");
  risk(own, s.personalTax, "Tax per wallet", "The owner can set a special tax for chosen wallets.", "Same tax for everyone.");
  risk(own, s.hiddenOwner, "Hidden owner", "There's a hidden owner who keeps control.", "No hidden owner.");
  risk(own, s.canTakeBack, "Take back ownership", "Ownership can be taken back after being given up.", "Ownership can't be taken back.");
  risk(own, s.proxy, "Upgradeable code", "The contract can be swapped for new code.", "The code can't be swapped.", "warn");
  risk(own, s.selfdestruct, "Self-destruct", "The contract can destroy itself.", "Can't self-destruct.");
  risk(own, s.externalCall, "Outside calls", "The contract calls other contracts, which can hide behaviour.", "No risky outside calls.", "warn");
  risk(own, s.antiWhaleChange, "Max-buy limits", "The owner can change how much one wallet can buy or hold.", "Wallet limits can't be changed.", "warn");
  if (s.freezable != null) risk(own, s.freezable, "Freeze wallets", "The owner can freeze wallets.", "Wallets can't be frozen.");
  if (s.openSource != null) add(own, s.openSource ? "ok" : "bad", "Contract code", s.openSource ? "Public and verified, anyone can read it." : "Hidden: nobody can check what it does.");

  // ---------------------------------------------------------------- supply & holders
  const sup = g("Supply & holders");
  if (s.lp) {
    const safe = Math.min(100, (s.lp.locked ?? 0) + (s.lp.burned ?? 0));
    add(sup, safe >= 90 ? "ok" : safe >= 50 ? "warn" : "bad", "Liquidity lock", safe >= 90 ? `${pct(safe)} of the pool is locked or burned.` : `Only ${pct(safe)} of the pool is locked or burned: the rest can be pulled.`);
  }
  if (topShare != null && topShare > 0) add(sup, topShare > 50 ? "bad" : topShare > 30 ? "warn" : "ok", "Top wallets", `The biggest wallets hold ${pct(topShare)} of the supply${topShare > 30 ? ", so a few sellers can crash the price" : ""}.`);
  const dev = devPct ?? s.creatorPct;
  if (dev != null) add(sup, dev > 10 ? "bad" : dev > 5 ? "warn" : "ok", "Dev's share", dev > 0.01 ? `The dev holds ${pct(dev)}.` : "The dev holds none.");
  if (s.ownerPct != null && s.ownerPct > 5 && !s.ownerRenounced) add(sup, s.ownerPct > 15 ? "bad" : "warn", "Owner's share", `The contract owner holds ${pct(s.ownerPct)}.`);
  if (s.holderCount != null) add(sup, s.holderCount < 50 ? "warn" : "ok", "Holders", `${Intl.NumberFormat("en-US").format(s.holderCount)} wallets hold it.`);

  // ---------------------------------------------------------------- market
  const mkt = g("Market");
  if (move?.liquidityUsd != null) {
    const l = move.liquidityUsd, ratio = move.marketCap ? l / move.marketCap : null;
    add(mkt, l < 5_000 ? "bad" : l < 25_000 || (ratio != null && ratio < 0.03) ? "warn" : "ok", "Liquidity",
      `${usd(l)} in the pool${ratio != null ? ` (${pct(ratio * 100)} of market cap)` : ""}${l < 5_000 ? ": very thin, big price swings and hard to sell" : ratio != null && ratio < 0.03 ? ": thin for its size" : ""}.`);
  }
  if (move?.pairCreatedAt) {
    const d = (Date.now() - move.pairCreatedAt) / 86_400_000;
    add(mkt, d < 1 ? "warn" : "ok", "Pool age", `Trading for ${age(move.pairCreatedAt)}${d < 1 ? ": very new, most rugs happen in the first day" : ""}.`);
  }
  if (move?.volumeH24 != null && move.liquidityUsd) {
    const v = move.volumeH24;
    add(mkt, v < 500 ? "warn" : "ok", "Trading", v < 500 ? `Only ${usd(v)} traded in 24 hours: very quiet.` : `${usd(v)} traded in 24 hours.`);
  }
  if (move?.buysH24 != null && move.sellsH24 != null && move.buysH24 + move.sellsH24 >= 20) {
    const b = move.buysH24, sl = move.sellsH24;
    add(mkt, sl > b * 2 ? "warn" : "ok", "Buyers vs sellers", `${Intl.NumberFormat("en-US").format(b)} buys and ${Intl.NumberFormat("en-US").format(sl)} sells today${sl > b * 2 ? ": far more selling" : ""}.`);
  }
  risk(mkt, s.fakeToken, "Copycat", "This looks like a fake copy of a known token.", "Not a known copycat.");
  risk(mkt, s.airdropScam, "Airdrop scam", "Flagged as an airdrop scam.", "Not flagged as an airdrop scam.");
  risk(mkt, s.sameCreatorHoneypot, "Creator's past", "The same creator made honeypot tokens before.", "The creator has no known honeypots.");
  if (s.trusted) add(mkt, "ok", "Known project", "On GoPlus's trusted list.");
  for (const r of s.risks || []) add(mkt, "warn", "Flagged", r);

  const kept = groups.filter((x) => x.checks.length);
  const all = kept.flatMap((x) => x.checks);
  const bad = all.filter((c) => c.level === "bad").length, warn = all.filter((c) => c.level === "warn").length, ok = all.filter((c) => c.level === "ok").length;
  if (all.length < 4) return { grade: "?", score: null, headline: solana ? "Not enough contract data for this Solana token yet." : "Not enough data yet to grade this token.", groups: kept, bad, warn, ok };

  // Each problem costs points; the worst ones (can't sell, owner can drain) cap the grade.
  let score = 100 - bad * 18 - warn * 6;
  const fatal = hp || s.changeBalance === true || s.cannotSellAll === true || s.fakeToken === true || s.airdropScam === true || (sim?.holdersTested && (sim.holdersFailed ?? 0) / sim.holdersTested > 0.2);
  if (fatal) score = Math.min(score, 10);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  const headline = fatal ? "Dangerous: you may lose everything you put in."
    : grade === "A" ? "Clean: no contract red flags found."
    : grade === "B" ? "Mostly fine, with a few things to keep in mind."
    : grade === "C" ? "Some real risks. Only use money you can lose."
    : grade === "D" ? "Risky: several red flags."
    : "High risk: many red flags.";
  return { grade, score, headline, groups: kept, bad, warn, ok };
}
