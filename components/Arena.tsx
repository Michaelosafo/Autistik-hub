"use client";
import { useMemo, useState } from "react";
import { seatOf, sellRisk, type EventRow, type HolderRow, type LinkRow, type Risk } from "@/lib/analytics-insights";

/**
 * The battle arena: buyers vs sellers among the token's top wallets, for a chosen time frame.
 * Left side: wallets that bought (green). Right side: wallets that sold (red). They clash in the middle,
 * and the power bar shows who's winning by volume. Holders who didn't move sit in the stands, coloured by
 * how likely they are to sell. A timeline underneath shows buys and sells over the period.
 */
type Props = { holders: HolderRow[]; events: EventRow[]; links: LinkRow[]; explorer: string; token: string; symbol: string };
type TF = "1h" | "6h" | "24h" | "7d" | "all";
const FRAMES: { k: TF; label: string; ms: number }[] = [
  { k: "1h", label: "1H", ms: 3_600_000 }, { k: "6h", label: "6H", ms: 6 * 3_600_000 }, { k: "24h", label: "24H", ms: 86_400_000 },
  { k: "7d", label: "7D", ms: 7 * 86_400_000 }, { k: "all", label: "All", ms: Infinity },
];

const W = 800, H = 480, CX = 400, CY = 262;
const FLOOR = { rx: 290, ry: 128 };
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const fmt = (v: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const pct = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 0.01 ? v.toFixed(2) : "<0.01") + "%";
const dur = (t?: string | null) => {
  if (!t) return "–";
  const h = (Date.now() - Date.parse(t)) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};
const RISK_COLOR = { low: "#2BC48F", medium: "#F5B82E", high: "#F0563A" } as const;

type Fighter = { h: HolderRow; side: "buy" | "sell"; amount: number; x: number; y: number; k: number; risk: Risk };
type Fan = { h: HolderRow; x: number; y: number; k: number; risk: Risk };

/** Spots on one half of the arena floor, nearest the middle line first. */
function spots(side: "buy" | "sell") {
  const out: { x: number; y: number; d: number }[] = [];
  for (let y = CY - FLOOR.ry + 26; y <= CY + FLOOR.ry - 12; y += 34) {
    for (let x = CX - FLOOR.rx + 30; x <= CX + FLOOR.rx - 30; x += 38) {
      const inside = ((x - CX) / (FLOOR.rx - 18)) ** 2 + ((y - CY) / (FLOOR.ry - 10)) ** 2 <= 1;
      const ok = side === "buy" ? x < CX - 30 : x > CX + 30;
      if (inside && ok) out.push({ x: x + (Math.round(y) % 2 ? 9 : -9), y, d: Math.abs(x - CX) + Math.abs(y - CY) * 0.6 });
    }
  }
  return out.sort((a, b) => a.d - b.d);
}
const depth = (y: number) => 0.72 + 0.5 * ((y - (CY - FLOOR.ry - 70)) / (2 * FLOOR.ry + 140));

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
    const risk = (h: HolderRow) => sellRisk(h, events, links, dev);

    const sides = { buy: [] as { h: HolderRow; amount: number }[], sell: [] as { h: HolderRow; amount: number }[] };
    for (const [w, f] of flow) {
      const h = byWallet.get(w);
      if (!h || h.is_contract) continue;
      if (f.bought > f.sold) sides.buy.push({ h, amount: f.bought - f.sold });
      else if (f.sold > 0) sides.sell.push({ h, amount: f.sold - f.bought });
    }
    const max = Math.max(1, ...sides.buy.map((x) => x.amount), ...sides.sell.map((x) => x.amount));
    const fighters: Fighter[] = [];
    (["buy", "sell"] as const).forEach((side) => {
      const sp = spots(side);
      sides[side].sort((a, b) => b.amount - a.amount).slice(0, sp.length).forEach((x, i) => {
        const { x: px, y: py } = sp[i];
        fighters.push({ h: x.h, side, amount: x.amount, x: px, y: py, k: depth(py) * (0.8 + 0.55 * Math.sqrt(x.amount / max)), risk: risk(x.h) });
      });
    });

    // The crowd: holders still in, who didn't fight in this time frame. Biggest bags in the front rows.
    const fighting = new Set(fighters.map((f) => f.h.wallet));
    const crowd = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev) && !fighting.has(h.wallet) && seatOf(h) !== "left")
      .sort((a, b) => n(b.pct) - n(a.pct)).slice(0, 56);
    const front = Math.min(28, crowd.length), back = crowd.length - front;
    const fans: Fan[] = crowd.map((h, i) => {
      const row = i < front ? 0 : 1;
      const j = row ? i - front : i, count = row ? back : front;
      // Spread evenly around the stands, from the left side over the back to the right side.
      const t = Math.PI * (0.92 + (count > 1 ? j / (count - 1) : 0.5) * 1.16);
      const rx = row ? 372 : 334, ry = row ? 196 : 168;
      const x = CX + Math.cos(t) * rx, y = CY + Math.sin(t) * ry;
      return { h, x, y, k: depth(y), risk: risk(h) };
    });
    // Front corners for whoever doesn't fit at the back.
    const left = holders.filter((h) => !h.is_contract && (h.in_top || h.is_dev) && seatOf(h) === "left").length;

    // Timeline: 12 slots across the time frame.
    const start = since || (win.length ? Math.min(...win.map((e) => Date.parse(e.created_at))) : Date.now() - 86_400_000);
    const span = Math.max(60_000, Date.now() - start);
    const slots = Array.from({ length: 12 }, () => ({ buy: 0, sell: 0 }));
    for (const e of win) {
      const i = Math.min(11, Math.max(0, Math.floor(((Date.parse(e.created_at) - start) / span) * 12)));
      if (e.kind === "buy") slots[i].buy += n(e.amount); else slots[i].sell += n(e.amount);
    }
    return { fighters, fans, buyVol, sellVol, slots, left, buyers: sides.buy.length, sellers: sides.sell.length, risky: fans.filter((f) => f.risk.level === "high").length };
  }, [tf, holders, events, links, dev]);

  const total = d.buyVol + d.sellVol;
  const power = total ? d.buyVol / total : 0.5;
  const verdict = !total ? "No fight yet in this time frame" : power >= 0.58 ? "🟢 Buyers are winning" : power <= 0.42 ? "🔴 Sellers are winning" : "⚔️ It's an even fight";
  const all = [...d.fighters.map((f) => ({ ...f, kind: "fighter" as const })), ...d.fans.map((f) => ({ ...f, kind: "fan" as const }))];
  const picked = sel ? all.find((x) => x.h.wallet === sel) : null;
  const pickedFlow = picked && events.filter((e) => e.wallet === picked.h.wallet);
  const pickedLinks = picked ? links.filter((l) => l.a === picked.h.wallet || l.b === picked.h.wallet) : [];
  const slotMax = Math.max(1, ...d.slots.map((s) => Math.max(s.buy, s.sell)));
  const pick = (w: string) => setSel(sel === w ? null : w);
  const keys = (w: string) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(w); } };

  return (
    <div className="arena">
      <div className="arena-top">
        <div className="tf" role="tablist" aria-label="Time frame">
          {FRAMES.map((f) => <button key={f.k} type="button" role="tab" aria-selected={tf === f.k} onClick={() => setTf(f.k)}>{f.label}</button>)}
        </div>
        <b className="arena-verdict">{verdict}</b>
      </div>

      <div className="power" role="img" aria-label={`Buy volume ${fmt(d.buyVol)} ${symbol}, sell volume ${fmt(d.sellVol)} ${symbol}`}>
        <span className="pb" style={{ width: `${power * 100}%` }}><b>🛡️ Buyers {Math.round(power * 100)}%</b><small>{d.buyers} · {fmt(d.buyVol)}</small></span>
        <span className="ps"><b>Sellers {Math.round((1 - power) * 100)}% 🗡️</b><small>{d.sellers} · {fmt(d.sellVol)}</small></span>
        <i className="clash" style={{ left: `${power * 100}%` }} aria-hidden="true">⚡</i>
      </div>

      <svg className="arena-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${symbol} arena: ${d.buyers} buyers against ${d.sellers} sellers. ${verdict}.`}>
        <defs>
          <radialGradient id="ar-stands" cx=".5" cy=".55" r=".6"><stop offset="0" stopColor="#2A2350" /><stop offset="1" stopColor="#0B0A18" /></radialGradient>
          <radialGradient id="ar-floor" cx=".5" cy=".45" r=".7"><stop offset="0" stopColor="#3B3470" /><stop offset="1" stopColor="#171433" /></radialGradient>
          <linearGradient id="ar-split" x1="0" x2="1"><stop offset="0" stopColor="#1FA67C" stopOpacity=".38" /><stop offset=".48" stopColor="#1FA67C" stopOpacity=".05" /><stop offset=".52" stopColor="#E0482A" stopOpacity=".05" /><stop offset="1" stopColor="#E0482A" stopOpacity=".38" /></linearGradient>
          <radialGradient id="ar-spot" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#FFF3C4" stopOpacity=".55" /><stop offset="1" stopColor="#FFF3C4" stopOpacity="0" /></radialGradient>
          <linearGradient id="ar-buy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7DF0C8" /><stop offset="1" stopColor="#139067" /></linearGradient>
          <linearGradient id="ar-sell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF9B7A" /><stop offset="1" stopColor="#C4321B" /></linearGradient>
          <clipPath id="ar-floor-clip"><ellipse cx={CX} cy={CY} rx={FLOOR.rx} ry={FLOOR.ry} /></clipPath>
        </defs>
        {/* stadium */}
        <ellipse cx={CX} cy={CY + 14} rx="396" ry="206" fill="#05040C" />
        <ellipse cx={CX} cy={CY} rx="392" ry="204" fill="url(#ar-stands)" />
        {[372, 334].map((rx, i) => <ellipse key={rx} cx={CX} cy={CY} rx={rx} ry={[196, 168][i]} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="18" />)}
        <ellipse cx={CX} cy={CY + 10} rx={FLOOR.rx + 8} ry={FLOOR.ry + 10} fill="#0E0C22" />
        <ellipse cx={CX} cy={CY} rx={FLOOR.rx} ry={FLOOR.ry} fill="url(#ar-floor)" stroke="#E9B65A" strokeOpacity=".55" strokeWidth="2" />
        <g clipPath="url(#ar-floor-clip)">
          <rect x={CX - FLOOR.rx} y={CY - FLOOR.ry} width={FLOOR.rx * 2} height={FLOOR.ry * 2} fill="url(#ar-split)" />
          {Array.from({ length: 9 }, (_, i) => <ellipse key={i} cx={CX} cy={CY} rx={30 + i * 34} ry={(30 + i * 34) * 0.44} fill="none" stroke="rgba(255,255,255,.05)" />)}
          <line x1={CX} y1={CY - FLOOR.ry} x2={CX} y2={CY + FLOOR.ry} stroke="#FFE7A3" strokeWidth="2" strokeDasharray="6 6" opacity=".6" />
          <ellipse cx={CX} cy={CY} rx="70" ry="34" fill="url(#ar-spot)" className="ar-pulse" />
        </g>
        <text x={CX - FLOOR.rx + 60} y={CY + 6} className="ar-side buy">🛡️ BUYERS</text>
        <text x={CX + FLOOR.rx - 60} y={CY + 6} textAnchor="end" className="ar-side sell">SELLERS 🗡️</text>
        {total > 0 && <text x={CX} y={CY + 9} textAnchor="middle" className="ar-clash">⚔️</text>}
        {!d.fighters.length && <text x={CX} y={CY + 52} textAnchor="middle" className="ar-empty">No buys or sells by top wallets in this time frame</text>}

        {/* the crowd (back first so the front overlaps) */}
        {[...d.fans].sort((a, b) => a.y - b.y).map((f) => (
          <g key={f.h.wallet} transform={`translate(${f.x} ${f.y}) scale(${f.k})`} className={"ar-fan" + (sel === f.h.wallet ? " sel" : "")}
            role="button" tabIndex={0} aria-label={`In the crowd: ${short(f.h.wallet)}, ${f.risk.level} chance to sell, holding for ${dur(f.h.acquired_at || f.h.first_seen_at)}`}
            onClick={() => pick(f.h.wallet)} onKeyDown={keys(f.h.wallet)}>
            <rect x="-7" y="-2" width="14" height="10" rx="4" fill="#3A355F" />
            <circle r="7" cy="-7" fill={RISK_COLOR[f.risk.level]} stroke="rgba(0,0,0,.35)" />
            {f.h.is_dev && <text y="-16" textAnchor="middle" fontSize="10">👑</text>}
          </g>
        ))}

        {/* the fighters */}
        {[...d.fighters].sort((a, b) => a.y - b.y).map((f, i) => {
          const dir = f.side === "buy" ? 1 : -1;
          return (
            <g key={f.h.wallet} transform={`translate(${f.x} ${f.y}) scale(${f.k})`} className={"ar-f " + f.side + (sel === f.h.wallet ? " sel" : "")}
              style={{ ["--dl" as any]: `${(i % 6) * 0.22}s` }} role="button" tabIndex={0}
              aria-label={`${f.side === "buy" ? "Buyer" : "Seller"} ${short(f.h.wallet)}: ${f.side === "buy" ? "bought" : "sold"} ${fmt(f.amount)} ${symbol}, holding for ${dur(f.h.acquired_at || f.h.first_seen_at)}`}
              onClick={() => pick(f.h.wallet)} onKeyDown={keys(f.h.wallet)}>
              <ellipse rx="15" ry="5" fill="rgba(0,0,0,.45)" />
              <g className="ar-body">
                <rect x="-9" y="-26" width="18" height="22" rx="8" fill={`url(#ar-${f.side})`} />
                <circle cy="-33" r="10" fill={`url(#ar-${f.side})`} stroke="rgba(255,255,255,.5)" />
                <circle cx={-3.5 + dir * 1.5} cy="-35" r="1.7" fill="#14101F" /><circle cx={3.5 + dir * 1.5} cy="-35" r="1.7" fill="#14101F" />
                <path d={f.side === "buy" ? "M-4 -29 Q0 -26 4 -29" : "M-4 -27.5 Q0 -30 4 -27.5"} stroke="#14101F" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <text x={dir * 13} y="-12" textAnchor="middle" fontSize="13">{f.side === "buy" ? "🛡️" : "🗡️"}</text>
                {f.h.is_dev && <text y="-46" textAnchor="middle" fontSize="12">👑</text>}
              </g>
            </g>
          );
        })}
      </svg>

      <div className="arena-legend">
        <span><i style={{ background: "#2BC48F" }} />Low chance to sell</span>
        <span><i style={{ background: "#F5B82E" }} />Medium</span>
        <span><i style={{ background: "#F0563A" }} />High</span>
        <span>🚪 {d.left} left for good</span>
        {d.risky > 0 && <span>⚠️ {d.risky} in the crowd look ready to sell</span>}
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

      {d.fighters.length > 0 && (
        <div className="arena-chips">
          {d.fighters.slice().sort((a, b) => b.amount - a.amount).slice(0, 12).map((f) => (
            <button key={f.h.wallet} type="button" className={f.side} aria-pressed={sel === f.h.wallet} onClick={() => pick(f.h.wallet)}>
              {f.side === "buy" ? "🛡️" : "🗡️"} {short(f.h.wallet)} <small>{f.side === "buy" ? "+" : "−"}{fmt(f.amount)}</small>
            </button>
          ))}
        </div>
      )}

      <div className="club-info" aria-live="polite">
        {!picked ? <span className="muted">Tap anyone in the arena or the crowd. Fighters bought or sold in this time frame; the crowd is holding, coloured by how likely they are to sell.</span> : (
          <div className="stack" style={{ gap: 6 }}>
            <div>
              <b>{picked.h.is_dev ? "👑 Dev · " : ""}{picked.kind === "fighter" ? ((picked as Fighter).side === "buy" ? "🛡️ Buyer" : "🗡️ Seller") : "👀 In the crowd"}</b>{" "}
              <a className="mono" href={`${explorer}/token/${token}?a=${picked.h.wallet}`} target="_blank" rel="noopener noreferrer">{short(picked.h.wallet)}</a>
              <span> · holds <b>{pct(n(picked.h.pct))}</b> · holding for <b>{dur(picked.h.acquired_at || picked.h.first_seen_at)}</b></span>
              {picked.kind === "fighter" && <span> · {(picked as Fighter).side === "buy" ? "bought" : "sold"} <b>{fmt((picked as Fighter).amount)} {symbol}</b> in this time frame</span>}
            </div>
            <div className="risk-row">
              <span className={"risk " + picked.risk.level}>Chance to sell: {picked.risk.level} ({picked.risk.score}/100)</span>
              {picked.risk.reasons.length > 0 && <span className="muted">because it {picked.risk.reasons.join(", ")}.</span>}
            </div>
            {pickedFlow && pickedFlow.length > 0 && <div className="muted" style={{ fontSize: ".86em" }}>History: {pickedFlow.slice(0, 5).map((e) => `${e.kind === "buy" ? "bought" : e.kind === "exit" ? "sold all" : `sold ${Math.round(n(e.pct_of_holding))}%`} ${dur(e.created_at)} ago`).join(" · ")}</div>}
            {pickedLinks.length > 0 && <div className="club-conn">🔗 Connected to {pickedLinks.map((l) => { const o = l.a === picked.h.wallet ? l.b : l.a; return <button key={o} type="button" onClick={() => setSel(o)}>{short(o)}{o === dev ? " 👑" : ""}</button>; })}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
