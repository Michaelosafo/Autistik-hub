"use client";
import { useEffect, useMemo, useState } from "react";
import { clusters, seatOf, type EventRow, type HolderRow, type LinkRow, type Seat } from "@/lib/analytics-insights";

/**
 * The token's top wallets as people in a small clubhouse. Each bubble is a wallet, sized by how much it holds.
 * Green: still holding. Orange: sold some. Wallets that sold everything walk out of the door.
 * Lines join connected wallets (one sent tokens to the other), like a bubble map. The pool is the bar.
 */
type Props = { holders: HolderRow[]; events: EventRow[]; links: LinkRow[]; explorer: string; token: string; symbol: string };
type Bubble = { h: HolderRow; seat: Seat; x: number; y: number; r: number; last?: EventRow };

// Wide screens: the room with the street on the right. Phones: a taller room with the street below.
type Dims = { W: number; H: number; ROOM: { x: number; y: number; w: number; h: number }; DOOR: { x: number; y: number; h: number }; OUT: { x: number; y: number; cols: number; label: [number, number] } };
const WIDE: Dims = { W: 720, H: 420, ROOM: { x: 14, y: 30, w: 560, h: 376 }, DOOR: { x: 574, y: 190, h: 80 }, OUT: { x: 608, y: 70, cols: 3, label: [644, 50] } };
const TALL: Dims = { W: 400, H: 640, ROOM: { x: 10, y: 26, w: 380, h: 520 }, DOOR: { x: 390, y: 440, h: 70 }, OUT: { x: 30, y: 600, cols: 14, label: [200, 578] } };
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const pct = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : "<0.01") + "%";
const ago = (t?: string | null) => {
  if (!t) return "";
  const h = (Date.now() - Date.parse(t)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

/** Places bubbles without overlap, spiralling out from the middle; connected wallets sit near each other. */
function layout(people: { h: HolderRow; seat: Seat; last?: EventRow }[], links: LinkRow[], d: Dims): Bubble[] {
  const { ROOM, OUT } = d;
  const inside = people.filter((p) => p.seat !== "left").sort((a, b) => n(b.h.pct) - n(a.h.pct));
  const outside = people.filter((p) => p.seat === "left");
  const placed: Bubble[] = [];
  const near = (w: string) => {
    for (const l of links) {
      const other = l.a === w ? l.b : l.b === w ? l.a : null;
      const b = other && placed.find((q) => q.h.wallet === other);
      if (b) return b;
    }
    return null;
  };
  for (const p of inside) {
    const r = Math.max(9, Math.min(48, 7 + Math.sqrt(Math.max(0, n(p.h.pct))) * 9));
    const partner = near(p.h.wallet);
    const start = partner || { x: ROOM.x + ROOM.w * 0.48, y: ROOM.y + ROOM.h * 0.52 };
    let x = start.x, y = start.y, ok = false;
    for (let i = 0; i < 3000 && !ok; i++) {
      const a = i * 0.45, d = i * 0.9;
      x = start.x + Math.cos(a) * d; y = start.y + Math.sin(a) * d * 0.8;
      ok = x - r >= ROOM.x + 10 && x + r <= ROOM.x + ROOM.w - 10 && y - r >= ROOM.y + 26 && y + r <= ROOM.y + ROOM.h - 10
        && !(x + r > ROOM.x + ROOM.w - 120 && y + r > ROOM.y + ROOM.h - 70) // keep the bar clear
        // connected wallets sit close, with a gap so the line between them shows
        && placed.every((q) => Math.hypot(q.x - x, q.y - y) >= q.r + r + (q === partner ? 22 : 3));
    }
    placed.push({ ...p, x, y, r });
  }
  outside.forEach((p, i) => {
    const col = i % OUT.cols, row = Math.floor(i / OUT.cols);
    placed.push({ ...p, r: 9, x: OUT.x + col * 24, y: OUT.y + row * 24 });
  });
  return placed;
}

export default function Clubhouse({ holders, events, links, explorer, token, symbol }: Props) {
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Dims>(WIDE);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 600px)");
    const pick = () => setD(m.matches ? TALL : WIDE);
    pick(); m.addEventListener("change", pick);
    return () => m.removeEventListener("change", pick);
  }, []);
  const { W, H, ROOM, DOOR, OUT } = d;
  const data = useMemo(() => {
    const last = new Map<string, EventRow>();
    for (const e of events) if (!last.has(e.wallet)) last.set(e.wallet, e);
    const people = holders.filter((h) => !h.is_contract).map((h) => ({ h, last: last.get(h.wallet), seat: seatOf(h, last.get(h.wallet)) }))
      .filter((p) => p.h.in_top || p.h.is_dev || p.seat === "left").slice(0, 60);
    const pool = holders.filter((h) => h.is_contract && h.in_top).reduce((a, h) => a + n(h.pct), 0);
    const wallets = people.map((p) => p.h.wallet);
    const ls = links.filter((l) => wallets.includes(l.a) && wallets.includes(l.b));
    const bubbles = layout(people, ls, d);
    const groups = clusters(wallets, ls);
    const count = (s: Seat) => people.filter((p) => p.seat === s).length;
    const share = (s: Seat) => people.filter((p) => p.seat === s).reduce((a, p) => a + n(p.h.pct), 0);
    return { bubbles, ls, groups, pool, counts: { holding: count("holding"), sold: count("sold"), left: count("left") }, shares: { holding: share("holding"), sold: share("sold") } };
  }, [holders, events, links, d]);

  const { bubbles, ls, groups, pool, counts } = data;
  const total = counts.holding + counts.sold + counts.left || 1;
  const byWallet = new Map(bubbles.map((b) => [b.h.wallet, b]));
  const picked = sel ? byWallet.get(sel) : null;
  const pickedLinks = picked ? ls.filter((l) => l.a === picked.h.wallet || l.b === picked.h.wallet) : [];
  const groupOf = (w: string) => groups.findIndex((g) => g.includes(w));

  return (
    <div className="club">
      <div className="club-dist" role="img" aria-label={`${counts.holding} holding, ${counts.sold} sold some, ${counts.left} left`}>
        <span className="hold" style={{ flex: counts.holding || 0.0001 }} />
        <span className="sold" style={{ flex: counts.sold || 0.0001 }} />
        <span className="left" style={{ flex: counts.left || 0.0001 }} />
      </div>
      <div className="club-legend">
        <span><i className="hold" />Holding <b>{counts.holding}</b> · {Math.round((counts.holding / total) * 100)}%</span>
        <span><i className="sold" />Sold some <b>{counts.sold}</b> · {Math.round((counts.sold / total) * 100)}%</span>
        <span><i className="left" />Left <b>{counts.left}</b> · {Math.round((counts.left / total) * 100)}%</span>
        {groups.length > 0 && <span><i className="link" />Connected <b>{groups.flat().length}</b></span>}
      </div>

      <svg className="club-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Clubhouse of ${symbol} holders: ${counts.holding} holding, ${counts.sold} sold some, ${counts.left} left.`}>
        <defs>
          <pattern id="club-floor" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="#2A1F18" /><rect width="14" height="14" fill="#31251C" /><rect x="14" y="14" width="14" height="14" fill="#31251C" /></pattern>
          <radialGradient id="club-light" cx=".5" cy=".35" r=".7"><stop offset="0" stopColor="#FFD98A" stopOpacity=".28" /><stop offset="1" stopColor="#FFD98A" stopOpacity="0" /></radialGradient>
          <radialGradient id="b-hold" cx=".35" cy=".3"><stop offset="0" stopColor="#7DF0C8" /><stop offset="1" stopColor="#1FA67C" /></radialGradient>
          <radialGradient id="b-sold" cx=".35" cy=".3"><stop offset="0" stopColor="#FFC27A" /><stop offset="1" stopColor="#E0702A" /></radialGradient>
          <radialGradient id="b-dev" cx=".35" cy=".3"><stop offset="0" stopColor="#FFE58F" /><stop offset="1" stopColor="#D49B1E" /></radialGradient>
        </defs>
        {/* the room */}
        <rect x={ROOM.x - 6} y={ROOM.y - 6} width={ROOM.w + 12} height={ROOM.h + 12} rx="26" fill="#4A3426" />
        <rect x={ROOM.x} y={ROOM.y} width={ROOM.w} height={ROOM.h} rx="20" fill="url(#club-floor)" />
        <rect x={ROOM.x} y={ROOM.y} width={ROOM.w} height={ROOM.h} rx="20" fill="url(#club-light)" />
        <text x={ROOM.x + 18} y={ROOM.y + 22} className="club-sign">🏠 {symbol} CLUB</text>
        {/* the bar = liquidity pool */}
        <g transform={`translate(${ROOM.x + ROOM.w - 112} ${ROOM.y + ROOM.h - 62})`}>
          <rect width="104" height="54" rx="10" fill="#6B4A33" stroke="#8C6447" />
          <text x="52" y="22" textAnchor="middle" className="club-bar">🍹 The bar</text>
          <text x="52" y="40" textAnchor="middle" className="club-bar small">Pool {pool ? pct(pool) : "–"}</text>
        </g>
        {/* the door, and outside */}
        <rect x={DOOR.x - 6} y={DOOR.y} width="14" height={DOOR.h} rx="3" fill="#C98A4B" />
        <text x={DOOR.x + 2} y={DOOR.y - 8} textAnchor="middle" className="club-door">🚪</text>
        <text x={OUT.label[0]} y={OUT.label[1]} textAnchor="middle" className="club-out">Left the club</text>

        {/* connections */}
        {ls.map((l) => {
          const a = byWallet.get(l.a), b = byWallet.get(l.b);
          if (!a || !b) return null;
          const on = sel && (sel === l.a || sel === l.b);
          return <line key={l.a + l.b} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={"club-link" + (on ? " on" : "")} />;
        })}

        {/* people */}
        {bubbles.map((b, i) => {
          const fill = b.h.is_dev ? "url(#b-dev)" : b.seat === "sold" ? "url(#b-sold)" : b.seat === "left" ? "#6E6A78" : "url(#b-hold)";
          const label = `${b.h.is_dev ? "Dev " : ""}wallet ${short(b.h.wallet)}, ${b.seat === "left" ? "left the club" : b.seat === "sold" ? "sold some" : "holding"}, ${pct(n(b.h.pct))} of supply`;
          return (
            <g key={b.h.wallet} className={"club-p " + b.seat + (sel === b.h.wallet ? " sel" : "") + (groupOf(b.h.wallet) >= 0 ? " linked" : "")}
              style={{ ["--d" as any]: `${(i % 7) * 0.4}s`, ["--sx" as any]: `${DOOR.x - b.x}px`, ["--sy" as any]: `${DOOR.y + 40 - b.y}px` }}
              transform={`translate(${b.x} ${b.y})`} role="button" tabIndex={0} aria-label={label}
              onClick={() => setSel(sel === b.h.wallet ? null : b.h.wallet)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(sel === b.h.wallet ? null : b.h.wallet); } }}>
              <g className="club-body">
                <circle r={b.r} fill={fill} stroke={b.seat === "left" ? "#A9A4B6" : "rgba(255,255,255,.55)"} strokeWidth={b.seat === "left" ? 1.5 : 1.2} strokeDasharray={b.seat === "left" ? "3 2" : undefined} />
                {b.r >= 13 && <><circle cx={-b.r * 0.3} cy={-b.r * 0.15} r={Math.max(1.6, b.r * 0.09)} fill="#1A1420" /><circle cx={b.r * 0.3} cy={-b.r * 0.15} r={Math.max(1.6, b.r * 0.09)} fill="#1A1420" />
                  <path d={b.seat === "holding" ? `M${-b.r * 0.3} ${b.r * 0.22} Q0 ${b.r * 0.45} ${b.r * 0.3} ${b.r * 0.22}` : `M${-b.r * 0.28} ${b.r * 0.34} Q0 ${b.r * 0.18} ${b.r * 0.28} ${b.r * 0.34}`} stroke="#1A1420" strokeWidth={Math.max(1.2, b.r * 0.07)} fill="none" strokeLinecap="round" /></>}
                {b.h.is_dev && <text y={-b.r - 3} textAnchor="middle" fontSize={Math.max(12, b.r * 0.7)}>👑</text>}
                {b.seat === "sold" && b.r >= 16 && b.last && <text y={b.r + 12} textAnchor="middle" className="club-tag">−{Math.round(n(b.last.pct_of_holding))}%</text>}
                {b.seat === "left" && <text y="4" textAnchor="middle" fontSize="10">🚶</text>}
              </g>
            </g>
          );
        })}
      </svg>

      <div className="club-info" aria-live="polite">
        {!picked ? <span className="muted">Tap a person to see their wallet. 👑 = dev · lines = connected wallets · 🚶 = sold everything and left.</span> : (
          <>
            <b>{picked.h.is_dev ? "👑 Dev wallet" : picked.h.rank ? `#${picked.h.rank} wallet` : "Wallet"}</b>{" "}
            <a className="mono" href={`${explorer}/token/${token}?a=${picked.h.wallet}`} target="_blank" rel="noopener noreferrer">{short(picked.h.wallet)}</a>
            <span> · holds <b>{pct(n(picked.h.pct))}</b></span>
            <span> · {picked.seat === "left" ? `left ${ago(picked.last?.created_at)} ago` : picked.seat === "sold" ? `sold ${Math.round(n(picked.last?.pct_of_holding))}%${picked.last ? ` ${ago(picked.last.created_at)} ago` : ""}` : "holding"}</span>
            {(picked.h.acquired_at || picked.h.first_seen_at) && <span className="muted"> · in the club for {ago(picked.h.acquired_at || picked.h.first_seen_at)}</span>}
            {pickedLinks.length > 0 && (
              <div className="club-conn">🔗 Connected to {pickedLinks.map((l) => {
                const other = l.a === picked.h.wallet ? l.b : l.a;
                const mine = l.a === picked.h.wallet;
                const how = l.kind === "funded" ? (mine ? "this wallet gave them their first tokens" : "they gave this wallet its first tokens") : (mine ? "this wallet sent them tokens" : "they sent this wallet tokens");
                return <button key={other} type="button" onClick={() => setSel(other)}>{short(other)}{byWallet.get(other)?.h.is_dev ? " 👑" : ""} <small>({how})</small></button>;
              })}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
