/** Plain-language signals for buyers, worked out from a token's tracked wallets. Pure functions, safe anywhere. */

export type HolderRow = {
  wallet: string; rank: number | null; pct: number | string | null; balance: number | string; peak_balance: number | string;
  is_dev: boolean; is_contract: boolean; label: string | null; in_top: boolean; acquired_at: string | null; first_seen_at: string;
};
export type EventRow = { wallet: string; kind: "sell" | "exit" | "buy"; pct_of_holding: number | string | null; created_at: string; is_dev: boolean };
export type LinkRow = { a: string; b: string; kind: string };
export type Signal = { level: "good" | "warn" | "bad"; text: string };
export type Seat = "holding" | "sold" | "left";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const p = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + "%";

/** Where a wallet sits in the club: still holding, sold some, or left (sold everything). */
export function seatOf(h: HolderRow, last?: EventRow): Seat {
  const now = n(h.balance), peak = n(h.peak_balance);
  if ((peak > 0 && now <= peak * 0.01) || last?.kind === "exit") return "left";
  if (last && last.kind === "sell") return "sold";
  if (peak > 0 && now < peak * 0.9) return "sold";
  return "holding";
}

/** Groups of wallets joined by links (union-find). Only groups of 2 or more. */
export function clusters(wallets: string[], links: LinkRow[]): string[][] {
  const parent = new Map(wallets.map((w) => [w, w]));
  const find = (w: string): string => { const q = parent.get(w)!; if (q === w) return w; const r = find(q); parent.set(w, r); return r; };
  for (const l of links) if (parent.has(l.a) && parent.has(l.b)) parent.set(find(l.a), find(l.b));
  const groups = new Map<string, string[]>();
  for (const w of wallets) { const r = find(w); groups.set(r, [...(groups.get(r) || []), w]); }
  return [...groups.values()].filter((g) => g.length > 1);
}

const days = (since: string | null | undefined) => (since ? (Date.now() - Date.parse(since)) / 86_400_000 : NaN);

export function insights(input: {
  holders: HolderRow[]; events: EventRow[]; links: LinkRow[]; security: any; fullList: boolean;
}): Signal[] {
  const { holders, events, links, security: s = {}, fullList } = input;
  const last = new Map<string, EventRow>();
  for (const e of events) if (!last.has(e.wallet)) last.set(e.wallet, e);
  const people = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev));
  const out: Signal[] = [];

  // Safety first.
  if (s.honeypot === true) out.push({ level: "bad", text: "Honeypot warning: buyers may not be able to sell this token." });
  if (n(s.sellTax) > 10) out.push({ level: "bad", text: `High sell tax (${Math.round(n(s.sellTax))}%): you lose that much every time you sell.` });
  if (s.mintable === true) out.push({ level: "warn", text: "The owner can create new tokens, which can lower the value of everyone's tokens." });
  if (s.openSource === false) out.push({ level: "warn", text: "The contract's code is hidden, so nobody can check what it does." });

  // The dev.
  const dev = holders.find((h) => h.is_dev);
  if (dev) {
    const seat = seatOf(dev, last.get(dev.wallet));
    const devSells = events.filter((e) => e.is_dev && e.kind !== "buy");
    if (seat === "left") out.push({ level: "bad", text: "The dev has sold everything and left." });
    else if (devSells.length) out.push({ level: "bad", text: `The dev has sold ${devSells.length === 1 ? "once" : devSells.length + " times"} and still holds ${p(n(dev.pct))} of the supply.` });
    else if (n(dev.pct) > 10) out.push({ level: "warn", text: `The dev holds ${p(n(dev.pct))} of the supply. That's a lot in one wallet.` });
    else out.push({ level: "good", text: `The dev holds ${p(n(dev.pct))} and hasn't sold since tracking started.` });
  }

  // How spread out the tokens are.
  const top10 = people.filter((h) => h.in_top).sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 10).reduce((a, h) => a + n(h.pct), 0);
  if (top10 > 50) out.push({ level: "bad", text: `The 10 biggest wallets hold ${p(top10)}. A few people can move the price a lot.` });
  else if (top10 > 25) out.push({ level: "warn", text: `The 10 biggest wallets hold ${p(top10)} of the supply.` });
  else if (top10 > 0) out.push({ level: "good", text: `Tokens are well spread: the 10 biggest wallets hold ${p(top10)}.` });

  // Connected wallets (possibly one person with many wallets).
  const groups = clusters(people.map((h) => h.wallet), links);
  if (groups.length) {
    const share = groups.flat().reduce((a, w) => a + n(people.find((h) => h.wallet === w)?.pct), 0);
    const biggest = Math.max(...groups.map((g) => g.length));
    out.push({ level: share > 10 ? "bad" : "warn", text: `${groups.flat().length} top wallets are connected in ${groups.length} group${groups.length > 1 ? "s" : ""} (largest: ${biggest}) and hold ${p(share)} together. They may belong to the same people.` });
  } else if (fullList) out.push({ level: "good", text: "No connected wallets found among the top holders." });

  // Who's leaving.
  const top = people.filter((h) => h.in_top || seatOf(h, last.get(h.wallet)) === "left");
  const left = top.filter((h) => seatOf(h, last.get(h.wallet)) === "left").length;
  const sold = top.filter((h) => seatOf(h, last.get(h.wallet)) === "sold").length;
  if (top.length) {
    const share = (left + sold) / top.length;
    out.push({
      level: share > 0.4 ? "bad" : share > 0.15 ? "warn" : "good",
      text: left + sold === 0 ? "None of the top wallets have sold since tracking started." : `${left} top wallet${left === 1 ? " has" : "s have"} left and ${sold} sold some since tracking started.`,
    });
  }

  // How long people hold.
  const held = people.filter((h) => h.in_top).map((h) => days(h.acquired_at || h.first_seen_at)).filter((d) => isFinite(d)).sort((a, b) => a - b);
  if (held.length >= 5) {
    const mid = held[Math.floor(held.length / 2)];
    if (mid >= 7) out.push({ level: "good", text: `Most top wallets have held for ${Math.round(mid)} days or more.` });
    else if (mid < 1) out.push({ level: "warn", text: "Most top wallets bought less than a day ago." });
    else out.push({ level: "warn", text: `Most top wallets have held for about ${Math.round(mid)} day${Math.round(mid) === 1 ? "" : "s"}.` });
  }
  return out;
}
