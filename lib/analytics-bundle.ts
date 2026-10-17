/**
 * Bundle check: how much of a token sits in wallets that are linked to each other (often one person or a bot
 * spreading a big bag over many wallets to look "well spread"), plus a bubble map layout. Pure functions.
 *
 * Wallets count as linked when they: sent tokens to each other, one paid for another's first tokens, bought in the
 * same block, or made near-identical buys within a minute of each other (typical of bundle bots).
 */
import { clusters, type HolderRow, type LinkRow } from "./analytics-insights";
import { sameBlockLinks, type Trade } from "./analytics-signals";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };

/** Near-identical buys (within 2% of each other) by different wallets less than a minute apart. */
export function sameSizeLinks(trades: Trade[]): LinkRow[] {
  const buys = trades.filter((t) => t.side === "buy" && n(t.amount) > 0).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: LinkRow[] = [];
  for (let i = 0; i < buys.length; i++) {
    for (let j = i + 1; j < buys.length && Date.parse(buys[j].at) - Date.parse(buys[i].at) < 60_000; j++) {
      const a = n(buys[i].amount), b = n(buys[j].amount);
      if (buys[i].wallet !== buys[j].wallet && Math.abs(a - b) <= Math.max(a, b) * 0.02) out.push({ a: buys[i].wallet, b: buys[j].wallet, kind: "same-size" });
    }
  }
  return out;
}

export type Bubble = { wallet: string; pct: number; group: number; isDev: boolean; x: number; y: number; r: number };
export type Bundle = {
  level: "low" | "some" | "high"; title: string; summary: string;
  bundledPct: number; bundledWallets: number; groups: { wallets: string[]; pct: number; withDev: boolean; how: string[] }[];
  reasons: string[]; bubbles: Bubble[]; lines: { a: number; b: number }[];
};

const HOW: Record<string, string> = { transfer: "sent tokens to each other", moved: "moved tokens between them", funded: "one paid for another's first tokens", "same-block": "bought in the same block", "same-size": "made identical buys seconds apart" };

export function bundleCheck({ holders, trades, links, dev }: { holders: HolderRow[]; trades: Trade[]; links: LinkRow[]; dev?: string | null }): Bundle {
  // Everyone holding now: tracked top wallets plus anyone seen trading who still holds.
  const pct = new Map<string, number>();
  const contracts = new Set(holders.filter((h) => h.is_contract).map((h) => h.wallet));
  for (const h of holders) if (!h.is_contract && n(h.balance) > 0) pct.set(h.wallet, n(h.pct));
  const latest = new Map<string, Trade>();
  for (const t of trades) { const l = latest.get(t.wallet); if (!l || Date.parse(t.at) > Date.parse(l.at)) latest.set(t.wallet, t); }
  for (const [w, t] of latest) if (!pct.has(w) && !contracts.has(w) && n(t.pct_after) > 0) pct.set(w, n(t.pct_after));

  const all = [...links, ...sameBlockLinks(trades), ...sameSizeLinks(trades)].filter((l) => l.a !== l.b && pct.has(l.a) && pct.has(l.b));
  // Wallets linked to very many others are usually exchanges or routers, not bundles.
  const deg = new Map<string, number>();
  for (const l of all) for (const w of [l.a, l.b]) deg.set(w, (deg.get(w) || 0) + 1);
  const use = all.filter((l) => (deg.get(l.a) || 0) <= 8 && (deg.get(l.b) || 0) <= 8);

  const groups = clusters([...pct.keys()], use).map((ws) => {
    const inside = use.filter((l) => ws.includes(l.a) && ws.includes(l.b));
    return { wallets: ws, pct: ws.reduce((a, w) => a + (pct.get(w) || 0), 0), withDev: !!dev && ws.includes(dev), how: [...new Set(inside.map((l) => HOW[l.kind] || "are linked"))] };
  }).sort((a, b) => b.pct - a.pct);
  const bundledPct = groups.reduce((a, g) => a + g.pct, 0);
  const bundledWallets = groups.reduce((a, g) => a + g.wallets.length, 0);
  const devGroup = groups.find((g) => g.withDev);
  const biggest = groups[0];

  const reasons: string[] = [];
  if (groups.length) reasons.push(`${bundledWallets} wallets are linked in ${groups.length} group${groups.length > 1 ? "s" : ""}, holding ${bundledPct.toFixed(1)}% of the supply together.`);
  if (biggest && biggest.pct >= 5) reasons.push(`The biggest group (${biggest.wallets.length} wallets) holds ${biggest.pct.toFixed(1)}%: they ${biggest.how.join(", ")}.`);
  if (devGroup) reasons.push(`The dev is linked to ${devGroup.wallets.length - 1} other wallet${devGroup.wallets.length > 2 ? "s" : ""}, together holding ${devGroup.pct.toFixed(1)}%. The dev may hold more than it looks.`);
  if (use.some((l) => l.kind === "same-block" || l.kind === "same-size")) reasons.push("Some wallets bought at the exact same moment or in identical amounts, which is what bundle bots do.");
  if (!groups.length) reasons.push("No linked wallets found among the holders we follow.");

  const level: Bundle["level"] = bundledPct >= 25 || (devGroup?.pct ?? 0) >= 10 || (biggest?.wallets.length ?? 0) >= 8 ? "high" : bundledPct >= 10 || groups.length >= 3 ? "some" : "low";
  const TEXT = {
    high: ["🔴 Highly bundled: not safe", "A big part of the supply sits in wallets that look like one person or bot. They can dump together and crash the price. Very high manipulation risk."],
    some: ["🟠 Some bundling", "A few wallets look connected. Not a deal-breaker, but watch those groups: if one sells, the others often follow."],
    low: ["🟢 Low bundling", "The holders we follow look independent of each other. That's a healthy sign."],
  } as const;

  // ---------- Bubble map ----------
  const top = [...pct].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const groupOf = new Map<string, number>();
  groups.forEach((g, i) => g.wallets.forEach((w) => groupOf.set(w, i + 1)));
  // Always show bundled wallets, even small ones.
  for (const g of groups) for (const w of g.wallets) if (!top.some(([x]) => x === w) && top.length < 60) top.push([w, pct.get(w) || 0]);
  const maxP = Math.max(0.01, ...top.map(([, p]) => p));
  const bubbles: Bubble[] = top.map(([wallet, p], i) => {
    const a = i * 2.39996, rad = 30 + 9 * Math.sqrt(i) * 3; // golden-angle spiral start
    return { wallet, pct: p, group: groupOf.get(wallet) || 0, isDev: wallet === dev, x: 300 + Math.cos(a) * rad, y: 200 + Math.sin(a) * rad, r: 7 + 30 * Math.sqrt(p / maxP) };
  });
  const idx = new Map(bubbles.map((b, i) => [b.wallet, i]));
  const lines = use.map((l) => ({ a: idx.get(l.a)!, b: idx.get(l.b)! })).filter((l) => l.a != null && l.b != null && l.a !== l.b);
  layout(bubbles, lines);
  return { level, title: TEXT[level][0], summary: TEXT[level][1], bundledPct, bundledWallets, groups: groups.slice(0, 6), reasons, bubbles, lines };
}

/** A small force layout: bubbles push apart, linked bubbles pull together, everything stays inside 600×400. */
function layout(b: Bubble[], lines: { a: number; b: number }[]) {
  for (let it = 0; it < 300; it++) {
    const cool = 1 - it / 300;
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      const dx = b[j].x - b[i].x, dy = b[j].y - b[i].y, d = Math.hypot(dx, dy) || 0.01, min = b[i].r + b[j].r + 4;
      if (d < min) { const push = ((min - d) / d) * 0.5; b[i].x -= dx * push; b[i].y -= dy * push; b[j].x += dx * push; b[j].y += dy * push; }
    }
    for (const l of lines) {
      const p = b[l.a], q = b[l.b], dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, want = p.r + q.r + 14;
      const pull = ((d - want) / d) * 0.08 * cool; p.x += dx * pull; p.y += dy * pull; q.x -= dx * pull; q.y -= dy * pull;
    }
    for (const x of b) { x.x += (300 - x.x) * 0.01 * cool; x.y += (200 - x.y) * 0.01 * cool; x.x = Math.max(x.r + 2, Math.min(600 - x.r - 2, x.x)); x.y = Math.max(x.r + 2, Math.min(400 - x.r - 2, x.y)); }
  }
}
