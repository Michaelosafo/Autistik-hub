"use client";
import { walletUrl } from "@/lib/explorer";
import { useEffect, useMemo, useRef, useState } from "react";
import { seatOf, sellRisk, type EventRow, type HolderRow, type LinkRow, type Risk } from "@/lib/analytics-insights";

/**
 * The chess arena: every tracked holder of the token is a piece on one big board, buyers and holders against sellers,
 * for a chosen time frame. Holders are the light army filling the board from the bottom, sellers the dark army from
 * the top. On each side the wallet that moved the most is the King, then the Queen, Rooks, Bishops, Knights and
 * Pawns, so the biggest players are the strongest pieces. Your own piece wears a gold "YOU" flag, the latest buys and
 * sells pop up over the pieces that made them, and "Enter the arena" opens an amount picker that buys through the
 * Wallet. Wallets that sold everything are out of the game; any that don't fit on the board wait on the bench.
 */
export type TradeRow = { wallet: string; side: "buy" | "sell"; amount: number | string; balance_after: number | string | null; pct_after: number | string | null; at: string; tx_hash?: string };
type Props = {
  holders: HolderRow[]; events: EventRow[]; trades?: TradeRow[]; links: LinkRow[]; explorer: string; token: string; symbol: string;
  /** The network key, for the Buy link. */
  chain?: string;
  /** Buying works on this network through the Wallet. */
  canBuy?: boolean;
  /** The signed-in member's own wallet on this network, so their piece can be found. */
  me?: string | null;
};
type TF = "1h" | "6h" | "24h" | "7d" | "all";
type Side = "buy" | "sell";
type Kind = "K" | "Q" | "R" | "B" | "N" | "P";
type Piece = { h: HolderRow; side: Side; amount: number; bought: number; kind: Kind; file: number; rank: number; risk: Risk; place: number };
type Bencher = { h: HolderRow; risk: Risk };
type Move = { wallet: string; buy: boolean; amount: number; at: string; key: string };

const FRAMES: { k: TF; label: string; ms: number }[] = [
  { k: "1h", label: "1H", ms: 3_600_000 }, { k: "6h", label: "6H", ms: 6 * 3_600_000 }, { k: "24h", label: "24H", ms: 86_400_000 },
  { k: "7d", label: "7D", ms: 7 * 86_400_000 }, { k: "all", label: "All", ms: Infinity },
];
// Strongest first. The ︎ asks for the plain chess symbol rather than an emoji picture.
const ORDER: Kind[] = ["K", "Q", "R", "R", "B", "B", "N", "N", "P", "P", "P", "P", "P", "P", "P", "P"];
const GLYPH: Record<Side, Record<Kind, string>> = {
  buy: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙" },
  sell: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" },
};
const NAME: Record<Kind, string> = { K: "King", Q: "Queen", R: "Rook", B: "Bishop", N: "Knight", P: "Pawn" };
// Back-rank files for each piece, in the usual chess order: R N B Q K B N R.
const BACK: Record<Exclude<Kind, "P">, number[]> = { K: [4], Q: [3], R: [0, 7], B: [2, 5], N: [1, 6] };
const PAWN_FILES = [3, 4, 2, 5, 1, 6, 0, 7]; // biggest pawns in the centre
const SQ = 100, BOARD = SQ * 8, PAD = 28;
const RISK_COLOR = { low: "#2BC48F", medium: "#F5B82E", high: "#F0563A" } as const;
const PRESETS = [5, 10, 25, 50, 100];
const ME_KEY = "ar-me";

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

export default function Arena({ holders, events, trades = [], links, explorer, token, symbol, chain, canBuy = false, me: member = null }: Props) {
  const [tf, setTf] = useState<TF>("24h");
  const [sel, setSel] = useState<string | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);
  // Your wallet: the signed-in member's own, or one pasted into "Find my piece" (kept on this device).
  const [saved, setSaved] = useState("");
  useEffect(() => { setSaved(store.get()); }, []);
  const me = member || saved || null;
  const dev = holders.find((h) => h.is_dev)?.wallet || null;

  const d = useMemo(() => {
    const frame = FRAMES.find((f) => f.k === tf)!;
    const since = frame.ms === Infinity ? 0 : Date.now() - frame.ms;
    // Live trades (every buy and sell through the pool) when we have them; otherwise top-wallet balance changes.
    const live = trades.length > 0;
    const win: Move[] = live
      ? trades.filter((x) => Date.parse(x.at) >= since).map((x, i) => ({ wallet: x.wallet, buy: x.side === "buy", amount: n(x.amount), at: x.at, key: (x.tx_hash || x.at) + x.wallet + x.side + i }))
      : events.filter((e) => Date.parse(e.created_at) >= since).map((e, i) => ({ wallet: e.wallet, buy: e.kind === "buy", amount: n(e.amount), at: e.created_at, key: e.created_at + e.wallet + e.kind + i }));
    win.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const flow = new Map<string, { bought: number; sold: number }>();
    for (const e of win) {
      const f = flow.get(e.wallet) || { bought: 0, sold: 0 };
      if (e.buy) f.bought += e.amount; else f.sold += e.amount;
      flow.set(e.wallet, f);
    }
    const byWallet = new Map(holders.map((h) => [h.wallet, h]));
    // Traders we don't follow yet still get a piece, from what the trade told us.
    const latest = new Map<string, TradeRow>();
    for (const x of trades) if (!latest.has(x.wallet)) latest.set(x.wallet, x);
    const rowFor = (w: string): HolderRow => byWallet.get(w) || {
      wallet: w, rank: null, pct: latest.get(w)?.pct_after ?? null, balance: latest.get(w)?.balance_after ?? 0,
      peak_balance: n(latest.get(w)?.balance_after) + (flow.get(w)?.sold || 0), is_dev: w === dev, is_contract: false, label: null, in_top: false,
      acquired_at: null, first_seen_at: trades.filter((x) => x.wallet === w).slice(-1)[0]?.at || new Date().toISOString(),
    };
    const buyVol = win.filter((e) => e.buy).reduce((a, e) => a + e.amount, 0);
    const sellVol = win.filter((e) => !e.buy).reduce((a, e) => a + e.amount, 0);
    const total = buyVol + sellVol;
    const power = total ? buyVol / total : 0.5;
    const risk = (h: HolderRow) => sellRisk(h, events, links, dev);

    // Two armies. Sellers: wallets that sold in this time frame, ranked by how much they sold.
    // Holders: everyone still holding, ranked by the size of their bag; the ones who bought more get a "+" tag.
    const sellers: { h: HolderRow; amount: number; bought: number }[] = [];
    const holding: { h: HolderRow; amount: number; bought: number }[] = [];
    const seen = new Set<string>();
    for (const h of holders) {
      if (h.is_contract || !(h.in_top || h.is_dev)) continue;
      seen.add(h.wallet);
      const f = flow.get(h.wallet);
      if (f && f.sold > f.bought) sellers.push({ h, amount: f.sold - f.bought, bought: 0 });
      else if (seatOf(h) !== "left") holding.push({ h, amount: n(h.pct), bought: f ? f.bought - f.sold : 0 });
    }
    for (const [w, f] of flow) {
      if (seen.has(w) || byWallet.get(w)?.is_contract) continue;
      const h = rowFor(w);
      if (f.sold > f.bought) sellers.push({ h, amount: f.sold - f.bought, bought: 0 });
      else if (f.bought > f.sold) holding.push({ h, amount: n(h.pct), bought: f.bought - f.sold });
    }
    // Your wallet is tracked but sits outside the top: it still gets a piece.
    if (me && !seen.has(me) && ![...flow.keys()].some((w) => same(w, me))) {
      const h = holders.find((x) => same(x.wallet, me));
      if (h && !h.is_contract && seatOf(h) !== "left") holding.push({ h, amount: n(h.pct), bought: 0 });
    }
    sellers.sort((a, b) => b.amount - a.amount);
    holding.sort((a, b) => b.amount - a.amount);

    // The whole board is the table: each army fills rows from its own back rank, 8 pieces to a row.
    let rowsS = Math.ceil(sellers.length / 8), rowsH = Math.ceil(holding.length / 8);
    if (rowsS + rowsH > 8) { rowsS = Math.min(rowsS, Math.max(2, 8 - rowsH)); rowsH = 8 - rowsS; }
    const pieces: Piece[] = [];
    const place = (side: Side, list: typeof sellers, rows: number) => {
      let shown = list.slice(0, rows * 8);
      // Never leave you on the bench.
      const mine = me ? list.findIndex((x) => same(x.h.wallet, me)) : -1;
      if (mine >= shown.length && shown.length) shown = [...shown.slice(0, -1), list[mine]];
      const used: Record<string, number> = {};
      shown.forEach((x, i) => {
        const row = Math.floor(i / 8), col = i % 8;
        const kind = i < 16 ? ORDER[i] : "P";
        const k = used[kind] = (used[kind] || 0) + 1;
        const file = row === 0 ? BACK[kind as Exclude<Kind, "P">][k - 1] : PAWN_FILES[col];
        pieces.push({ h: x.h, side, amount: x.amount, bought: x.bought, kind, file, rank: side === "buy" ? 7 - row : row, risk: risk(x.h), place: i + 1 });
      });
      return shown.length;
    };
    place("sell", sellers, rowsS);
    const placedH = place("buy", holding, rowsH);
    // The first empty square on the holders' side, where a newcomer would enter.
    const taken = new Set(pieces.map((p) => p.rank * 8 + p.file));
    let free: { file: number; rank: number } | null = null;
    for (let rank = 7; rank >= rowsS && !free; rank--) {
      const file = PAWN_FILES.find((f) => !taken.has(rank * 8 + f));
      if (file != null) free = { file, rank };
    }

    // The bench: holders who didn't fit on the board.
    const onBoard = new Set(pieces.map((p) => p.h.wallet));
    const bench: Bencher[] = holding.filter((x) => !onBoard.has(x.h.wallet)).map((x) => ({ h: x.h, risk: risk(x.h) })).slice(0, 40);
    const out = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev) && seatOf(h) === "left");
    const buyers = holding.filter((x) => x.bought > 0).length;

    // The latest move by each wallet on the board pops up over its piece.
    const pops = new Map<string, Move>();
    for (const m of win.slice(0, 10)) if (onBoard.has(m.wallet) && !pops.has(m.wallet)) pops.set(m.wallet, m);

    // Timeline: 12 slots across the time frame.
    const start = since || (win.length ? Math.min(...win.map((e) => Date.parse(e.at))) : Date.now() - 86_400_000);
    const span = Math.max(60_000, Date.now() - start);
    const slots = Array.from({ length: 12 }, () => ({ buy: 0, sell: 0 }));
    for (const e of win) {
      const i = Math.min(11, Math.max(0, Math.floor(((Date.parse(e.at) - start) / span) * 12)));
      if (e.buy) slots[i].buy += e.amount; else slots[i].sell += e.amount;
    }
    return { pieces, bench, out, buyVol, sellVol, total, power, slots, buyers, holders: holding.length, sellers: sellers.length, moves: win, pops, free };
  }, [tf, holders, events, trades, links, dev, me]);

  const { power, total } = d;
  const check = total > 0 && (power >= 0.7 || power <= 0.3);
  const verdict = !total ? (d.holders ? "🛡️ Holders are holding strong: no sells in this time frame" : "No wallets tracked yet") : power >= 0.7 ? "♔ Check! Buyers are crushing the sellers" : power >= 0.56 ? "♙ Buyers are winning"
    : power <= 0.3 ? "♚ Check! Sellers are crushing the buyers" : power <= 0.44 ? "♟ Sellers are winning" : "⚖️ It's an even game";
  const pickedPiece = sel ? d.pieces.find((p) => p.h.wallet === sel) : null;
  const pickedBench = sel && !pickedPiece ? d.bench.find((b) => b.h.wallet === sel) : null;
  const picked = pickedPiece || pickedBench || null;
  const pickedTrades = picked ? trades.filter((x) => x.wallet === picked.h.wallet) : [];
  const pickedFlow = picked ? events.filter((e) => e.wallet === picked.h.wallet) : [];
  const pickedLinks = picked ? links.filter((l) => l.a === picked.h.wallet || l.b === picked.h.wallet) : [];
  const slotMax = Math.max(1, ...d.slots.map((s) => Math.max(s.buy, s.sell)));
  const pick = (w: string) => setSel(sel === w ? null : w);
  const mine = me ? d.pieces.find((p) => same(p.h.wallet, me)) : undefined;
  const myBench = me && !mine ? d.bench.find((b) => same(b.h.wallet, me)) : undefined;
  const mySide = (p: Piece) => p.side === "buy" ? (p.h.in_top || p.h.is_dev ? "holders" : "buyers") : "sellers";
  // On a phone, bring the holding card into view when someone is tapped.
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sel || !infoRef.current) return;
    const r = infoRef.current.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight - 70) infoRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [sel]);
  const keys = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); f(); } };
  const king = (side: Side) => d.pieces.find((p) => p.side === side && p.kind === "K");
  const threatened = power >= 0.7 ? king("sell") : power <= 0.3 ? king("buy") : undefined;
  const last = d.moves[0];
  const enterLabel = mine && mine.side === "buy" ? "➕ Buy more" : "⚔️ Enter the arena";

  return (
    <div className="arena chess">
      <div className="arena-top">
        <div className="tf" role="tablist" aria-label="Time frame">
          {FRAMES.map((f) => <button key={f.k} type="button" role="tab" aria-selected={tf === f.k} onClick={() => setTf(f.k)}>{f.label}</button>)}
        </div>
        <b className={"arena-verdict" + (check ? " check" : "")}>{verdict}</b>
      </div>

      <div className="power" role="img" aria-label={`Buy volume ${fmt(d.buyVol)} ${symbol}, sell volume ${fmt(d.sellVol)} ${symbol}`}>
        <span className="pb" style={{ width: `${power * 100}%` }}><b>♙ Buyers {Math.round(power * 100)}%</b><small>{d.buyers} bought · {fmt(d.buyVol)}</small></span>
        <span className="ps"><b>Sellers {Math.round((1 - power) * 100)}% ♟</b><small>{d.sellers} sold · {fmt(d.sellVol)}</small></span>
        <i className="clash" style={{ left: `${power * 100}%` }} aria-hidden="true">⚡</i>
      </div>

      {/* The latest move, like a game commentator. */}
      <button type="button" className={"ar-ticker " + (last ? (last.buy ? "buy" : "sell") : "")} key={last?.key || "none"} onClick={() => last && setSel(last.wallet)} disabled={!last}>
        <span className="live-dot">LIVE</span>
        {last ? <span><b>{last.buy ? "♙" : "♟"} {short(last.wallet)}</b>{same(last.wallet, me) ? " (you)" : last.wallet === dev ? " (dev)" : ""} {last.buy ? "bought" : "sold"} <b>{fmt(last.amount)} {symbol}</b> · {dur(last.at)} ago</span>
          : <span className="muted">No moves in this time frame yet. New buys and sells appear here within a minute.</span>}
      </button>

      <div className="chess-wrap ar-table">
        <div className="chess-banner s">♟ SELLERS · {d.sellers} wallet{d.sellers === 1 ? "" : "s"} sold</div>
        <svg className="chess-board" viewBox={`0 0 ${BOARD + PAD * 2} ${BOARD + PAD * 2}`} role="img"
          aria-label={`Chess arena for ${symbol}: ${d.holders} holder pieces against ${d.sellers} seller pieces. ${verdict}.`}>
          <defs>
            <linearGradient id="cb-frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9C46A" /><stop offset=".5" stopColor="#8A5A1E" /><stop offset="1" stopColor="#E9C46A" /></linearGradient>
            <radialGradient id="cb-buy" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#5BE3B0" stopOpacity=".55" /><stop offset="1" stopColor="#5BE3B0" stopOpacity="0" /></radialGradient>
            <radialGradient id="cb-sell" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#FF6B4A" stopOpacity=".55" /><stop offset="1" stopColor="#FF6B4A" stopOpacity="0" /></radialGradient>
            <radialGradient id="cb-me" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#FFD54A" stopOpacity=".95" /><stop offset=".7" stopColor="#FFB300" stopOpacity=".45" /><stop offset="1" stopColor="#FFB300" stopOpacity="0" /></radialGradient>
          </defs>
          <rect width={BOARD + PAD * 2} height={BOARD + PAD * 2} rx="22" fill="url(#cb-frame)" />
          <rect x={PAD - 4} y={PAD - 4} width={BOARD + 8} height={BOARD + 8} rx="6" fill="#3B2410" />
          <g transform={`translate(${PAD} ${PAD})`}>
            {Array.from({ length: 64 }, (_, i) => {
              const f = i % 8, r = Math.floor(i / 8);
              return <rect key={i} x={f * SQ} y={r * SQ} width={SQ} height={SQ} fill={(f + r) % 2 ? "#B58863" : "#F0D9B5"} />;
            })}
            {/* who controls the board: green glow from the bottom, red from the top */}
            <rect x="0" y={BOARD * (1 - power)} width={BOARD} height={BOARD * power} fill="#2BC48F" opacity=".1" />
            <rect x="0" y="0" width={BOARD} height={BOARD * (1 - power)} fill="#F0563A" opacity=".1" />
            <line x1="0" x2={BOARD} y1={BOARD * (1 - power)} y2={BOARD * (1 - power)} stroke="#FFE58F" strokeWidth="4" strokeDasharray="10 8" className="cb-front" />
            {threatened && <rect x={threatened.file * SQ + 3} y={threatened.rank * SQ + 3} width={SQ - 6} height={SQ - 6} rx="8" fill="none" stroke="#E5484D" strokeWidth="6" className="cb-check" />}
            {!d.pieces.length && <text x={BOARD / 2} y={BOARD / 2} textAnchor="middle" className="cb-empty">Scan the token to fill the board</text>}
            {d.pieces.length > 0 && !d.sellers && <text x={BOARD / 2} y={SQ * 0.6} textAnchor="middle" className="cb-empty good">✓ No sellers in this time frame</text>}
            {canBuy && !mine && d.free && (
              <g transform={`translate(${d.free.file * SQ + SQ / 2} ${d.free.rank * SQ + SQ / 2})`} className="cb-enter" role="button" tabIndex={0}
                onClick={() => setBuyOpen(true)} onKeyDown={keys(() => setBuyOpen(true))} aria-label="Enter the arena: buy and take a seat on the board">
                <rect x="-44" y="-44" width="88" height="88" rx="14" fill="rgba(255,213,74,.25)" stroke="#B8860B" strokeWidth="4" strokeDasharray="10 7" />
                <text y="8" textAnchor="middle" className="cb-enter-plus">+</text>
                <text y="36" textAnchor="middle" className="cb-enter-t">ENTER</text>
              </g>
            )}
            {d.pieces.map((p, i) => {
              const x = p.file * SQ + SQ / 2, y = p.rank * SQ + SQ / 2;
              const on = sel === p.h.wallet, you = mine === p;
              const pop = d.pops.get(p.h.wallet);
              return (
                <g key={p.h.wallet} transform={`translate(${x} ${y})`} className={"cb-piece " + p.side + (on ? " sel" : "") + (you ? " me" : "")} style={{ ["--dl" as any]: `${(i % 8) * 0.18}s` }}
                  role="button" tabIndex={0} onClick={() => pick(p.h.wallet)} onKeyDown={keys(() => pick(p.h.wallet))}
                  aria-label={`${you ? "You: " : ""}${p.side === "buy" ? "Holder" : "Seller"} ${NAME[p.kind]}: ${short(p.h.wallet)} ${p.side === "buy" ? `holds ${pct(n(p.h.pct))}` : `sold ${fmt(p.amount)} ${symbol}`}, holding for ${dur(p.h.acquired_at || p.h.first_seen_at)}, ${p.risk.level} chance to sell`}>
                  {you ? <circle r="50" fill="url(#cb-me)" className="cb-me-glow" /> : <circle r="44" fill={`url(#cb-${p.side})`} />}
                  {on && <circle r="44" fill="none" stroke="#1D4ED8" strokeWidth="5" />}
                  {you && <circle r="46" fill="none" stroke="#B8860B" strokeWidth="5" />}
                  <g className="cb-lift">
                    <text y="24" textAnchor="middle" className="cb-glyph shadow">{GLYPH.sell[p.kind]}{"︎"}</text>
                    <text y="20" textAnchor="middle" className="cb-glyph">{GLYPH.sell[p.kind]}{"︎"}</text>
                  </g>
                  {p.h.is_dev && <text x="30" y="-26" textAnchor="middle" fontSize="22">👑</text>}
                  <rect x="-34" y="30" width="68" height="18" rx="9" fill={p.side === "buy" ? "#0E7A55" : "#8E1F10"} />
                  <text y="43" textAnchor="middle" className="cb-amt">{p.side === "buy" ? pct(n(p.h.pct)) : "−" + fmt(p.amount)}</text>
                  {p.side === "buy" && !you && <circle cx="-34" cy="-34" r="9" fill={RISK_COLOR[p.risk.level]} stroke="#fff" strokeWidth="2.5" />}
                  {p.bought > 0 && !pop && <g transform="translate(34 -34)"><circle r="12" fill="#0E7A55" stroke="#fff" strokeWidth="2.5" /><text y="5" textAnchor="middle" className="cb-plus">+</text></g>}
                  {you && <g transform="translate(0 -40)"><rect x="-24" y="-13" width="48" height="24" rx="12" fill="#FFB300" stroke="#fff" strokeWidth="2.5" /><text y="5" textAnchor="middle" className="cb-you">YOU</text></g>}
                </g>
              );
            })}
            {/* The latest moves float above every piece, so no square covers them. */}
            {d.pieces.map((p) => {
              const pop = d.pops.get(p.h.wallet);
              if (!pop || mine === p) return null;
              return (
                <g key={pop.key} transform={`translate(${p.file * SQ + SQ / 2} ${p.rank * SQ + SQ / 2})`} className="cb-pop-at" pointerEvents="none">
                  <g className={"cb-pop " + (pop.buy ? "buy" : "sell") + (pop === d.moves[0] ? " newest" : "")}>
                    <rect x="-40" y="-52" width="80" height="24" rx="12" fill={pop.buy ? "#0E7A55" : "#C4321B"} stroke="#fff" strokeWidth="2.5" />
                    <text y="-34" textAnchor="middle" className="cb-pop-t">{(pop.buy ? "+" : "−") + fmt(pop.amount)}</text>
                  </g>
                </g>
              );
            })}
          </g>
          {"abcdefgh".split("").map((c, i) => <text key={c} x={PAD + i * SQ + SQ / 2} y={BOARD + PAD * 2 - 8} textAnchor="middle" className="cb-coord">{c}</text>)}
          {Array.from({ length: 8 }, (_, i) => <text key={i} x={12} y={PAD + i * SQ + SQ / 2 + 5} textAnchor="middle" className="cb-coord">{8 - i}</text>)}
        </svg>
        <div className="chess-banner b">♙ HOLDERS · {d.holders} wallet{d.holders === 1 ? "" : "s"} holding</div>
      </div>

      <div className="ar-panels">
        <section className="ar-me" aria-label="Your player">
          <div className="ar-h"><b>🎮 Your player</b></div>
          {mine ? (
            <button type="button" className="ar-me-card" onClick={() => setSel(mine.h.wallet)}>
              <span className={"ar-me-glyph " + mine.side}>{GLYPH[mine.side][mine.kind]}{"︎"}</span>
              <span className="grow">
                <b>You are the {mine.side === "buy" ? "" : "seller "}{NAME[mine.kind]}</b>
                <small>#{mine.place} of {mine.side === "buy" ? d.holders : d.sellers} {mySide(mine)} · {mine.side === "buy" ? `holds ${pct(n(mine.h.pct))}` : `sold ${fmt(mine.amount)} ${symbol}`}</small>
                <small className="mono">{short(mine.h.wallet)}</small>
              </span>
            </button>
          ) : myBench ? (
            <p className="muted">You hold {pct(n(myBench.h.pct))} and wait on the bench below. Buy more to win a square on the board.</p>
          ) : (
            <p className="muted">{me ? <>Your wallet <span className="mono">{short(me)}</span> isn&apos;t on the board yet.</> : "You're not on the board yet."} {canBuy ? "Enter the arena to take a seat: your piece appears within a minute of buying." : ""}</p>
          )}
          {canBuy && <button type="button" className="ar-enter" onClick={() => setBuyOpen(true)}>{enterLabel}</button>}
          {!member && <FindMe saved={saved} onSave={(v) => { store.set(v); setSaved(v); }} />}
        </section>

        <section className="ar-log" aria-label="Game log">
          <div className="ar-h"><b>📜 Game log</b><span className="muted">{d.moves.length} move{d.moves.length === 1 ? "" : "s"} · {FRAMES.find((f) => f.k === tf)!.label}</span></div>
          {!d.moves.length && <p className="muted">No buys or sells in this time frame.</p>}
          <ol>
            {d.moves.slice(0, 12).map((m) => (
              <li key={m.key}>
                <button type="button" className={m.buy ? "buy" : "sell"} onClick={() => setSel(m.wallet)}>
                  <i aria-hidden="true">{m.buy ? "♙" : "♟"}</i>
                  <span className="grow"><span className="mono">{short(m.wallet)}</span>{same(m.wallet, me) ? " (you)" : m.wallet === dev ? " (dev)" : ""} {m.buy ? "bought" : "sold"} <b>{fmt(m.amount)}</b></span>
                  <small className="muted">{dur(m.at)}</small>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="club-info hold-card" aria-live="polite" ref={infoRef}>
        {!picked ? <span className="muted">👆 Tap any piece to see its holdings: how much it holds, how long it&apos;s held and how likely it is to sell.</span> : (
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <b>{same(picked.h.wallet, me) ? "🎮 You · " : ""}{picked.h.is_dev ? "👑 Dev · " : ""}{pickedPiece ? `${GLYPH[pickedPiece.side][pickedPiece.kind]} ${pickedPiece.side === "buy" ? "Holder" : "Seller"} ${NAME[pickedPiece.kind]}` : "🪑 On the bench"}</b>{" "}
              <a className="mono" href={walletUrl(explorer, token, picked.h.wallet)} target="_blank" rel="noopener noreferrer">{short(picked.h.wallet)}</a>
            </div>
            <div className="hold-grid">
              <div><span>Holds</span><b>{pct(n(picked.h.pct))}</b><small>of the supply</small></div>
              <div><span>Tokens</span><b>{fmt(n(picked.h.balance))}</b><small>{symbol}</small></div>
              <div><span>Holding for</span><b>{dur(picked.h.acquired_at || picked.h.first_seen_at)}</b><small>{picked.h.acquired_at ? "since first buy" : "since tracking"}</small></div>
              <div><span>Biggest bag</span><b>{fmt(Math.max(n(picked.h.peak_balance), n(picked.h.balance)))}</b><small>{n(picked.h.balance) < n(picked.h.peak_balance) * 0.99 ? `now ${Math.round((n(picked.h.balance) / n(picked.h.peak_balance)) * 100)}% of it` : "still all of it"}</small></div>
            </div>
            {pickedPiece && pickedPiece.side === "sell" && <div>🗡️ Sold <b>{fmt(pickedPiece.amount)} {symbol}</b> in this time frame.</div>}
            {pickedPiece && pickedPiece.bought > 0 && <div>🟢 Bought <b>{fmt(pickedPiece.bought)} {symbol}</b> more in this time frame.</div>}
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
        <span>♔ King = biggest bag (or biggest seller)</span><span>♕ Queen = 2nd</span><span>♖ ♗ ♘ next</span><span>♙ Pawns = smaller</span>
        <span><i style={{ background: RISK_COLOR.low }} /><i style={{ background: RISK_COLOR.medium }} /><i style={{ background: RISK_COLOR.high }} /> chance to sell</span><span>➕ bought more</span><span>👑 dev</span><span>🟡 YOU = your piece</span>
      </div>

      {(d.bench.length > 0 || d.out.length > 0) && (
        <div className="bench">
          <div className="bench-head"><b>🪑 On the bench</b><span className="muted">holders who didn&apos;t fit on the board · colour = chance to sell</span></div>
          <div className="bench-row">
            {d.bench.length ? d.bench.map((b) => (
              <button key={b.h.wallet} type="button" className={"bencher " + b.risk.level} aria-pressed={sel === b.h.wallet} onClick={() => pick(b.h.wallet)}
                aria-label={`${short(b.h.wallet)}, ${b.risk.level} chance to sell`} title={`${short(b.h.wallet)} · ${b.risk.level} chance to sell`}>
                <i style={{ background: RISK_COLOR[b.risk.level] }} />{b.h.is_dev ? "👑" : ""}{same(b.h.wallet, me) ? "🎮 " : ""}{short(b.h.wallet).slice(0, 6)}
              </button>
            )) : <span className="muted">Every holder is on the board.</span>}
          </div>
          {d.out.length > 0 && <div className="muted" style={{ fontSize: ".84em" }}>❌ Out of the game: {d.out.length} wallet{d.out.length > 1 ? "s" : ""} sold everything.</div>}
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

      {buyOpen && chain && <EnterSheet chain={chain} token={token} symbol={symbol} more={!!mine && mine.side === "buy"} onClose={() => setBuyOpen(false)} />}
    </div>
  );
}

/** Paste your wallet address to find your piece (kept on this device only). */
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
        <div className="row" style={{ justifyContent: "space-between" }}><b>{more ? `⚔️ Buy more ${symbol}` : `⚔️ Enter the ${symbol} arena`}</b><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <b>How much do you want to spend?</b>
        <div className="sm-presets">
          {PRESETS.map((p) => <button key={p} type="button" className={!custom && usd === p ? "on" : ""} onClick={() => { setUsd(p); setCustom(""); }}>${p}</button>)}
          <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Other $" aria-label="Other amount in dollars" />
        </div>
        <small className="tx-dim">Next you&apos;ll see the price and safety check in your wallet and confirm the buy there. Your piece joins the board within a minute after it goes through.</small>
        <a className={"tx-cta buy" + (ok ? "" : " off")} href={ok ? href : undefined} aria-disabled={!ok}>{ok ? `Continue: buy $${dollars} of ${symbol}` : "Pick an amount"}</a>
        <small className="tx-dim">New coins are very risky. Only spend what you can afford to lose. Not financial advice.</small>
      </div>
    </div>
  );
}
