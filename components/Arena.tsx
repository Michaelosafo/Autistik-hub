"use client";
import { useMemo, useState } from "react";
import { seatOf, sellRisk, type EventRow, type HolderRow, type LinkRow, type Risk } from "@/lib/analytics-insights";

/**
 * The chess battle: buyers against sellers among the token's top wallets, for a chosen time frame.
 * Buyers are the light army at the bottom, sellers the dark army at the top. On each side the wallet that moved
 * the most is the King, then the Queen, Rooks, Bishops, Knights and Pawns, so the biggest players are the
 * strongest pieces. The side winning by volume pushes its pawns forward and can put the other side in check.
 * Holders who didn't move wait on the bench, coloured by how likely they are to sell; wallets that sold
 * everything are out of the game.
 */
type Props = { holders: HolderRow[]; events: EventRow[]; links: LinkRow[]; explorer: string; token: string; symbol: string };
type TF = "1h" | "6h" | "24h" | "7d" | "all";
type Side = "buy" | "sell";
type Kind = "K" | "Q" | "R" | "B" | "N" | "P";
type Piece = { h: HolderRow; side: Side; amount: number; kind: Kind; file: number; rank: number; risk: Risk };
type Bencher = { h: HolderRow; risk: Risk };

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

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const fmt = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const pct = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : "<0.01") + "%";
const dur = (t?: string | null) => {
  if (!t) return "–";
  const h = (Date.now() - Date.parse(t)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

export default function Arena({ holders, events, links, explorer, token, symbol }: Props) {
  const [tf, setTf] = useState<TF>("24h");
  const [sel, setSel] = useState<string | null>(null);
  const dev = holders.find((h) => h.is_dev)?.wallet || null;

  const d = useMemo(() => {
    const frame = FRAMES.find((f) => f.k === tf)!;
    const since = frame.ms === Infinity ? 0 : Date.now() - frame.ms;
    const win = events.filter((e) => Date.parse(e.created_at) >= since);
    const flow = new Map<string, { bought: number; sold: number }>();
    for (const e of win) {
      const f = flow.get(e.wallet) || { bought: 0, sold: 0 };
      if (e.kind === "buy") f.bought += n(e.amount); else f.sold += n(e.amount);
      flow.set(e.wallet, f);
    }
    const byWallet = new Map(holders.map((h) => [h.wallet, h]));
    const buyVol = win.filter((e) => e.kind === "buy").reduce((a, e) => a + n(e.amount), 0);
    const sellVol = win.filter((e) => e.kind !== "buy").reduce((a, e) => a + n(e.amount), 0);
    const total = buyVol + sellVol;
    const power = total ? buyVol / total : 0.5;
    const risk = (h: HolderRow) => sellRisk(h, events, links, dev);

    const sides: Record<Side, { h: HolderRow; amount: number }[]> = { buy: [], sell: [] };
    for (const [w, f] of flow) {
      const h = byWallet.get(w);
      if (!h || h.is_contract) continue;
      if (f.bought > f.sold) sides.buy.push({ h, amount: f.bought - f.sold });
      else if (f.sold > 0) sides.sell.push({ h, amount: f.sold - f.bought });
    }
    // The winning side's pawns march forward (up to 3 squares).
    const push = (side: Side) => {
      const lead = side === "buy" ? power - 0.5 : 0.5 - power;
      return total ? Math.max(0, Math.min(3, Math.round(lead * 8))) : 0;
    };
    const pieces: Piece[] = [];
    (["buy", "sell"] as const).forEach((side) => {
      const used: Record<string, number> = {};
      const back = side === "buy" ? 7 : 0, pawnRank = side === "buy" ? 6 - push("buy") : 1 + push("sell");
      sides[side].sort((a, b) => b.amount - a.amount).slice(0, 16).forEach((x, i) => {
        const kind = ORDER[i];
        const k = used[kind] = (used[kind] || 0) + 1;
        const file = kind === "P" ? PAWN_FILES[k - 1] : BACK[kind][k - 1];
        pieces.push({ h: x.h, side, amount: x.amount, kind, file, rank: kind === "P" ? pawnRank : back, risk: risk(x.h) });
      });
    });

    // The bench: holders still in who didn't move in this time frame.
    const playing = new Set(pieces.map((p) => p.h.wallet));
    const bench: Bencher[] = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev) && !playing.has(h.wallet) && seatOf(h) !== "left")
      .sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 40).map((h) => ({ h, risk: risk(h) }));
    const out = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev) && seatOf(h) === "left");

    // Timeline: 12 slots across the time frame.
    const start = since || (win.length ? Math.min(...win.map((e) => Date.parse(e.created_at))) : Date.now() - 86_400_000);
    const span = Math.max(60_000, Date.now() - start);
    const slots = Array.from({ length: 12 }, () => ({ buy: 0, sell: 0 }));
    for (const e of win) {
      const i = Math.min(11, Math.max(0, Math.floor(((Date.parse(e.created_at) - start) / span) * 12)));
      if (e.kind === "buy") slots[i].buy += n(e.amount); else slots[i].sell += n(e.amount);
    }
    return { pieces, bench, out, buyVol, sellVol, total, power, slots, buyers: sides.buy.length, sellers: sides.sell.length };
  }, [tf, holders, events, links, dev]);

  const { power, total } = d;
  const check = total > 0 && (power >= 0.7 || power <= 0.3);
  const verdict = !total ? "No moves yet in this time frame" : power >= 0.7 ? "♔ Check! Buyers are crushing the sellers" : power >= 0.56 ? "♙ Buyers are winning"
    : power <= 0.3 ? "♚ Check! Sellers are crushing the buyers" : power <= 0.44 ? "♟ Sellers are winning" : "⚖️ It's an even game";
  const pickedPiece = sel ? d.pieces.find((p) => p.h.wallet === sel) : null;
  const pickedBench = sel && !pickedPiece ? d.bench.find((b) => b.h.wallet === sel) : null;
  const picked = pickedPiece || pickedBench || null;
  const pickedFlow = picked ? events.filter((e) => e.wallet === picked.h.wallet) : [];
  const pickedLinks = picked ? links.filter((l) => l.a === picked.h.wallet || l.b === picked.h.wallet) : [];
  const slotMax = Math.max(1, ...d.slots.map((s) => Math.max(s.buy, s.sell)));
  const pick = (w: string) => setSel(sel === w ? null : w);
  const keys = (w: string) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(w); } };
  const king = (side: Side) => d.pieces.find((p) => p.side === side && p.kind === "K");
  const threatened = power >= 0.7 ? king("sell") : power <= 0.3 ? king("buy") : undefined;

  return (
    <div className="arena chess">
      <div className="arena-top">
        <div className="tf" role="tablist" aria-label="Time frame">
          {FRAMES.map((f) => <button key={f.k} type="button" role="tab" aria-selected={tf === f.k} onClick={() => setTf(f.k)}>{f.label}</button>)}
        </div>
        <b className={"arena-verdict" + (check ? " check" : "")}>{verdict}</b>
      </div>

      <div className="power" role="img" aria-label={`Buy volume ${fmt(d.buyVol)} ${symbol}, sell volume ${fmt(d.sellVol)} ${symbol}`}>
        <span className="pb" style={{ width: `${power * 100}%` }}><b>♙ Buyers {Math.round(power * 100)}%</b><small>{d.buyers} pieces · {fmt(d.buyVol)}</small></span>
        <span className="ps"><b>Sellers {Math.round((1 - power) * 100)}% ♟</b><small>{d.sellers} pieces · {fmt(d.sellVol)}</small></span>
        <i className="clash" style={{ left: `${power * 100}%` }} aria-hidden="true">⚡</i>
      </div>

      <div className="chess-wrap">
        <div className="chess-banner s">♟ SELLERS · {d.sellers} piece{d.sellers === 1 ? "" : "s"}</div>
        <svg className="chess-board" viewBox={`0 0 ${BOARD + PAD * 2} ${BOARD + PAD * 2}`} role="img"
          aria-label={`Chess battle for ${symbol}: ${d.buyers} buyer pieces against ${d.sellers} seller pieces. ${verdict}.`}>
          <defs>
            <linearGradient id="cb-frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E9C46A" /><stop offset=".5" stopColor="#8A5A1E" /><stop offset="1" stopColor="#E9C46A" /></linearGradient>
            <radialGradient id="cb-buy" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#5BE3B0" stopOpacity=".55" /><stop offset="1" stopColor="#5BE3B0" stopOpacity="0" /></radialGradient>
            <radialGradient id="cb-sell" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#FF6B4A" stopOpacity=".55" /><stop offset="1" stopColor="#FF6B4A" stopOpacity="0" /></radialGradient>
            <filter id="cb-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter>
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
            {!d.pieces.length && <text x={BOARD / 2} y={BOARD / 2} textAnchor="middle" className="cb-empty">No moves by top wallets in this time frame</text>}
            {d.pieces.map((p, i) => {
              const x = p.file * SQ + SQ / 2, y = p.rank * SQ + SQ / 2;
              const on = sel === p.h.wallet;
              return (
                <g key={p.h.wallet} transform={`translate(${x} ${y})`} className={"cb-piece " + p.side + (on ? " sel" : "")} style={{ ["--dl" as any]: `${(i % 8) * 0.18}s` }}
                  role="button" tabIndex={0} onClick={() => pick(p.h.wallet)} onKeyDown={keys(p.h.wallet)}
                  aria-label={`${p.side === "buy" ? "Buyer" : "Seller"} ${NAME[p.kind]}: ${short(p.h.wallet)} ${p.side === "buy" ? "bought" : "sold"} ${fmt(p.amount)} ${symbol}, holding for ${dur(p.h.acquired_at || p.h.first_seen_at)}`}>
                  <circle r="44" fill={`url(#cb-${p.side})`} />
                  {on && <circle r="44" fill="none" stroke="#1D4ED8" strokeWidth="5" />}
                  <g className="cb-lift">
                    <text y="24" textAnchor="middle" className="cb-glyph shadow">{GLYPH.sell[p.kind]}{"︎"}</text>
                    <text y="20" textAnchor="middle" className="cb-glyph">{GLYPH.sell[p.kind]}{"︎"}</text>
                  </g>
                  {p.h.is_dev && <text x="30" y="-26" textAnchor="middle" fontSize="22">👑</text>}
                  <rect x="-34" y="30" width="68" height="18" rx="9" fill={p.side === "buy" ? "#0E7A55" : "#8E1F10"} />
                  <text y="43" textAnchor="middle" className="cb-amt">{p.side === "buy" ? "+" : "−"}{fmt(p.amount)}</text>
                </g>
              );
            })}
          </g>
          {"abcdefgh".split("").map((c, i) => <text key={c} x={PAD + i * SQ + SQ / 2} y={BOARD + PAD * 2 - 8} textAnchor="middle" className="cb-coord">{c}</text>)}
          {Array.from({ length: 8 }, (_, i) => <text key={i} x={12} y={PAD + i * SQ + SQ / 2 + 5} textAnchor="middle" className="cb-coord">{8 - i}</text>)}
        </svg>
        <div className="chess-banner b">♙ BUYERS · {d.buyers} piece{d.buyers === 1 ? "" : "s"}</div>
      </div>

      <div className="chess-key">
        <span>♔ King = biggest move</span><span>♕ Queen = 2nd</span><span>♖ ♗ ♘ next biggest</span><span>♙ Pawns = smaller moves</span><span>👑 = dev</span>
      </div>

      <div className="bench">
        <div className="bench-head"><b>🪑 On the bench</b><span className="muted">holding, didn&apos;t move · colour = chance to sell</span></div>
        <div className="bench-row">
          {d.bench.length ? d.bench.map((b) => (
            <button key={b.h.wallet} type="button" className={"bencher " + b.risk.level} aria-pressed={sel === b.h.wallet} onClick={() => pick(b.h.wallet)}
              aria-label={`${short(b.h.wallet)}, ${b.risk.level} chance to sell`} title={`${short(b.h.wallet)} · ${b.risk.level} chance to sell`}>
              <i style={{ background: RISK_COLOR[b.risk.level] }} />{b.h.is_dev ? "👑" : ""}{short(b.h.wallet).slice(0, 6)}
            </button>
          )) : <span className="muted">Everyone is on the board.</span>}
        </div>
        {d.out.length > 0 && <div className="muted" style={{ fontSize: ".84em" }}>❌ Out of the game: {d.out.length} wallet{d.out.length > 1 ? "s" : ""} sold everything.</div>}
      </div>

      <div className="arena-timeline" role="img" aria-label="Buys and sells over the time frame">
        {d.slots.map((s, i) => (
          <div key={i} className="tl-slot" title={`Buys ${fmt(s.buy)} · Sells ${fmt(s.sell)}`}>
            <span className="tb" style={{ height: `${Math.sqrt(s.buy / slotMax) * 100}%` }} />
            <span className="ts" style={{ height: `${Math.sqrt(s.sell / slotMax) * 100}%` }} />
          </div>
        ))}
        <div className="tl-axis"><span>{tf === "all" ? "Start" : FRAMES.find((f) => f.k === tf)!.label + " ago"}</span><span>Now</span></div>
      </div>

      <div className="club-info" aria-live="polite">
        {!picked ? <span className="muted">Tap any piece or anyone on the bench to see their wallet, how long they&apos;ve held and how likely they are to sell.</span> : (
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <b>{picked.h.is_dev ? "👑 Dev · " : ""}{pickedPiece ? `${GLYPH[pickedPiece.side][pickedPiece.kind]} ${pickedPiece.side === "buy" ? "Buyer" : "Seller"} ${NAME[pickedPiece.kind]}` : "🪑 On the bench"}</b>{" "}
              <a className="mono" href={`${explorer}/token/${token}?a=${picked.h.wallet}`} target="_blank" rel="noopener noreferrer">{short(picked.h.wallet)}</a>
              <span> · holds <b>{pct(n(picked.h.pct))}</b> · holding for <b>{dur(picked.h.acquired_at || picked.h.first_seen_at)}</b></span>
              {pickedPiece && <span> · {pickedPiece.side === "buy" ? "bought" : "sold"} <b>{fmt(pickedPiece.amount)} {symbol}</b> in this time frame</span>}
            </div>
            <div className="risk-row">
              <span className={"risk " + picked.risk.level}>Chance to sell: {picked.risk.level} ({picked.risk.score}/100)</span>
              {picked.risk.reasons.length > 0 && <span className="muted">because it {picked.risk.reasons.join(", ")}.</span>}
            </div>
            {pickedFlow.length > 0 && <div className="muted" style={{ fontSize: ".86em" }}>History: {pickedFlow.slice(0, 5).map((e) => `${e.kind === "buy" ? "bought" : e.kind === "exit" ? "sold all" : `sold ${Math.round(n(e.pct_of_holding))}%`} ${dur(e.created_at)} ago`).join(" · ")}</div>}
            {pickedLinks.length > 0 && <div className="club-conn">🔗 Connected to {pickedLinks.map((l) => { const o = l.a === picked.h.wallet ? l.b : l.a; return <button key={o} type="button" onClick={() => setSel(o)}>{short(o)}{o === dev ? " 👑" : ""}</button>; })}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
