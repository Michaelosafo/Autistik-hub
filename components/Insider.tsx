"use client";
import { useEffect, useState } from "react";

type State = {
  ready: boolean;
  setup: string;
  settings: { killed: boolean; dry_run: boolean; last_note: string | null; last_run: string | null };
  sources: { id: number; kind: string; handle: string; enabled: boolean }[];
  rules: { id: number; caller: string | null; min_score: number; chains: string[]; max_buy_usd: number; wallets: number[]; max_per_hour: number; min_liq_usd: number; max_tax_pct: number; max_age_min: number; tp_multiple: number; sl_pct: number; max_hold_min: number; partial_pct: number | null; enabled: boolean }[];
  calls: { id: number; source_kind: string; who: string; chain: string; token: string; symbol: string | null; url: string | null; posted_at: string; price_usd: number | null; multiple: number | null; hit_2x: boolean | null; early_min: number | null }[];
  positions: { id: number; chain: string; token: string; symbol: string | null; wallet_slot: number | null; wallet: string | null; mode: string; entry_usd: number; size_usd: number; status: string; pnl_usd: number | null; reason: string | null; opened_at: string; tx: string | null }[];
  log: { at: string; text: string }[];
  leaderboard: { source_kind: string; who: string; calls: number; priced: number; hit: number; median: number; early: number | null; score: number }[];
  discover: { source_kind: string; who: string; score: number; early: number | null; hit: number }[];
};

const CHAINS = ["bsc", "ethereum", "base", "arbitrum", "solana"];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const when = (iso: string) => new Date(iso).toLocaleString();

async function api(body?: object): Promise<State & { error?: string }> {
  const r = await fetch("/api/admin/insider", { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d;
}

export default function Insider() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState("x");
  const [handle, setHandle] = useState("");
  const [rule, setRule] = useState({ caller: "", min_score: "60", chains: CHAINS, max_buy_usd: "25", wallets: "1", max_per_hour: "4", min_liq_usd: "15000", max_tax_pct: "10", max_age_min: "180", tp_multiple: "2", sl_pct: "40", max_hold_min: "360", partial_pct: "" });

  function load() {
    api().then(setS).catch((e) => setErr(e.message));
  }
  useEffect(() => { load(); }, []);

  async function go(body: object) {
    setBusy(true);
    setErr("");
    try { setS(await api(body)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (!s) return <p className="muted">{err || "Loading…"}</p>;
  if (!s.ready) return <div className="notice">{s.setup}</div>;

  return (
    <div className="stack">
      <div className="notice stack" style={{ gap: 8 }}>
        <b>{s.settings.killed ? "Kill switch is on. No new buys." : s.settings.dry_run ? "Paper mode. Buys are pretend, at the real price." : "Live. Buys use your sniper wallets."}</b>
        <small className="muted">{s.settings.last_note || "The minute job has not run yet."}{s.settings.last_run ? ` · ${when(s.settings.last_run)}` : ""}</small>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn small" type="button" disabled={busy} onClick={() => go({ action: "settings", killed: !s.settings.killed, dry_run: s.settings.dry_run })}>{s.settings.killed ? "Turn the kill switch off" : "Kill switch"}</button>
          <button className="btn small" type="button" disabled={busy} onClick={() => {
            if (s.settings.dry_run && !confirm("Turn off paper mode? The next matching call buys with your sniper wallets. You can turn the kill switch on at any time. Sells at the target, stop, or time limit still run.")) return;
            go({ action: "settings", killed: s.settings.killed, dry_run: !s.settings.dry_run });
          }}>{s.settings.dry_run ? "Allow live buys" : "Back to paper mode"}</button>
          <button className="btn small" type="button" disabled={busy} onClick={() => go({ action: "run" })}>Check now</button>
        </div>
        <small className="muted">Open positions still sell at the target, stop, or time limit while the kill switch is on. Live sells are skipped while it is on. Wallet addresses and transaction links stay visible.</small>
      </div>

      <b>Sources</b>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Source">
          <option value="x">X account</option>
          <option value="telegram">Telegram channel</option>
          <option value="reddit">Reddit (r/name or u/name)</option>
          <option value="dex">DexScreener trending</option>
        </select>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={kind === "dex" ? "latest" : kind === "reddit" ? "r/CryptoMoonShots" : "account"} aria-label="Account or channel" />
        <button className="btn small" type="button" disabled={busy || (kind !== "dex" && !handle.trim())} onClick={() => { go({ action: "source-add", kind, handle: kind === "dex" ? handle.trim() || "latest" : handle.trim() }); setHandle(""); }}>Add</button>
      </div>
      {s.sources.map((src) => (
        <div key={src.id} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
          <span>{src.kind} · {src.handle}</span>
          <button className="btn small ghost" type="button" disabled={busy} onClick={() => go({ action: "source-del", id: src.id })}>Remove</button>
        </div>
      ))}
      <small className="muted">X uses recent search (X_BEARER_TOKEN). Telegram uses the bot if it is in the channel (TELEGRAM_BOT_TOKEN), and a user session when TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_SESSION are set. A held X filtered stream needs the Railway worker. GMGN has no public API here.</small>

      <b>Buy rule</b>
      <div className="stack" style={{ gap: 6 }}>
        <label className="field"><span>Caller <small className="muted">blank = everyone on the list</small></span><input value={rule.caller} onChange={(e) => setRule({ ...rule, caller: e.target.value })} placeholder="optional" /></label>
        <label className="field"><span>Min score (0–100)</span><input value={rule.min_score} onChange={(e) => setRule({ ...rule, min_score: e.target.value })} inputMode="decimal" /></label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {CHAINS.map((c) => (
            <label key={c}><input type="checkbox" checked={rule.chains.includes(c)} onChange={(e) => setRule({ ...rule, chains: e.target.checked ? [...rule.chains, c] : rule.chains.filter((x) => x !== c) })} /> {c}</label>
          ))}
        </div>
        <label className="field"><span>Max buy per wallet (USD)</span><input value={rule.max_buy_usd} onChange={(e) => setRule({ ...rule, max_buy_usd: e.target.value })} inputMode="decimal" /></label>
        <label className="field"><span>Sniper wallets</span><input value={rule.wallets} onChange={(e) => setRule({ ...rule, wallets: e.target.value })} placeholder="1,2" /></label>
        <label className="field"><span>Max buys per hour</span><input value={rule.max_per_hour} onChange={(e) => setRule({ ...rule, max_per_hour: e.target.value })} inputMode="numeric" /></label>
        <label className="field"><span>Liquidity floor (USD)</span><input value={rule.min_liq_usd} onChange={(e) => setRule({ ...rule, min_liq_usd: e.target.value })} inputMode="decimal" /></label>
        <label className="field"><span>Max buy or sell tax %</span><input value={rule.max_tax_pct} onChange={(e) => setRule({ ...rule, max_tax_pct: e.target.value })} inputMode="decimal" /></label>
        <label className="field"><span>Max token age (minutes)</span><input value={rule.max_age_min} onChange={(e) => setRule({ ...rule, max_age_min: e.target.value })} inputMode="numeric" /></label>
        <label className="field"><span>Take profit (multiple)</span><input value={rule.tp_multiple} onChange={(e) => setRule({ ...rule, tp_multiple: e.target.value })} inputMode="decimal" /></label>
        <label className="field"><span>Stop-loss % down</span><input value={rule.sl_pct} onChange={(e) => setRule({ ...rule, sl_pct: e.target.value })} inputMode="decimal" /></label>
        <label className="field"><span>Time exit (minutes)</span><input value={rule.max_hold_min} onChange={(e) => setRule({ ...rule, max_hold_min: e.target.value })} inputMode="numeric" /></label>
        <label className="field"><span>Partial sell % at the target <small className="muted">blank = sell all</small></span><input value={rule.partial_pct} onChange={(e) => setRule({ ...rule, partial_pct: e.target.value })} inputMode="decimal" /></label>
        <button className="btn" type="button" disabled={busy} onClick={() => go({ action: "rule-save", ...rule })}>Save rule</button>
      </div>
      {s.rules.map((r) => (
        <div key={r.id} className="row" style={{ gap: 8, justifyContent: "space-between" }}>
          <small>{r.caller || "Default"} · score ≥ {r.min_score} · ${r.max_buy_usd} · wallets {r.wallets.join(",")} · {r.tp_multiple}x / -{r.sl_pct}% / {r.max_hold_min}m · {r.chains.join(", ")}</small>
          <button className="btn small ghost" type="button" disabled={busy} onClick={() => go({ action: "rule-del", id: r.id })}>Remove</button>
        </div>
      ))}

      <b>Leaderboard</b>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Hit rate is how often the price later reached 2x. The multiple is the median of the best price seen in 1h, 6h and 24h. Early is the median minutes after the pool was created (negative means they posted before it).</p>
      {!s.leaderboard.length && <small className="muted">No scored calls yet.</small>}
      {s.leaderboard.map((r) => (
        <div key={`${r.source_kind}:${r.who}`}>
          <b>{r.who}</b> <small className="muted">{r.source_kind} · score {r.score} · 2x hit {pct(r.hit)} · median {r.median.toFixed(2)}x · early {r.early == null ? "—" : `${Math.round(r.early)}m`} · {r.priced} priced / {r.calls} calls</small>
        </div>
      ))}

      <b>Discover</b>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Accounts already in the saved calls that posted within 30 minutes of the pool and are not on your source list.</p>
      {!s.discover.length && <small className="muted">Nothing to suggest yet.</small>}
      {s.discover.map((r) => (
        <div key={`d:${r.source_kind}:${r.who}`} className="row" style={{ gap: 8 }}>
          <span>{r.who} <small className="muted">score {r.score} · 2x {pct(r.hit)}</small></span>
          <button className="btn small" type="button" disabled={busy} onClick={() => go({ action: "source-add", kind: r.source_kind === "telegram" ? "telegram" : r.source_kind === "reddit" ? "reddit" : "x", handle: r.who })}>Track</button>
        </div>
      ))}

      <b>Positions</b>
      {!s.positions.length && <small className="muted">No buys yet.</small>}
      {s.positions.map((p) => (
        <div key={p.id}>
          <b>{p.symbol || p.token.slice(0, 6)}</b> {p.chain} · {p.mode} · {p.status} · ${Number(p.size_usd).toFixed(0)} @ {Number(p.entry_usd)}
          {p.pnl_usd != null && <> · PnL ${Number(p.pnl_usd).toFixed(2)}</>}
          {p.wallet_slot != null && <> · wallet {p.wallet_slot}{p.wallet ? ` ${p.wallet}` : ""}</>}
          {p.reason && <> · {p.reason}</>}
          {p.tx && <> · <a href={p.tx.startsWith("http") ? p.tx : `https://dexscreener.com/${p.chain}/${p.token}`} target="_blank" rel="noreferrer">tx {p.tx.slice(0, 8)}</a></>}
          {" "}· <a href={`https://dexscreener.com/${p.chain}/${p.token}`} target="_blank" rel="noreferrer">chart</a>
        </div>
      ))}

      <b>Recent calls</b>
      {s.calls.slice(0, 20).map((c) => (
        <div key={c.id}>
          <small>{c.who} · {c.chain} · {c.symbol || c.token.slice(0, 8)} · {c.multiple != null ? `${Number(c.multiple).toFixed(2)}x` : "no price yet"}{c.hit_2x ? " · 2x" : ""}{c.early_min != null ? ` · ${Math.round(c.early_min)}m after pool` : ""} {c.url && <a href={c.url} target="_blank" rel="noreferrer">post</a>}</small>
        </div>
      ))}

      {!!s.log.length && <b>Log</b>}
      {s.log.map((l, i) => <small key={i} className="muted">{when(l.at)} · {l.text}</small>)}
      {err && <small className="muted">{err}</small>}
    </div>
  );
}
