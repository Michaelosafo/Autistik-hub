"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DevScan } from "@/components/ScanTools";
import { SCAN_CHAINS } from "@/lib/analytics-chains";
import ZoneCard from "@/components/ZoneCard";
import TradePlans from "@/components/TradePlans";
import BundleCard from "@/components/BundleCard";

/**
 * The AUTISTIK scanner dashboard (light / dark with the site theme): metrics, scan bar, threat radar, 0–100 risk
 * gauge, token overview, top pools, every security check, holder analysis and recent scans. Data comes from
 * /api/scanner/quick (GoPlus, honeypot.is, RugCheck, DexScreener, graded by AUTISTIK's advanced audit). AUTISTIK's own
 * tools sit on top (dev wallet, hot coins, pins) and "Open full analysis" does the tracked scan.
 */
type Level = "ok" | "warn" | "bad" | "unknown";
type Check = { level: Level; label: string; detail: string; group: string };
type Result = {
  chain: string; chainName: string; std: string; token: string; name: string | null; symbol: string | null; logo: string | null;
  move: any; report: { grade: string; score: number | null; headline: string; bad: number; warn: number; ok: number; groups: { title: string; checks: { level: Level; label: string; detail: string }[] }[] };
  holders: { wallet: string; label: string | null; pct: number | null; kind: string }[];
  dev: string | null;
};
type Recent = { chain: string; token: string; label: string; risk: number | null };

const ICONS: Record<string, JSX.Element> = {
  token: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  dev: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  hot: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z" />,
  pins: <path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
};
const TOOLS = [
  { k: "token", name: "Token scan" }, { k: "dev", name: "Dev wallet" },
{ k: "hot", name: "Hot coins", href: "/momentum" }, { k: "pins", name: "My pins", href: "/analytics/pins" },
] as const;
const DEMOS = [
  { chain: "bsc", token: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", name: "PancakeSwap (CAKE)" },
  { chain: "ethereum", token: "0x6982508145454ce325ddbe47a25d4ec3d2311933", name: "PEPE" },
];
const RKEY = "autistik-hx-recent";
const SIG: Record<string, string> = { buy: "Buy", take_profit: "Take profit", sell: "Sell", wait: "Wait", avoid: "Avoid" };
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const usd = (x: unknown) => {
  const v = Number(x);
  if (x == null || x === "" || !isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  if (a === 0) return "$0";
  return `$${v.toPrecision(3)}`;
};
const age = (ms: unknown) => {
  const m = Number(ms);
  if (!m) return "—";
  const h = (Date.now() - m) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} hours`;
  const d = h / 24;
  return d < 60 ? `${Math.round(d)} days` : d < 730 ? `${Math.round(d / 30)} months` : `${(d / 365).toFixed(1)} years`;
};
const short = (a: string) => (a && a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "—");
const pctS = (n: number | null | undefined, d = 1) => (n == null ? "—" : `${n.toFixed(d).replace(/\.0+$/, "")}%`);
const TICKS = Array.from({ length: 41 }, (_, i) => {
  const a = Math.PI * (1.17 - (i / 40) * 1.34), r1 = 108, r2 = i % 5 ? 114 : 118;
  return { x1: 120 + r1 * Math.cos(a), y1: 140 - r1 * Math.sin(a), x2: 120 + r2 * Math.cos(a), y2: 140 - r2 * Math.sin(a), c: i < 16 ? "var(--hx-low)" : i < 26 ? "var(--hx-warn)" : "var(--hx-bad)" };
});

export default function HyperScanner({ signedIn, tracked, movesToday }: { signedIn: boolean; tracked: number; movesToday: number }) {
  const router = useRouter();
  const [tool, setTool] = useState<"token" | "dev">("token");
  const [chain, setChain] = useState("auto");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<{ text: string; err?: boolean } | null>(null);
  const [r, setR] = useState<Result | null>(null);
  const [stats, setStats] = useState({ scans: 0, threats: 0 });
  const [recent, setRecent] = useState<Recent[]>([]);
  const [opening, setOpening] = useState(false);
  const [adv, setAdv] = useState<any>(null);
  const [advBusy, setAdvBusy] = useState(false);
  const [advErr, setAdvErr] = useState("");
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem(RKEY) || "[]").slice(0, 8)); } catch { /* private mode */ }
    const q = new URLSearchParams(location.search);
    const t = q.get("token");
    if (t) { const ch = q.get("chain") || "auto"; setAddr(t); setChain(ch); scan(ch, t); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan(ch: string, token: string) {
    token = token.trim();
    if (!token) return;
    if (!/^0x[0-9a-fA-F]{40}$/.test(token) && !SOL.test(token)) { setHint({ text: "That doesn't look like a token address. 0x addresses have 42 characters; Solana mints are 32–44 letters and numbers.", err: true }); return; }
    if (SOL.test(token) && !token.startsWith("0x")) { ch = "solana"; setChain("solana"); }
    setBusy(true);
    setHint({ text: `Checking ${short(token)}${ch === "auto" ? " (finding the network…)" : ""}…` });
    try {
      const res = await fetch("/api/scanner/quick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: ch, token }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { setHint({ text: d.error || "Couldn't scan that token. Try again.", err: true }); return; }
      const x = d as Result;
      setR(x);
      setAdv(null); setAdvErr("");
      if (signedIn) void advanced(x.chain, x.token);
      const risk = x.report.score == null ? null : 100 - x.report.score;
      const label = x.symbol || short(x.token);
      setStats((s) => ({ scans: s.scans + 1, threats: s.threats + x.report.bad }));
      const next = [{ chain: x.chain, token: x.token, label, risk }, ...recent.filter((v) => v.token !== x.token)].slice(0, 8);
      setRecent(next);
      try { localStorage.setItem(RKEY, JSON.stringify(next)); } catch { /* private mode */ }
      setHint({ text: `Scanned ${label} on ${x.chainName} at ${new Date().toLocaleTimeString()}. ${x.report.bad ? `${x.report.bad} serious issue${x.report.bad > 1 ? "s" : ""} found.` : "No serious issues found."} A snapshot, not a guarantee.` });
      const u = new URL(location.href); u.searchParams.set("chain", x.chain); u.searchParams.set("token", x.token); history.replaceState(null, "", u);
    } catch { setHint({ text: "Couldn't reach the scanner. Check your connection and try again.", err: true }); }
    finally { setBusy(false); }
  }

  /** Advanced scan: buy / sell read, entry zones, trade plans, bundle check, who might sell (signed-in members). */
  async function advanced(ch: string, token: string) {
    setAdvBusy(true); setAdvErr("");
    try {
      const res = await fetch("/api/scanner/advanced", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: ch, token }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || d.error) { setAdvErr(d.error || "Couldn't run the advanced scan. Try again."); return; }
      setAdv(d);
    } catch { setAdvErr("Couldn't reach the scanner. Try again."); }
    finally { setAdvBusy(false); }
  }

  async function openFull() {
    if (!r) return;
    if (!signedIn) { router.push(`/login?next=${encodeURIComponent(`/analytics?chain=${r.chain}&token=${r.token}`)}`); return; }
    setOpening(true);
    const res = await fetch("/api/analytics/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: r.chain, token: r.token }) });
    const d = await res.json().catch(() => ({}));
    setOpening(false);
    if (!res.ok) { setHint({ text: d.error || "Couldn't open the full analysis. Try again.", err: true }); return; }
    router.push(d.path);
  }

  const checks: Check[] = r ? r.report.groups.flatMap((g) => g.checks.map((c) => ({ ...c, group: g.title }))) : [];
  const order: Record<Level, number> = { bad: 0, warn: 1, unknown: 2, ok: 3 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  const flags = checks.filter((c) => c.level === "bad" || c.level === "warn");
  const risk = r && r.report.score != null ? 100 - r.report.score : null;
  const verdict = !r ? "Scan a token" : risk == null ? "Not enough data" : risk <= 40 ? "Low risk" : risk <= 80 ? "Moderate risk" : "High risk";
  const tone = risk == null ? "" : risk <= 40 ? "low" : risk <= 80 ? "mid" : "high";
  const m = r?.move;
  const liq = m?.poolList?.length ? m.poolList.reduce((s: number, p: any) => s + (Number(p.liquidityUsd) || 0), 0) : m?.liquidityUsd;
  const ch24 = m?.h24 != null ? Number(m.h24) : null;
  const blips = flags.slice(0, 10).map((c, i) => {
    const ang = (i * 137.5 * Math.PI) / 180, rad = 38 + ((i * 29) % 58);
    return { x: 110 + rad * Math.cos(ang), y: 110 + rad * Math.sin(ang), c, i };
  });

  return (
    <div className={"hx" + (busy ? " scanning" : "")} ref={top}>
      <header className="hx-top">
        <div>
          <div className="hx-kicker">AUTISTIK · SCANNER</div>
          <h1>Scan before you buy</h1>
          <p className="hx-greet">Know what you&apos;re buying before you buy it.</p>
        </div>
        <span className="hx-live">Live data</span>
      </header>

      <nav className="hx-tools" aria-label="Scanner tools">
        {TOOLS.map((t) => {
          const inner = <><i aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[t.k]}</svg></i>{t.name}</>;
          return "href" in t
            ? <Link key={t.k} href={t.href}>{inner}</Link>
            : <button key={t.k} type="button" className={tool === t.k ? "on" : ""} aria-pressed={tool === t.k} onClick={() => setTool(t.k)}>{inner}</button>;
        })}
      </nav>

      <section className="hx-panel hx-metrics" aria-label="Global metrics">
        <h2>Global metrics</h2>
        <div className="hx-mgrid">
          <div className="hx-metric"><span>Scans this session</span><b>{stats.scans}</b></div>
          <div className="hx-metric"><span>Threats flagged</span><b>{stats.threats}</b></div>
          <div className="hx-metric"><span>Checks per scan</span><b>30+</b></div>
          <div className="hx-metric"><span>Networks</span><b>{SCAN_CHAINS.length}</b></div>
          <div className="hx-metric"><span>Tokens tracked</span><b>{tracked.toLocaleString("en-US")}</b></div>
        </div>
        <small className="hx-sub">{movesToday.toLocaleString("en-US")} top-wallet moves today · data from GoPlus, honeypot.is, RugCheck, DexScreener and the blockchain</small>
      </section>

      {tool === "dev" ? (
        <section className="hx-panel"><h2 style={{ marginBottom: 10 }}>Dev wallet</h2><p className="hx-sub" style={{ marginTop: 0 }}>Paste the wallet behind a token: their past tokens, how many bonded, and the chance this one does well.</p><DevScan /></section>
      ) : (
        <>
          <form className="hx-scanbar" onSubmit={(e) => { e.preventDefault(); scan(chain, addr); }} autoComplete="off">
            <label className="hx-sr" htmlFor="hx-chain">Network</label>
            <div className="hx-select">
              <select id="hx-chain" value={chain} onChange={(e) => setChain(e.target.value)}>
                <option value="auto">⚡ Auto-detect</option>
                {SCAN_CHAINS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
              </select>
            </div>
            <label className="hx-sr" htmlFor="hx-addr">Token contract address</label>
            <input id="hx-addr" value={addr} onChange={(e) => { const v = e.target.value; setAddr(v); if (SOL.test(v.trim()) && !v.trim().startsWith("0x")) setChain("solana"); else if (/^0x/i.test(v.trim()) && chain === "solana") setChain("auto"); }} placeholder="Paste a token contract address (0x… or Solana mint)" spellCheck={false} />
            <button className="hx-btn hx-scan" type="submit" disabled={busy || !addr.trim()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" /></svg>
              <span>{busy ? "Scanning…" : "Scan"}</span>
            </button>
          </form>
          <p className={"hx-hint" + (hint?.err ? " err" : "")} role="status">
            {hint ? hint.text : <>Try a demo: {DEMOS.map((d, i) => <span key={d.token}>{i ? " or " : ""}<button type="button" className="hx-link" onClick={() => { setChain(d.chain); setAddr(d.token); scan(d.chain, d.token); }}>{d.name}</button></span>)}</>}
          </p>

          <section className="hx-row3" aria-live="polite">
            <div className="hx-panel hx-threat">
              <div className="hx-ph"><h2>Threat count</h2>{r && <span className="hx-tag">{r.report.warn} warning{r.report.warn === 1 ? "" : "s"}</span>}</div>
              <b className="hx-big">{String(r ? r.report.bad : 0).padStart(2, "0")}</b>
              <div className="hx-radar">
                <svg viewBox="0 0 220 220" aria-hidden="true">
                  <defs>
                    <radialGradient id="hxRg" cx="50%" cy="50%" r="50%"><stop offset="0" style={{ stopColor: "var(--hx-r1)" }} /><stop offset="1" style={{ stopColor: "var(--hx-r2)" }} /></radialGradient>
                    <linearGradient id="hxSweep" x1="0" x2="1"><stop offset="0" style={{ stopColor: "var(--hx-sweep)", stopOpacity: 0 }} /><stop offset="1" style={{ stopColor: "var(--hx-sweep)", stopOpacity: 0.5 }} /></linearGradient>
                  </defs>
                  <circle cx="110" cy="110" r="104" fill="url(#hxRg)" />
                  <g style={{ stroke: "var(--hx-rline)" }} strokeOpacity=".25" fill="none"><circle cx="110" cy="110" r="80" /><circle cx="110" cy="110" r="56" /><circle cx="110" cy="110" r="32" /><path d="M110 6v208M6 110h208M37 37l146 146M183 37 37 183" /></g>
                  <path className="hx-sweep" d="M110 110 L110 6 A104 104 0 0 1 200 58 Z" fill="url(#hxSweep)" />
                  {blips.map((b) => {
                    const tag = b.c.level === "bad" && b.i < 3;
                    const w = Math.min(96, 8 + b.c.label.length * 5.2), lx = Math.min(214 - w, Math.max(6, b.x - w / 2)), ly = b.y < 30 ? b.y + 8 : b.y - 20;
                    return (
                      <g key={b.i}>
                        <circle cx={b.x.toFixed(1)} cy={b.y.toFixed(1)} r="4" style={{ fill: b.c.level === "bad" ? "var(--hx-bad)" : "var(--hx-warn)" }}><title>{b.c.label}</title></circle>
                        {tag && <><rect x={lx.toFixed(1)} y={ly.toFixed(1)} width={w.toFixed(1)} height="14" rx="3" style={{ fill: "var(--hx-gold2)" }} /><text className="hx-blip" x={(lx + w / 2).toFixed(1)} y={(ly + 10).toFixed(1)} textAnchor="middle" fill="#1a1403">{b.c.label.slice(0, 18)}</text></>}
                      </g>
                    );
                  })}
                </svg>
                <span className="hx-rlabel">{r ? short(r.token) : "Waiting for a scan"}</span>
              </div>
            </div>

            <div className={`hx-panel hx-gauge ${tone}`}>
              <div className="hx-ph"><h2>Risk score</h2>{r && <span className={`hx-grade g-${r.report.grade}`} title="AUTISTIK grade">Grade {r.report.grade}</span>}</div>
              <div className="hx-gwrap">
                <svg viewBox="0 0 240 170" aria-hidden="true">
                  <defs><linearGradient id="hxGg" x1="0" x2="1"><stop offset="0" style={{ stopColor: "var(--hx-low)" }} /><stop offset=".5" style={{ stopColor: "var(--hx-warn)" }} /><stop offset="1" style={{ stopColor: "var(--hx-bad)" }} /></linearGradient></defs>
                  {TICKS.map((t, i) => <line key={i} x1={t.x1.toFixed(1)} y1={t.y1.toFixed(1)} x2={t.x2.toFixed(1)} y2={t.y2.toFixed(1)} style={{ stroke: t.c }} strokeOpacity=".75" strokeWidth="2" strokeLinecap="round" />)}
                  <path d="M30 140 A90 90 0 1 1 210 140" fill="none" style={{ stroke: "var(--hx-track)" }} strokeWidth="16" strokeLinecap="round" />
                  <path className="hx-arc" d="M30 140 A90 90 0 1 1 210 140" fill="none" stroke="url(#hxGg)" strokeWidth="16" strokeLinecap="round" pathLength={100} strokeDasharray={risk == null ? "0 100" : `${Math.max(1, risk)} 100`} />
                </svg>
                <div className="hx-gread"><span>Risk score</span><b>{risk ?? "--"}</b><em>{verdict}</em></div>
              </div>
              <ul className="hx-legend">
                <li><i style={{ background: "var(--hx-low)" }} />Low risk<b>0 – 40</b></li>
                <li><i style={{ background: "var(--hx-warn)" }} />Moderate<b>41 – 80</b></li>
                <li><i style={{ background: "var(--hx-bad)" }} />High risk<b>81 – 100</b></li>
              </ul>
              {r && <p className="hx-headline">{r.report.headline}</p>}
            </div>

            <div className="hx-panel hx-ov">
              <div className="hx-ph"><h2>Token overview</h2><span className="hx-tag">{r ? (r.symbol ? `${r.name || r.symbol} (${r.symbol})` : r.name || "Unknown token") : "No token yet"}</span></div>
              <dl>
                <div><dt>Market cap</dt><dd>{usd(m?.marketCap)}</dd></div>
                <div><dt>24h volume</dt><dd>{usd(m?.volumeH24)}</dd></div>
                <div><dt>Liquidity</dt><dd>{usd(liq)}</dd></div>
                <div><dt>Price</dt><dd>{usd(m?.priceUsd)}</dd></div>
                <div><dt>24h change</dt><dd>{ch24 == null ? "—" : <span className={ch24 >= 0 ? "up" : "down"}>{ch24 >= 0 ? "+" : ""}{pctS(ch24)}</span>}</dd></div>
                <div><dt>Contract</dt><dd title={r?.token}>{r ? short(r.token) : "—"}</dd></div>
                <div><dt>Blockchain</dt><dd>{r ? `${r.chainName} · ${r.std}` : "—"}</dd></div>
                <div><dt>Pool age</dt><dd>{age(m?.pairCreatedAt)}</dd></div>
                <div><dt>Dev / deployer</dt><dd>{r?.dev ? <Link href={`/analytics/dev/${r.chain}/${r.dev}?from=${r.token}`} title={r.dev}>{short(r.dev)} →</Link> : "—"}</dd></div>
              </dl>
              {r && (
                <div className="hx-actions">
                  <button type="button" className="hx-btn" onClick={openFull} disabled={opening}>{opening ? "Opening…" : signedIn ? "Open full analysis →" : "Sign in for full analysis →"}</button>
                  {r.dev && <Link className="hx-ghost" href={`/analytics/dev/${r.chain}/${r.dev}?from=${r.token}`}>Dev wallet</Link>}
                </div>
              )}
            </div>
          </section>

          <section className="hx-row3b">
            <div className="hx-panel hx-pools">
              <div className="hx-ph"><h2>Top pools by liquidity</h2></div>
              {m?.poolList?.length ? (
                <div className="hx-pgrid">{m.poolList.map((p: any, i: number) => <div key={i} className="hx-pool"><b>{p.dex}{p.quote ? ` · ${p.quote}` : ""}</b><span>{usd(p.liquidityUsd)}</span><small>{usd(p.volumeH24)} traded in 24h</small></div>)}</div>
              ) : <p className="hx-empty">{r ? "No trading pool found on DexScreener yet." : "Pools where the token trades will show here."}</p>}
            </div>
            <div className="hx-panel hx-checks">
              <div className="hx-ph"><h2>Security checks</h2><span className="hx-tag">{r ? `${r.report.ok} / ${r.report.ok + r.report.warn + r.report.bad} passed` : "0 / 0"}</span></div>
              <ul className="hx-cklist">
                {!r && <li className="hx-empty">Run a scan to see each check.</li>}
                {checks.map((c, i) => (
                  <li key={i}><div>{c.label}<small>{c.detail}</small></div><span className={`hx-st ${c.level === "unknown" ? "na" : c.level}`} aria-label={c.level}>{{ ok: "✓", warn: "!", bad: "✕", unknown: "?" }[c.level]}</span></li>
                ))}
              </ul>
            </div>
            <div className="hx-panel hx-holders">
              <div className="hx-ph"><h2>Holder analysis</h2></div>
              <table className="hx-htable">
                <thead><tr><th>Wallet</th><th>Share</th><th>Type</th></tr></thead>
                <tbody>
                  {!r?.holders.length && <tr><td colSpan={3} className="hx-empty">{r ? "No holder data for this token." : "Top holders show here."}</td></tr>}
                  {r?.holders.map((h) => {
                    const big = h.kind === "Wallet" && (h.pct || 0) > 10;
                    const cls = h.kind === "Locked" ? "g" : h.kind === "Creator" ? "o" : big ? "r" : "n";
                    return <tr key={h.wallet}><td title={h.wallet}>{h.label || short(h.wallet)}</td><td>{pctS(h.pct, 2)}</td><td><span className={`hx-pill ${cls}`}>{big ? "Large wallet" : h.kind}</span></td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {r && (
            <section className="hx-adv" aria-label="Advanced scan">
              <div className="hx-adv-head">
                <h2>⚡ Advanced scan</h2>
                <span className="hx-tag">entry · exit · zones · bundles</span>
              </div>
              {!signedIn ? (
                <div className="hx-panel hx-adv-lock">
                  <b>Buy or sell read, entry zones, trade plans with targets, bundle check and who might sell next.</b>
                  <p className="hx-empty">Sign in to run the advanced scan on {r.symbol || short(r.token)}. It also turns on sell alerts for it.</p>
                  <button type="button" className="hx-btn" onClick={openFull}>Sign in for the advanced scan →</button>
                </div>
              ) : advBusy ? (
                <div className="hx-panel hx-adv-lock"><span className="hx-spin" aria-hidden="true" /><b>Reading the top wallets, trades and chart…</b><p className="hx-empty">The first advanced scan of a token takes up to a minute.</p></div>
              ) : advErr ? (
                <div className="hx-panel hx-adv-lock"><p className="hx-hint err" style={{ margin: 0 }}>{advErr}</p><button type="button" className="hx-btn" onClick={() => advanced(r.chain, r.token)}>Try again</button></div>
              ) : adv ? (
                <>
                  <div className="hx-adv-stats">
                    <div><span>Top wallets hold</span><b>{adv.stats.topShare == null ? "—" : pctS(adv.stats.topShare)}</b></div>
                    <div><span>Buys / sells 24h</span><b>{adv.stats.buys24 == null ? "—" : <><span className="up">{Number(adv.stats.buys24).toLocaleString("en-US")}</span> / <span className="down">{Number(adv.stats.sells24 ?? 0).toLocaleString("en-US")}</span></>}</b></div>
                    <div><span>Top-wallet sells 24h</span><b>{adv.stats.topSells24}</b></div>
                    <div><span>Holders</span><b>{adv.stats.holders ? Number(adv.stats.holders).toLocaleString("en-US") : "—"}</b></div>
                  </div>
                  <div className={"card stack verdict " + adv.call.kind}>
                    <div className="label">Buy or sell? The read right now</div>
                    <div className="verdict-top">
                      <span className="verdict-emoji" aria-hidden>{adv.call.emoji}</span>
                      <div className="grow"><h2>{adv.call.title}</h2><p>{adv.call.summary}</p></div>
                    </div>
                    {adv.call.kind !== "avoid" && (
                      <div className="verdict-meter" aria-label={`Buy score ${adv.call.score} out of 100`}>
                        <span style={{ left: `${adv.call.score}%` }} /><small>Sell</small><small>Wait</small><small>Buy</small>
                      </div>
                    )}
                    <div className="signal-now" aria-label="Signal right now">
                      <span className="label">Signal right now</span>
                      <span className={"sig " + adv.now.short}>Day trade: <b>{SIG[adv.now.short] || adv.now.short}</b></span>
                      <span className={"sig " + adv.now.long}>Long term: <b>{SIG[adv.now.long] || adv.now.long}</b></span>
                    </div>
                    {adv.call.reasons?.length > 0 && (
                      <details><summary>Why?</summary><ul className="signals">{adv.call.reasons.map((x: any, i: number) => <li key={i} className={x.level}>{x.text}</li>)}</ul></details>
                    )}
                  </div>
                  <ZoneCard z={adv.zone} symbol={adv.symbol || r.symbol || "TOKEN"} />
                  <TradePlans plans={adv.plans} symbol={adv.symbol || r.symbol || "this token"} />
                  <BundleCard b={adv.bundle} explorer={adv.explorer} token={adv.token} />
                  <DevPanel adv={adv} chain={r.chain} />
                  <div className="hx-panel">
                    <div className="hx-ph"><h2>Who might sell next</h2><span className="hx-tag">{adv.groups.length} connected group{adv.groups.length === 1 ? "" : "s"}</span></div>
                    {!adv.suspects.length ? <p className="hx-empty">✓ No wallet looks likely to sell right now.</p> : (
                      <table className="hx-htable"><thead><tr><th>Wallet</th><th>Holds</th><th>Sell risk</th></tr></thead><tbody>
                        {adv.suspects.map((x: any) => (
                          <tr key={x.wallet}><td title={x.wallet}>{short(x.wallet)}{x.isDev ? " (dev)" : ""}</td><td>{pctS(x.pct, 2)}</td><td><span className={"hx-pill " + (x.risk.level === "high" ? "r" : x.risk.level === "medium" ? "o" : "g")}>{x.risk.score}/100</span></td></tr>
                        ))}
                      </tbody></table>
                    )}
                    {adv.know?.length > 0 && <ul className="signals" style={{ marginTop: 8 }}>{adv.know.map((x: any, i: number) => <li key={i} className={x.level}>{x.text}</li>)}</ul>}
                  </div>
                  <p className="fin-note">Nothing here is financial advice. It&apos;s worked out automatically from blockchain activity and can be wrong. Never put in more than you can afford to lose.</p>
                </>
              ) : null}
            </section>
          )}

          <section className="hx-panel hx-recent">
            <div className="hx-ph"><h2>Recent scans</h2><span className="hx-tag">on this device</span></div>
            <ul className="hx-rlist">
              {!recent.length && <li className="hx-empty">Tokens you scan show here.</li>}
              {recent.map((v) => {
                const cls = v.risk == null ? "n" : v.risk <= 40 ? "g" : v.risk <= 80 ? "o" : "r";
                return (
                  <li key={v.chain + v.token}>
                    <button type="button" onClick={() => { setChain(v.chain); setAddr(v.token); scan(v.chain, v.token); top.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }}>
                      <b>{v.label}</b><small>{SCAN_CHAINS.find((c) => c.key === v.chain)?.name || v.chain}</small><span className={`hx-pill ${cls}`}>{v.risk ?? "?"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** The token's dev (deployer): their record, latest tokens, and the follow switch for new-token alerts. */
function DevPanel({ adv, chain }: { adv: any; chain: string }) {
  const [on, setOn] = useState<boolean>(!!adv.following);
  const [busy, setBusy] = useState(false);
  const w: string | null = adv.devWallet;
  const d = adv.devInfo;
  if (!w) return <div className="hx-panel"><div className="hx-ph"><h2>Dev wallet</h2></div><p className="hx-empty">We couldn't find who deployed this token yet.</p></div>;
  async function toggle() {
    setBusy(true);
    const res = await fetch("/api/analytics/dev-follow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, wallet: w, on: !on, from: adv.token }) });
    setBusy(false);
    if (res.ok) setOn(!on);
  }
  const cls = !d ? "n" : d.verdict.kind === "push" ? "g" : d.verdict.kind === "careful" ? "o" : d.verdict.kind === "avoid" ? "r" : "n";
  const st: Record<string, string> = { bonded: "g", alive: "g", curve: "o", dead: "r", unknown: "n" };
  return (
    <div className="hx-panel hx-dev">
      <div className="hx-ph"><h2>Dev wallet</h2>{d && <span className={`hx-pill ${cls}`}>{d.label} · {d.score}/100</span>}</div>
      <div className="hx-dev-top">
        <span className="mono" title={w}>{short(w)}</span>
        <button type="button" className={"hx-follow" + (on ? " on" : "")} onClick={toggle} disabled={busy} aria-pressed={on}>{on ? "🔔 Following: alert on new tokens" : "🔕 Follow this dev"}</button>
      </div>
      {d ? (
        <>
          <p className="hx-dev-sum"><b>{d.verdict.title}</b> {d.summary}</p>
          <div className="hx-adv-stats">
            <div><span>Tokens made</span><b>{d.stats.launched}</b></div>
            <div><span>Bonded</span><b>{d.stats.bonded}</b></div>
            <div><span>Still alive</span><b>{d.stats.alive}</b></div>
            <div><span>Bond chance</span><b>{Math.round(d.bondChance)}%</b></div>
          </div>
          {d.tokens.length > 0 && (
            <table className="hx-htable" style={{ marginTop: 8 }}><thead><tr><th>Their tokens</th><th>Status</th><th>Peak cap</th></tr></thead><tbody>
              {d.tokens.map((t: any) => (
                <tr key={t.token}><td title={t.token}><Link href={`/analytics?chain=${chain}&token=${t.token}`}>{t.symbol ? `$${t.symbol}` : short(t.token)}</Link>{t.token.toLowerCase() === String(adv.token).toLowerCase() ? " (this one)" : ""}</td><td><span className={`hx-pill ${st[t.status] || "n"}`}>{t.status}</span></td><td>{usd(t.athCap ?? t.marketCap)}</td></tr>
              ))}
            </tbody></table>
          )}
          {d.limited && <small className="hx-sub">{d.limited}</small>}
        </>
      ) : <p className="hx-empty">Reading this dev&apos;s history… open their full record below.</p>}
      <Link className="hx-ghost" style={{ marginTop: 8 }} href={`/analytics/dev/${chain}/${w}?from=${adv.token}`}>Full dev record →</Link>
      <small className="hx-sub">{on ? "You'll get an alert the moment this wallet creates a new token." : "Follow to get an alert when this wallet creates a new token."}</small>
    </div>
  );
}
