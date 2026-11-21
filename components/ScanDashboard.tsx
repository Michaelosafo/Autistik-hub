import type { Audit } from "@/lib/analytics-audit";
import type { PairStats } from "@/lib/market";

/**
 * The scanner dashboard, brought over from the safemoon.ai scanner: threat radar (red flags as blips), a 0–100 risk
 * gauge (low / moderate / high), the token overview and the top pools by liquidity. Server-rendered SVG, no script.
 */
const usd = (x: number | null | undefined) => {
  if (x == null || !isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${x.toFixed(2)}`;
  if (a === 0) return "$0";
  return `$${x.toPrecision(3)}`;
};
const age = (ms: number | null | undefined) => {
  if (!ms) return "—";
  const h = (Date.now() - ms) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} hours`;
  const d = h / 24;
  return d < 60 ? `${Math.round(d)} days` : d < 730 ? `${Math.round(d / 30)} months` : `${(d / 365).toFixed(1)} years`;
};
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export default function ScanDashboard({ a, move, chainName, token, std }: { a: Audit; move: PairStats | null; chainName: string; token: string; std: string }) {
  const flags = a.groups.flatMap((g) => g.checks).filter((c) => c.level === "bad" || c.level === "warn")
    .sort((x, y) => (x.level === "bad" ? 0 : 1) - (y.level === "bad" ? 0 : 1));
  const risk = a.score == null ? null : 100 - a.score;
  const verdict = risk == null ? "Not enough data" : risk <= 40 ? "Low risk" : risk <= 80 ? "Moderate risk" : "High risk";
  const tone = risk == null ? "na" : risk <= 40 ? "low" : risk <= 80 ? "mid" : "high";
  const ticks = Array.from({ length: 41 }, (_, i) => {
    const ang = Math.PI * (1.17 - (i / 40) * 1.34), r1 = 108, r2 = i % 5 ? 114 : 118;
    return { x1: 120 + r1 * Math.cos(ang), y1: 140 - r1 * Math.sin(ang), x2: 120 + r2 * Math.cos(ang), y2: 140 - r2 * Math.sin(ang), c: i < 16 ? "#38bdf8" : i < 26 ? "#ffb347" : "#ff6a3d" };
  });
  const blips = flags.slice(0, 10).map((c, i) => {
    const ang = (i * 137.5 * Math.PI) / 180, rad = 38 + ((i * 29) % 58);
    return { x: 110 + rad * Math.cos(ang), y: 110 + rad * Math.sin(ang), c };
  });
  const ch = move?.h24 ?? null;
  const rows: [string, React.ReactNode][] = [
    ["Market cap", usd(move?.marketCap)],
    ["24h volume", usd(move?.volumeH24)],
    ["Liquidity", usd(move?.poolList?.length ? move.poolList.reduce((s, p) => s + (p.liquidityUsd || 0), 0) : move?.liquidityUsd)],
    ["Price", usd(move?.priceUsd)],
    ["24h change", ch == null ? "—" : <span className={ch >= 0 ? "up" : "down"}>{ch >= 0 ? "+" : ""}{ch.toFixed(1)}%</span>],
    ["Contract", <span key="c" title={token} className="mono">{short(token)}</span>],
    ["Blockchain", `${chainName} · ${std}`],
    ["Pool age", age(move?.pairCreatedAt)],
  ];
  return (
    <section className="sd" aria-label="Scanner dashboard">
      <div className="sd-panel sd-threat">
        <h3>Threat count</h3>
        <b className="sd-big">{String(a.bad).padStart(2, "0")}</b>
        <small className="muted">{a.warn} warning{a.warn === 1 ? "" : "s"}</small>
        <svg viewBox="0 0 220 220" className="sd-radar" role="img" aria-label={`${a.bad} red flags and ${a.warn} warnings`}>
          <defs>
            <radialGradient id="sdRg" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#25c7d9" stopOpacity=".35" /><stop offset="1" stopColor="#0d3b45" stopOpacity=".9" /></radialGradient>
            <linearGradient id="sdSweep" x1="0" x2="1"><stop offset="0" stopColor="#5ff2ff" stopOpacity="0" /><stop offset="1" stopColor="#5ff2ff" stopOpacity=".55" /></linearGradient>
          </defs>
          <circle cx="110" cy="110" r="104" fill="url(#sdRg)" />
          <g stroke="#5ff2ff" strokeOpacity=".22" fill="none">
            <circle cx="110" cy="110" r="80" /><circle cx="110" cy="110" r="56" /><circle cx="110" cy="110" r="32" />
            <path d="M110 6v208M6 110h208M37 37l146 146M183 37 37 183" />
          </g>
          <path className="sd-sweep" d="M110 110 L110 6 A104 104 0 0 1 200 58 Z" fill="url(#sdSweep)" />
          {blips.map((b, i) => <circle key={i} cx={b.x.toFixed(1)} cy={b.y.toFixed(1)} r="4" fill={b.c.level === "bad" ? "#ff5a3c" : "#ffb347"}><title>{b.c.label}</title></circle>)}
        </svg>
        {flags.length > 0 && <ul className="sd-flags">{flags.slice(0, 4).map((c) => <li key={c.label + c.detail} className={c.level}>{c.label}</li>)}</ul>}
      </div>

      <div className={`sd-panel sd-gauge ${tone}`}>
        <h3>Risk score</h3>
        <div className="sd-gwrap">
          <svg viewBox="0 0 240 170" aria-hidden="true">
            <defs><linearGradient id="sdGg" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" /><stop offset=".5" stopColor="#ffb347" /><stop offset="1" stopColor="#ff5a3c" /></linearGradient></defs>
            {ticks.map((t, i) => <line key={i} x1={t.x1.toFixed(1)} y1={t.y1.toFixed(1)} x2={t.x2.toFixed(1)} y2={t.y2.toFixed(1)} stroke={t.c} strokeOpacity=".75" strokeWidth="2" strokeLinecap="round" />)}
            <path d="M30 140 A90 90 0 1 1 210 140" fill="none" stroke="rgba(127,127,140,.22)" strokeWidth="16" strokeLinecap="round" />
            <path d="M30 140 A90 90 0 1 1 210 140" fill="none" stroke="url(#sdGg)" strokeWidth="16" strokeLinecap="round" pathLength={100} strokeDasharray={risk == null ? "0 100" : `${Math.max(1, risk)} 100`} />
          </svg>
          <div className="sd-gread"><b>{risk ?? "--"}</b><em>{verdict}</em></div>
        </div>
        <ul className="sd-legend">
          <li><i style={{ background: "#38bdf8" }} />Low<b>0–40</b></li>
          <li><i style={{ background: "#ffb347" }} />Moderate<b>41–80</b></li>
          <li><i style={{ background: "#ff5a3c" }} />High<b>81–100</b></li>
        </ul>
      </div>

      <div className="sd-panel sd-ov">
        <h3>Token overview</h3>
        <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>

      <div className="sd-panel sd-pools">
        <h3>Top pools by liquidity</h3>
        {move?.poolList?.length ? (
          <div className="sd-pgrid">
            {move.poolList.map((p, i) => (
              <div key={i} className="sd-pool"><b>{p.dex}{p.quote ? ` · ${p.quote}` : ""}</b><span>{usd(p.liquidityUsd)}</span><small>{usd(p.volumeH24)} traded in 24h</small></div>
            ))}
          </div>
        ) : <p className="muted">No trading pool found on DexScreener yet.</p>}
      </div>
    </section>
  );
}
