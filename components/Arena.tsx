"use client";
import { walletUrl } from "@/lib/explorer";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatOf, sellRisk, type EventRow, type HolderRow, type LinkRow, type Risk } from "@/lib/analytics-insights";
import { toast } from "@/lib/toast";
import AnalyticsScan from "@/components/AnalyticsScan";
import Player, { seed, type Mood } from "@/components/arena/Player";

/**
 * The game arena: every tracked holder of the token is a goofy cartoon footballer on one big pitch, for a chosen
 * time frame. Diamond Hands (still holding) play in green from their own goal; Paper Hands (sold some in this time
 * frame) play in red from the other end and fade as their bag shrinks. Holders who look ready to sell shake and sweat,
 * and wallets that sell everything vanish in a puff. Every new sell pops up as a toast. The biggest bag on each side
 * keeps goal, your own player has gold hair and a YOU flag, and "Join the match" opens an amount picker that buys
 * through the Wallet. Players who don't fit on the pitch wait on the subs bench.
 */
export type TradeRow = { wallet: string; side: "buy" | "sell"; amount: number | string; balance_after: number | string | null; pct_after: number | string | null; at: string; tx_hash?: string };
type Props = {
  holders: HolderRow[]; events: EventRow[]; trades?: TradeRow[]; links: LinkRow[]; explorer: string; token: string; symbol: string;
  /** The network key, for the Buy link. */
  chain?: string;
  /** Buying works on this network through the Wallet. */
  canBuy?: boolean;
  /** The signed-in member's own wallet on this network, so their player can be found. */
  me?: string | null;
  /** Signed in, so the arena's own scan box works. */
  signedIn?: boolean;
};
type TF = "1h" | "6h" | "24h" | "7d" | "all";
type Team = "home" | "away";
type Spot = { x: number; y: number; s: number };
type Man = { h: HolderRow; team: Team; amount: number; bought: number; risk: Risk; mood: Mood; left: number; place: number; spot: Spot };
type Bencher = { h: HolderRow; risk: Risk };
type Move = { wallet: string; buy: boolean; amount: number; at: string; key: string; gone: boolean; share: number };

const FRAMES: { k: TF; label: string; ms: number }[] = [
  { k: "1h", label: "1H", ms: 3_600_000 }, { k: "6h", label: "6H", ms: 6 * 3_600_000 }, { k: "24h", label: "24H", ms: 86_400_000 },
  { k: "7d", label: "7D", ms: 7 * 86_400_000 }, { k: "all", label: "All", ms: Infinity },
];
const KIT = { home: { kit: "#12A66A", trim: "#FFFFFF" }, away: { kit: "#E5482F", trim: "#FFE9A8" } } as const;
const RISK_COLOR = { low: "#2BC48F", medium: "#F5B82E", high: "#F0563A" } as const;
const PRESETS = [5, 10, 25, 50, 100];
const ME_KEY = "ar-me";
const MAX_HOME = 36, MAX_AWAY = 24;
/** A wallet that sold everything this recently still shows on the pitch, vanishing in a puff. */
const POOF_MS = 15 * 60_000;
const W = 640; // pitch width (touchline to touchline)

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const fmt = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const pct = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : "<0.01") + "%";
const dur = (t?: string | null) => {
  if (!t) return "–";
  const h = (Date.now() - Date.parse(t)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const store = {
  get: () => { try { return localStorage.getItem(ME_KEY) || ""; } catch { return ""; } },
  set: (v: string) => { try { v ? localStorage.setItem(ME_KEY, v) : localStorage.removeItem(ME_KEY); } catch {} },
};

/** Phones get a tall pitch (home goal at the bottom), wider screens a wide one (home goal on the left). */
function usePortrait() {
  const [p, setP] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 700px)");
    const on = () => setP(m.matches);
    on(); m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return p;
}

/**
 * Where each player stands. Spot 0 keeps goal; the rest fill the team's half in staggered lines, biggest bags
 * nearest the halfway line. `a` runs along the pitch from the home goal, `c` across it.
 */
function formation(wallets: string[], team: Team, L: number, portrait: boolean): Spot[] {
  const m = wallets.length - 1;
  const A = 0.33 * L, C = 0.86 * W;
  // A player is about 66 units wide and 132 tall (with the tag), so pick the grid that gives them the most room.
  const along = portrait ? 132 : 66, across = portrait ? 66 : 132;
  let cols = Math.max(1, Math.round(Math.sqrt(Math.max(1, m) * (A / along) / (C / across))));
  const rows = Math.max(1, Math.ceil(m / cols)); cols = Math.max(1, Math.ceil(m / rows));
  const cellA = A / cols, cellC = C / rows;
  // Room for a 100-unit player plus the tag under the feet.
  const s = Math.max(0.36, Math.min(1, cellA / along, cellC / across));
  const put = (a: number, c: number, sc: number): Spot => {
    const aa = team === "home" ? a : L - a;
    return portrait ? { x: c, y: L - aa + 40 * sc, s: sc } : { x: aa, y: c + 40 * sc, s: sc };
  };
  return wallets.map((w, i) => {
    if (i === 0) return put(0.075 * L, W / 2, Math.min(1, s * 1.15));
    const k = i - 1, col = Math.floor(k / rows), row = k % rows;
    const r = seed(w);
    const inRow = Math.min(rows, m - col * rows);
    const c0 = W / 2 - (inRow * cellC) / 2;
    const a = 0.47 * L - (col + 0.5) * cellA + (r() - 0.5) * cellA * 0.22;
    const c = c0 + (row + 0.5) * cellC + (col % 2 ? cellC * 0.18 : -cellC * 0.18) + (r() - 0.5) * cellC * 0.18;
    return put(a, Math.min(W - 28, Math.max(28, c)), s);
  });
}

export default function Arena({ holders, events, trades = [], links, explorer, token, symbol, chain, canBuy = false, me: member = null, signedIn = false }: Props) {
  const [tf, setTf] = useState<TF>("24h");
  const [sel, setSel] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const portrait = usePortrait();
  const L = portrait ? 1400 : 1000;
  // Your wallet: the signed-in member's own, or one pasted into "Find me" (kept on this device).
  const [saved, setSaved] = useState("");
  useEffect(() => { setSaved(store.get()); }, []);
  const me = member || saved || null;
  const dev = holders.find((h) => h.is_dev)?.wallet || null;

  const d = useMemo(() => {
    const frame = FRAMES.find((f) => f.k === tf)!;
    const since = frame.ms === Infinity ? 0 : Date.now() - frame.ms;
    const byWallet = new Map(holders.map((h) => [h.wallet, h]));
    // Live trades (every buy and sell through the pool) when we have them; otherwise top-wallet balance changes.
    const live = trades.length > 0;
    const win: Move[] = live
      ? trades.filter((x) => Date.parse(x.at) >= since).map((x, i) => {
        const left = x.balance_after == null ? null : n(x.balance_after);
        const amt = n(x.amount);
        return { wallet: x.wallet, buy: x.side === "buy", amount: amt, at: x.at, key: (x.tx_hash || x.at) + x.wallet + x.side + i,
          gone: x.side === "sell" && left != null && left <= amt * 0.001, share: x.side === "sell" && left != null ? amt / Math.max(amt, amt + left) : 0 };
      })
      : events.filter((e) => Date.parse(e.created_at) >= since).map((e, i) => ({ wallet: e.wallet, buy: e.kind === "buy", amount: n(e.amount), at: e.created_at,
        key: e.created_at + e.wallet + e.kind + i, gone: e.kind === "exit", share: e.kind === "exit" ? 1 : n(e.pct_of_holding) / 100 }));
    win.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const flow = new Map<string, { bought: number; sold: number }>();
    for (const e of win) {
      const f = flow.get(e.wallet) || { bought: 0, sold: 0 };
      if (e.buy) f.bought += e.amount; else f.sold += e.amount;
      flow.set(e.wallet, f);
    }
    // Traders we don't follow yet still get a player, from what the trade told us.
    const latest = new Map<string, TradeRow>();
    for (const x of trades) if (!latest.has(x.wallet)) latest.set(x.wallet, x);
    const rowFor = (w: string): HolderRow => byWallet.get(w) || {
      wallet: w, rank: null, pct: latest.get(w)?.pct_after ?? null, balance: latest.get(w)?.balance_after ?? 0,
      peak_balance: n(latest.get(w)?.balance_after) + (flow.get(w)?.sold || 0), is_dev: w === dev, is_contract: false, label: null, in_top: false,
      acquired_at: null, first_seen_at: trades.filter((x) => x.wallet === w).slice(-1)[0]?.at || new Date().toISOString(),
    };
    const isGone = (h: HolderRow) => seatOf(h) === "left" || (latest.has(h.wallet) && latest.get(h.wallet)!.side === "sell" && n(latest.get(h.wallet)!.balance_after) <= 0 && latest.get(h.wallet)!.balance_after != null);
    const lastExit = (w: string) => win.find((m) => m.wallet === w && !m.buy && m.gone)?.at;
    const buyVol = win.filter((e) => e.buy).reduce((a, e) => a + e.amount, 0);
    const sellVol = win.filter((e) => !e.buy).reduce((a, e) => a + e.amount, 0);
    const total = buyVol + sellVol;
    const power = total ? buyVol / total : 0.5;
    const risk = (h: HolderRow) => sellRisk(h, events, links, dev);

    // Two teams. Paper Hands: wallets that sold (more than they bought) in this time frame and still hold some.
    // Diamond Hands: everyone still holding, ranked by the size of their bag; the ones who bought more get a "+".
    // Wallets that sold everything leave the pitch (in a puff, if it just happened).
    type Entry = { h: HolderRow; amount: number; bought: number; poof?: boolean };
    const away: Entry[] = [], home: Entry[] = [], gone: { h: HolderRow; at?: string }[] = [];
    const seen = new Set<string>();
    const consider = (h: HolderRow, f?: { bought: number; sold: number }) => {
      if (isGone(h)) {
        const at = lastExit(h.wallet);
        gone.push({ h, at });
        if (at && Date.now() - Date.parse(at) < POOF_MS) away.push({ h, amount: f?.sold || 0, bought: 0, poof: true });
      } else if (f && f.sold > f.bought) away.push({ h, amount: f.sold - f.bought, bought: 0 });
      else if (!f || f.bought >= f.sold) home.push({ h, amount: n(h.pct), bought: f ? f.bought - f.sold : 0 });
    };
    for (const h of holders) {
      if (h.is_contract || !(h.in_top || h.is_dev)) continue;
      seen.add(h.wallet);
      consider(h, flow.get(h.wallet));
    }
    for (const [w, f] of flow) {
      if (seen.has(w) || byWallet.get(w)?.is_contract) continue;
      seen.add(w);
      const h = rowFor(w);
      if (f.sold > f.bought || f.bought > f.sold) consider(h, f);
    }
    // Your wallet is tracked but sits outside the top: it still gets a player.
    if (me && ![...seen].some((w) => same(w, me))) {
      const h = holders.find((x) => same(x.wallet, me));
      if (h && !h.is_contract && !isGone(h)) home.push({ h, amount: n(h.pct), bought: 0 });
    }
    away.sort((a, b) => Number(!!a.poof) - Number(!!b.poof) || b.amount - a.amount);
    home.sort((a, b) => b.amount - a.amount);

    const men: Man[] = [];
    const field = (team: Team, list: Entry[], max: number) => {
      let shown = list.slice(0, max);
      // Never leave you on the bench.
      const mine = me ? list.findIndex((x) => same(x.h.wallet, me)) : -1;
      if (mine >= shown.length && shown.length) shown = [...shown.slice(0, -1), list[mine]];
      const spots = formation(shown.map((x) => x.h.wallet), team, L, portrait);
      shown.forEach((x, i) => {
        const r = risk(x.h);
        const peak = Math.max(n(x.h.peak_balance), n(x.h.balance) + (team === "away" ? x.amount : 0));
        const left = x.poof ? 0 : peak > 0 ? Math.min(1, n(x.h.balance) / peak) : 1;
        const mood: Mood = x.poof ? "gone" : team === "away" ? "paper" : r.level === "high" ? "ready" : r.level === "medium" ? "nervous" : "chill";
        men.push({ h: x.h, team, amount: x.amount, bought: x.bought, risk: r, mood, left, place: i + 1, spot: spots[i] });
      });
      return shown;
    };
    field("away", away, MAX_AWAY);
    field("home", home, MAX_HOME);
    // Draw back to front, so nearer players stand in front.
    men.sort((a, b) => a.spot.y - b.spot.y);

    // The subs bench: holders who didn't fit on the pitch.
    const onPitch = new Set(men.map((p) => p.h.wallet));
    const bench: Bencher[] = home.filter((x) => !onPitch.has(x.h.wallet)).map((x) => ({ h: x.h, risk: risk(x.h) })).slice(0, 40);
    const buyers = home.filter((x) => x.bought > 0).length;

    // The latest move by each player on the pitch pops up over their head.
    const pops = new Map<string, Move>();
    for (const m of win.slice(0, 10)) if (onPitch.has(m.wallet) && !pops.has(m.wallet)) pops.set(m.wallet, m);

    // Timeline: 12 slots across the time frame.
    const start = since || (win.length ? Math.min(...win.map((e) => Date.parse(e.at))) : Date.now() - 86_400_000);
    const span = Math.max(60_000, Date.now() - start);
    const slots = Array.from({ length: 12 }, () => ({ buy: 0, sell: 0 }));
    for (const e of win) {
      const i = Math.min(11, Math.max(0, Math.floor(((Date.parse(e.at) - start) / span) * 12)));
      if (e.buy) slots[i].buy += e.amount; else slots[i].sell += e.amount;
    }
    return {
      men, bench, gone, buyVol, sellVol, total, power, slots, buyers, moves: win, pops,
      home: home.length, away: away.filter((x) => !x.poof).length, buys: win.filter((m) => m.buy).length, sells: win.filter((m) => !m.buy).length,
    };
  }, [tf, holders, events, trades, links, dev, me, L, portrait]);

  // A toast for every new sell (and, on arrival, for a sell in the last 15 minutes).
  const seenSells = useRef<Set<string> | null>(null);
  useEffect(() => {
    const sells = trades.length
      ? trades.filter((x) => x.side === "sell").map((x) => ({ key: (x.tx_hash || x.at) + x.wallet, wallet: x.wallet, amount: n(x.amount), at: x.at,
        gone: x.balance_after != null && n(x.balance_after) <= n(x.amount) * 0.001, share: x.balance_after != null ? n(x.amount) / Math.max(n(x.amount), n(x.amount) + n(x.balance_after)) : 0 }))
      : events.filter((e) => e.kind !== "buy").map((e) => ({ key: e.created_at + e.wallet, wallet: e.wallet, amount: n(e.amount), at: e.created_at, gone: e.kind === "exit", share: n(e.pct_of_holding) / 100 }));
    const first = seenSells.current === null;
    const fresh = first ? sells.filter((s) => Date.now() - Date.parse(s.at) < POOF_MS).slice(0, 1) : sells.filter((s) => !seenSells.current!.has(s.key)).slice(0, 3);
    seenSells.current = new Set(sells.map((s) => s.key));
    for (const s of fresh) {
      const who = same(s.wallet, me) ? "You" : s.wallet === dev ? `The dev (${short(s.wallet)})` : short(s.wallet);
      toast(s.gone
        ? { kind: "bad", title: "💨 Paper hands left the pitch!", text: `${who} sold everything (${fmt(s.amount)} ${symbol}) and vanished.` }
        : { kind: "info", title: "🧻 Paper hands sold!", text: `${who} sold ${fmt(s.amount)} ${symbol}${s.share > 0 ? `, ${Math.round(s.share * 100)}% of their bag` : ""}. They're fading out.` });
    }
  }, [trades, events, symbol, me, dev]);

  const { power, total } = d;
  const verdict = !total ? (d.home ? "🛡️ Clean sheet: nobody sold in this time frame" : "No players yet") : power >= 0.7 ? "⚽ GOAL! Diamond hands are smashing it" : power >= 0.56 ? "💎 Diamond hands on the attack"
    : power <= 0.3 ? "🚨 Paper hands are scoring" : power <= 0.44 ? "🧻 Paper hands pushing forward" : "⚖️ It's an even match";
  const hot = total > 0 && (power >= 0.7 || power <= 0.3);
  const pickedMan = sel ? d.men.find((p) => p.h.wallet === sel) || null : null;
  const picked: Man | Bencher | null = pickedMan || (sel ? d.bench.find((b) => b.h.wallet === sel) || null : null);
  const pickedTrades = picked ? trades.filter((x) => x.wallet === picked.h.wallet) : [];
  const pickedFlow = picked ? events.filter((e) => e.wallet === picked.h.wallet) : [];
  const pickedLinks = picked ? links.filter((l) => l.a === picked.h.wallet || l.b === picked.h.wallet) : [];
  const slotMax = Math.max(1, ...d.slots.map((s) => Math.max(s.buy, s.sell)));
  const pick = (w: string) => setSel(sel === w ? null : w);
  const mine = me ? d.men.find((p) => same(p.h.wallet, me) && p.mood !== "gone") : undefined;
  const myBench = me && !mine ? d.bench.find((b) => same(b.h.wallet, me)) : undefined;
  // On a phone, bring the player card into view when someone is tapped.
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sel || !infoRef.current) return;
    const r = infoRef.current.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight - 70) infoRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sel]);
  const keys = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };
  const last = d.moves[0];
  const enterLabel = mine && mine.team === "home" ? "➕ Buy more" : "⚽ Join the match";
  const at = (a: number, c: number) => (portrait ? { x: c, y: L - a } : { x: a, y: c });
  const ball = at(L / 2 + (power - 0.5) * 0.7 * L, W / 2);
  const join = at(0.3 * L, W - 2);
  const VW = portrait ? W : L, VH = portrait ? L : W;
  const moodName = (m: Man) => m.mood === "gone" ? "sold everything and is vanishing" : m.mood === "paper" ? `sold ${fmt(m.amount)} ${symbol}, ${Math.round(m.left * 100)}% of the bag left`
    : m.mood === "ready" ? "looks ready to sell" : m.mood === "nervous" ? "a bit nervous" : "chilling";

  return (
    <div className="arena soccer">
      <div className="arena-top">
        <div className="tf" role="tablist" aria-label="Time frame">
          {FRAMES.map((f) => <button key={f.k} type="button" role="tab" aria-selected={tf === f.k} onClick={() => setTf(f.k)}>{f.label}</button>)}
        </div>
        <button type="button" className="sc-scan-btn" aria-expanded={scanOpen} onClick={() => setScanOpen(!scanOpen)}>🔎 Scan a token</button>
      </div>
      {scanOpen && <div className="sc-scan"><AnalyticsScan signedIn={signedIn} label="Scan & play" view="chess" /></div>}

      <div className="sc-board" role="img" aria-label={`Score: Diamond hands ${d.buys} buys, Paper hands ${d.sells} sells`}>
        <span className="h"><b>💎 DIAMOND HANDS</b><small>{d.home} holding · {d.buyers} bought</small></span>
        <span className="score"><b>{d.buys}</b><i>–</i><b>{d.sells}</b><small>{FRAMES.find((f) => f.k === tf)!.label}</small></span>
        <span className="a"><b>PAPER HANDS 🧻</b><small>{d.away} sold some · {d.gone.length} left</small></span>
      </div>
      <b className={"arena-verdict" + (hot ? " check" : "")}>{verdict}</b>

      <div className="power" role="img" aria-label={`Buy volume ${fmt(d.buyVol)} ${symbol}, sell volume ${fmt(d.sellVol)} ${symbol}`}>
        <span className="pb" style={{ width: `${power * 100}%` }}><b>💎 Buys {Math.round(power * 100)}%</b><small>{fmt(d.buyVol)} {symbol}</small></span>
        <span className="ps"><b>Sells {Math.round((1 - power) * 100)}% 🧻</b><small>{fmt(d.sellVol)} {symbol}</small></span>
        <i className="clash" style={{ left: `${power * 100}%` }} aria-hidden="true">⚽</i>
      </div>

      {/* The latest move, like a match commentator. */}
      <button type="button" className={"ar-ticker " + (last ? (last.buy ? "buy" : "sell") : "")} key={last?.key || "none"} onClick={() => last && setSel(last.wallet)} disabled={!last}>
        <span className="live-dot">LIVE</span>
        {last ? <span><b>{last.buy ? "💎" : last.gone ? "💨" : "🧻"} {short(last.wallet)}</b>{same(last.wallet, me) ? " (you)" : last.wallet === dev ? " (dev)" : ""} {last.buy ? "bought" : last.gone ? "sold everything:" : "sold"} <b>{fmt(last.amount)} {symbol}</b> · {dur(last.at)} ago</span>
          : <span className="muted">No moves in this time frame yet. New buys and sells appear here within a minute.</span>}
      </button>

      <div className={"sc-wrap" + (portrait ? " tall" : "")}>
        <svg className="sc-pitch" viewBox={`-20 -20 ${VW + 40} ${VH + 40}`} role="img"
          aria-label={`Game arena for ${symbol}: ${d.home} diamond hands against ${d.away} paper hands. ${verdict}.`}>
          <defs>
            <pattern id="sc-net" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 0L8 8M8 0L0 8" stroke="#fff" strokeWidth="1" opacity=".7" /></pattern>
            <radialGradient id="sc-me" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#FFD54A" stopOpacity=".9" /><stop offset="1" stopColor="#FFB300" stopOpacity="0" /></radialGradient>
          </defs>
          <rect x="-20" y="-20" width={VW + 40} height={VH + 40} rx="26" fill="#1F7A3D" />
          {/* The pitch is drawn wide, then turned upright on phones. */}
          <g transform={portrait ? `translate(0 ${L}) rotate(-90)` : undefined}>
            {Array.from({ length: 10 }, (_, i) => <rect key={i} x={(i * L) / 10} y="0" width={L / 10} height={W} fill={i % 2 ? "#33A957" : "#2C9C4E"} />)}
            {/* whose half is winning: a green wash from the home end, red from the away end */}
            <rect x="0" y="0" width={L * power} height={W} fill="#7CFFB2" opacity=".08" />
            <rect x={L * power} y="0" width={L * (1 - power)} height={W} fill="#FF7A5C" opacity=".08" />
            <g fill="none" stroke="#fff" strokeWidth="4" opacity=".9">
              <rect x="2" y="2" width={L - 4} height={W - 4} />
              <line x1={L / 2} y1="2" x2={L / 2} y2={W - 2} />
              <circle cx={L / 2} cy={W / 2} r={W * 0.14} />
              <rect x="2" y={W * 0.2} width={L * 0.15} height={W * 0.6} />
              <rect x={L - 2 - L * 0.15} y={W * 0.2} width={L * 0.15} height={W * 0.6} />
              <rect x="2" y={W * 0.36} width={L * 0.055} height={W * 0.28} />
              <rect x={L - 2 - L * 0.055} y={W * 0.36} width={L * 0.055} height={W * 0.28} />
              <path d={`M${L * 0.15 + 2} ${W * 0.4} A ${W * 0.13} ${W * 0.13} 0 0 1 ${L * 0.15 + 2} ${W * 0.6}`} />
              <path d={`M${L * 0.85 - 2} ${W * 0.4} A ${W * 0.13} ${W * 0.13} 0 0 0 ${L * 0.85 - 2} ${W * 0.6}`} />
              {[[2, 2, 1], [2, W - 2, 0], [L - 2, 2, 0], [L - 2, W - 2, 1]].map(([x, y, f], i) => <path key={i} d={`M${x} ${y + (y < W / 2 ? 14 : -14)} A14 14 0 0 ${f} ${x + (x < L / 2 ? 14 : -14)} ${y}`} />)}
            </g>
            <circle cx={L / 2} cy={W / 2} r="5" fill="#fff" />
            <circle cx={L * 0.105} cy={W / 2} r="4" fill="#fff" /><circle cx={L * 0.895} cy={W / 2} r="4" fill="#fff" />
            {/* goals */}
            <rect x="-18" y={W * 0.4} width="18" height={W * 0.2} fill="url(#sc-net)" stroke="#fff" strokeWidth="4" />
            <rect x={L} y={W * 0.4} width="18" height={W * 0.2} fill="url(#sc-net)" stroke="#fff" strokeWidth="4" />
          </g>
          {!d.men.length && <text x={VW / 2} y={VH / 2} textAnchor="middle" className="sc-empty">Scan the token to fill the pitch</text>}
          {d.men.length > 0 && !d.sells && <text x={VW / 2} y={portrait ? VH * 0.1 : VH * 0.12} textAnchor="middle" className="sc-empty good" transform={portrait ? undefined : `translate(${VW * 0.25} 0)`}>✓ No paper hands in this time frame</text>}

          <g transform={`translate(${ball.x} ${ball.y})`} className="sc-ball" aria-hidden="true">
            <g className="sc-ball-spin"><circle r="13" fill="#fff" stroke="#222" strokeWidth="2" /><path d="M0 -6 l5.7 4.1 -2.2 6.7 h-7 l-2.2 -6.7z" fill="#222" /></g>
          </g>

          {canBuy && !mine && (
            <g transform={`translate(${join.x} ${join.y})`} className="sc-join" role="button" tabIndex={0}
              onClick={() => setBuyOpen(true)} onKeyDown={keys(() => setBuyOpen(true))} aria-label="Join the match: buy and get your own player">
              <circle r="30" fill="rgba(255,213,74,.9)" stroke="#8A5A00" strokeWidth="3" strokeDasharray="7 5" />
              <text y="4" textAnchor="middle" className="sc-join-plus">+</text>
              <text y="20" textAnchor="middle" className="sc-join-t">JOIN</text>
            </g>
          )}

          {d.men.map((p, i) => {
            const on = sel === p.h.wallet, you = mine === p;
            const k = KIT[p.team];
            return (
              <g key={p.team + p.h.wallet} transform={`translate(${p.spot.x} ${p.spot.y}) scale(${p.spot.s})`}
                className={"pl " + p.mood + (on ? " sel" : "") + (you ? " me" : "")} style={{ ["--dl" as any]: `${(i % 9) * 0.21}s`, opacity: p.mood === "paper" ? 0.28 + 0.72 * p.left : undefined }}
                role="button" tabIndex={0} onClick={() => pick(p.h.wallet)} onKeyDown={keys(() => pick(p.h.wallet))}
                aria-label={`${you ? "You: " : ""}${p.team === "home" ? "Diamond hands" : "Paper hands"} player ${short(p.h.wallet)}, holds ${pct(n(p.h.pct))}, ${moodName(p)}`}>
                {you && <ellipse cx="0" cy="-2" rx="48" ry="16" fill="url(#sc-me)" />}
                {on && <ellipse cx="0" cy="0" rx="32" ry="10" fill="none" stroke="#1D4ED8" strokeWidth="5" />}
                <g className="pl-move">
                  <Player wallet={p.h.wallet} kit={you ? "#FFB300" : k.kit} trim={k.trim} number={p.place} mood={p.mood} keeper={p.place === 1} you={you} dev={p.h.is_dev} />
                </g>
                {p.mood === "gone" && <text y="-60" textAnchor="middle" className="pl-poof" fontSize="56">💨</text>}
                <g transform="translate(0 20)">
                  <rect x="-34" y="-11" width="68" height="22" rx="11" fill={p.team === "home" ? "#0B5E3E" : "#8E1F10"} stroke="#fff" strokeWidth="2" />
                  <text y="5" textAnchor="middle" className="pl-tag">{p.team === "home" ? pct(n(p.h.pct)) : "−" + fmt(p.amount)}</text>
                </g>
                {p.team === "home" && !you && <circle cx="-26" cy="-98" r="8" fill={RISK_COLOR[p.risk.level]} stroke="#fff" strokeWidth="2.5" />}
                {p.bought > 0 && <g transform="translate(28 -98)"><circle r="11" fill="#0E7A55" stroke="#fff" strokeWidth="2.5" /><text y="5" textAnchor="middle" className="pl-plus">+</text></g>}
                {you && <g transform="translate(0 -112)"><rect x="-26" y="-14" width="52" height="26" rx="13" fill="#FFB300" stroke="#fff" strokeWidth="3" /><text y="5" textAnchor="middle" className="pl-you">YOU</text></g>}
              </g>
            );
          })}
          {/* The latest moves float above everyone, so nobody covers them. */}
          {d.men.map((p) => {
            const pop = d.pops.get(p.h.wallet);
            if (!pop || mine === p) return null;
            return (
              <g key={pop.key} transform={`translate(${p.spot.x} ${p.spot.y - 112 * p.spot.s})`} pointerEvents="none">
                <g className={"pl-pop " + (pop.buy ? "buy" : "sell") + (pop === d.moves[0] ? " newest" : "")}>
                  <rect x="-48" y="-16" width="96" height="28" rx="14" fill={pop.buy ? "#0E7A55" : "#C4321B"} stroke="#fff" strokeWidth="3" />
                  <text y="4" textAnchor="middle" className="pl-pop-t">{pop.buy ? "+" + fmt(pop.amount) : pop.gone ? "SOLD ALL!" : "SOLD!"}</text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="ar-panels">
        <section className="ar-me" aria-label="Your player">
          <div className="ar-h"><b>🎮 Your player</b></div>
          {mine ? (
            <button type="button" className="ar-me-card" onClick={() => setSel(mine.h.wallet)}>
              <svg className="ar-me-face" viewBox="-40 -105 80 110" aria-hidden="true"><Player wallet={mine.h.wallet} kit="#FFB300" trim={KIT[mine.team].trim} number={mine.place} mood={mine.mood} you /></svg>
              <span className="grow">
                <b>You play for {mine.team === "home" ? "💎 Diamond Hands" : "🧻 Paper Hands"}</b>
                <small>#{mine.place} of {mine.team === "home" ? d.home : d.away} · {mine.team === "home" ? `holds ${pct(n(mine.h.pct))}` : `sold ${fmt(mine.amount)} ${symbol}`}</small>
                <small className="mono">{short(mine.h.wallet)}</small>
              </span>
            </button>
          ) : myBench ? (
            <p className="muted">You hold {pct(n(myBench.h.pct))} and wait on the subs bench. Buy more to get on the pitch.</p>
          ) : (
            <p className="muted">{me ? <>Your wallet <span className="mono">{short(me)}</span> isn&apos;t on the pitch yet.</> : "You're not on the pitch yet."} {canBuy ? "Join the match: your player runs on within a minute of buying." : ""}</p>
          )}
          {canBuy && <button type="button" className="ar-enter" onClick={() => setBuyOpen(true)}>{enterLabel}</button>}
          {!member && <FindMe saved={saved} onSave={(v) => { store.set(v); setSaved(v); }} />}
        </section>

        <section className="ar-log" aria-label="Match log">
          <div className="ar-h"><b>📜 Match log</b><span className="muted">{d.moves.length} move{d.moves.length === 1 ? "" : "s"} · {FRAMES.find((f) => f.k === tf)!.label}</span></div>
          {!d.moves.length && <p className="muted">No buys or sells in this time frame.</p>}
          <ol>
            {d.moves.slice(0, 12).map((m) => (
              <li key={m.key}>
                <button type="button" className={m.buy ? "buy" : "sell"} onClick={() => setSel(m.wallet)}>
                  <i aria-hidden="true">{m.buy ? "💎" : m.gone ? "💨" : "🧻"}</i>
                  <span className="grow"><span className="mono">{short(m.wallet)}</span>{same(m.wallet, me) ? " (you)" : m.wallet === dev ? " (dev)" : ""} {m.buy ? "bought" : m.gone ? "sold everything" : "sold"} <b>{fmt(m.amount)}</b></span>
                  <small className="muted">{dur(m.at)}</small>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="club-info hold-card" aria-live="polite" ref={infoRef}>
        {!picked ? <span className="muted">👆 Tap any player to see their bag: how much they hold, how long they&apos;ve held and how likely they are to sell.</span> : (
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <b>{same(picked.h.wallet, me) ? "🎮 You · " : ""}{picked.h.is_dev ? "👑 Dev · " : ""}{pickedMan ? (pickedMan.team === "home" ? `💎 Diamond hands #${pickedMan.place}${pickedMan.place === 1 ? " (keeper: biggest bag)" : ""}` : pickedMan.mood === "gone" ? "💨 Just left the pitch" : `🧻 Paper hands #${pickedMan.place}`) : "🪑 On the subs bench"}</b>{" "}
              <a className="mono" href={walletUrl(explorer, token, picked.h.wallet)} target="_blank" rel="noopener noreferrer">{short(picked.h.wallet)}</a>
            </div>
            <div className="hold-grid">
              <div><span>Holds</span><b>{pct(n(picked.h.pct))}</b><small>of the supply</small></div>
              <div><span>Tokens</span><b>{fmt(n(picked.h.balance))}</b><small>{symbol}</small></div>
              <div><span>Holding for</span><b>{dur(picked.h.acquired_at || picked.h.first_seen_at)}</b><small>{picked.h.acquired_at ? "since first buy" : "since tracking"}</small></div>
              <div><span>Biggest bag</span><b>{fmt(Math.max(n(picked.h.peak_balance), n(picked.h.balance)))}</b><small>{n(picked.h.balance) < n(picked.h.peak_balance) * 0.99 ? `now ${Math.round((n(picked.h.balance) / n(picked.h.peak_balance)) * 100)}% of it` : "still all of it"}</small></div>
            </div>
            {pickedMan && pickedMan.team === "away" && <div>🧻 Sold <b>{fmt(pickedMan.amount)} {symbol}</b> in this time frame{pickedMan.mood === "paper" ? `, ${Math.round(pickedMan.left * 100)}% of the bag left` : ""}.</div>}
            {pickedMan && pickedMan.bought > 0 && <div>🟢 Bought <b>{fmt(pickedMan.bought)} {symbol}</b> more in this time frame.</div>}
            <div className="risk-row">
              <span className={"risk " + picked.risk.level}>Chance to sell: {picked.risk.level} ({picked.risk.score}/100)</span>
              {picked.risk.reasons.length > 0 && <span className="muted">because it {picked.risk.reasons.join(", ")}.</span>}
            </div>
            {pickedTrades.length > 0 && <div className="muted" style={{ fontSize: ".86em" }}>Trades: {pickedTrades.slice(0, 6).map((x) => `${x.side === "buy" ? "bought" : "sold"} ${fmt(n(x.amount))} ${dur(x.at)} ago`).join(" · ")}</div>}
            {!pickedTrades.length && pickedFlow.length > 0 && <div className="muted" style={{ fontSize: ".86em" }}>History: {pickedFlow.slice(0, 5).map((e) => `${e.kind === "buy" ? "bought" : e.kind === "exit" ? "sold all" : `sold ${Math.round(n(e.pct_of_holding))}%`} ${dur(e.created_at)} ago`).join(" · ")}</div>}
            {pickedLinks.length > 0 && <div className="club-conn">🔗 Connected to {pickedLinks.map((l) => { const o = l.a === picked.h.wallet ? l.b : l.a; return <button key={o} type="button" onClick={() => setSel(o)}>{short(o)}{o === dev ? " 👑" : ""}</button>; })}</div>}
            {canBuy && <button type="button" className="ar-enter small" onClick={() => setBuyOpen(true)}>{enterLabel}</button>}
          </div>
        )}
      </div>
      <div className="chess-key">
        <span>💎 green = holding</span><span>😰 shaking + sweat = might sell soon</span><span>🧻 red, faded = sold some</span><span>💨 poof = sold everything</span>
        <span>🧤 keeper = biggest bag</span><span><i style={{ background: RISK_COLOR.low }} /><i style={{ background: RISK_COLOR.medium }} /><i style={{ background: RISK_COLOR.high }} /> chance to sell</span><span>➕ bought more</span><span>👑 dev</span><span>🟡 YOU = your player</span>
      </div>

      {(d.bench.length > 0 || d.gone.length > 0) && (
        <div className="bench">
          {d.bench.length > 0 && <>
            <div className="bench-head"><b>🪑 Subs bench</b><span className="muted">holders who didn&apos;t fit on the pitch · colour = chance to sell</span></div>
            <div className="bench-row">
              {d.bench.map((b) => (
                <button key={b.h.wallet} type="button" className={"bencher " + b.risk.level} aria-pressed={sel === b.h.wallet} onClick={() => pick(b.h.wallet)}
                  aria-label={`${short(b.h.wallet)}, ${b.risk.level} chance to sell`} title={`${short(b.h.wallet)} · ${b.risk.level} chance to sell`}>
                  <i style={{ background: RISK_COLOR[b.risk.level] }} />{b.h.is_dev ? "👑" : ""}{same(b.h.wallet, me) ? "🎮 " : ""}{short(b.h.wallet).slice(0, 6)}
                </button>
              ))}
            </div>
          </>}
          {d.gone.length > 0 && <div className="muted" style={{ fontSize: ".84em" }}>💨 Left the pitch: {d.gone.length} wallet{d.gone.length > 1 ? "s" : ""} sold everything{d.gone.slice(0, 5).map((g) => ` · ${short(g.h.wallet)}${g.at ? ` ${dur(g.at)} ago` : ""}`).join("")}.</div>}
        </div>
      )}

      <div className="arena-timeline" role="img" aria-label="Buys and sells over the time frame">
        {d.slots.map((s, i) => (
          <div key={i} className="tl-slot" title={`Buys ${fmt(s.buy)} · Sells ${fmt(s.sell)}`}>
            <span className="tb" style={{ height: `${Math.sqrt(s.buy / slotMax) * 100}%` }} />
            <span className="ts" style={{ height: `${Math.sqrt(s.sell / slotMax) * 100}%` }} />
          </div>
        ))}
        <div className="tl-axis"><span>{tf === "all" ? "Start" : FRAMES.find((f) => f.k === tf)!.label + " ago"}</span><span>Now</span></div>
      </div>

      {buyOpen && chain && <EnterSheet chain={chain} token={token} symbol={symbol} more={!!mine && mine.team === "home"} onClose={() => setBuyOpen(false)} />}
    </div>
  );
}


/** Paste your wallet address to find your player (kept on this device only). */
function FindMe({ saved, onSave }: { saved: string; onSave: (v: string) => void }) {
  const [v, setV] = useState("");
  if (saved) return <button type="button" className="ar-link" onClick={() => onSave("")}>Not your wallet? Forget it</button>;
  return (
    <form className="ar-find" onSubmit={(e) => { e.preventDefault(); const a = v.trim(); if (a.length >= 32) onSave(a); }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Paste your wallet address" aria-label="Your wallet address" spellCheck={false} autoComplete="off" />
      <button type="submit" className="btn small" disabled={v.trim().length < 32}>Find me</button>
    </form>
  );
}

/** Pick an amount, then buy in the Wallet with it filled in. */
function EnterSheet({ chain, token, symbol, more, onClose }: { chain: string; token: string; symbol: string; more: boolean; onClose: () => void }) {
  const [usd, setUsd] = useState(25); const [custom, setCustom] = useState("");
  const dollars = custom ? Number(custom) : usd;
  const ok = dollars > 0 && dollars <= 100_000;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const href = `/wallet?chain=${encodeURIComponent(chain)}&buy=${encodeURIComponent(token)}&quick=1&usd=${encodeURIComponent(String(dollars))}`;
  return (
    <div className="aw-sheet" role="dialog" aria-modal="true" aria-label={`Buy ${symbol}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-sheet-in sm-sheet ar-sheet">
        <div className="row" style={{ justifyContent: "space-between" }}><b>{more ? `⚽ Buy more ${symbol}` : `⚽ Join the ${symbol} match`}</b><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <b>How much do you want to spend?</b>
        <div className="sm-presets">
          {PRESETS.map((p) => <button key={p} type="button" className={!custom && usd === p ? "on" : ""} onClick={() => { setUsd(p); setCustom(""); }}>${p}</button>)}
          <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other $" aria-label="Other amount in dollars" />
        </div>
        <small className="tx-dim">Next you&apos;ll see the price and safety check in your wallet and confirm the buy there. Your player runs onto the pitch within a minute after it goes through.</small>
        <a className={"tx-cta buy" + (ok ? "" : " off")} href={ok ? href : undefined} aria-disabled={!ok}>{ok ? `Continue: buy $${dollars} of ${symbol}` : "Pick an amount"}</a>
        <small className="tx-dim">New coins are very risky. Only spend what you can afford to lose. Not financial advice.</small>
      </div>
    </div>
  );
}
