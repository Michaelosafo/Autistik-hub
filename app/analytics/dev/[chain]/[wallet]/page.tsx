import Link from "next/link";
import { notFound } from "next/navigation";
import TokenLogo from "@/components/TokenLogo";
import { ACHAINS, isAChain, isChainAddress } from "@/lib/analytics";
import { devReport, devVerdict, type DevReport, type DevToken } from "@/lib/dev-history";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { RememberDev } from "@/components/RecentDevs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const metadata = { title: "Dev wallet · AUTISTIK Scanner", description: "A dev's earlier tokens: how many bonded, which are alive, and how likely a new one is to do well." };

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const usd = (n: number | null) => n == null ? "–" : "$" + Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = (Date.now() - Date.parse(iso)) / 86_400_000;
  return d < 1 ? "today" : d < 30 ? `${Math.floor(d)}d ago` : d < 365 ? `${Math.floor(d / 30)}mo ago` : `${Math.floor(d / 365)}y ago`;
};
const STATUS: Record<DevToken["status"], { t: string; c: string }> = {
  alive: { t: "Doing well", c: "ok" }, bonded: { t: "Bonded", c: "good" }, curve: { t: "Not bonded", c: "mid" }, dead: { t: "Dead", c: "bad" }, unknown: { t: "No data", c: "mid" },
};

export default async function DevPage({ params, searchParams }: { params: { chain: string; wallet: string }; searchParams: { show?: string; fresh?: string; from?: string } }) {
  if (!isAChain(params.chain) || !isChainAddress(params.chain, params.wallet)) notFound();
  const chain = params.chain, c = ACHAINS[chain];
  const user = await currentUser();
  let r: DevReport | null = null, err = "";
  if (!user) {
    // Signed out: only an earlier scan is shown (scans cost API calls).
    const { data } = await supabaseService().from("dev_scans").select("report").eq("chain", chain).ilike("wallet", params.wallet).maybeSingle();
    r = (data?.report as DevReport) ?? null;
  } else {
    try { r = await devReport(chain, params.wallet, searchParams.fresh === "1"); } catch (e) { err = "Couldn't read this wallet's history right now. Try again in a minute."; console.error("dev scan", (e as Error).message); }
  }
  const show = (["all", "bonded", "alive", "dead"] as const).find((k) => k === searchParams.show) ?? "all";
  const list = (r?.tokens ?? []).filter((t) => show === "all" || (show === "bonded" ? t.status === "bonded" || t.status === "alive" : t.status === show));
  // Opened from a token's scanner page: keep a way back to it, and to this wallet from any of its tokens.
  const from = searchParams.from && isChainAddress(chain, searchParams.from) ? searchParams.from : null;
  const fromSym = from ? r?.tokens.find((t) => t.token.toLowerCase() === from.toLowerCase())?.symbol : null;
  const keep = from ? `from=${from}` : "";
  const base = `/analytics/dev/${chain}/${params.wallet}`;
  const at = (q: string) => base + (q || keep ? "?" + [q, keep].filter(Boolean).join("&") : "");
  const v = r ? devVerdict(r) : null;
  const peaks = (r?.tokens ?? []).filter((t) => (t.athCap ?? 0) > 0);
  const bestAth = peaks.slice().sort((a, b) => (b.athCap ?? 0) - (a.athCap ?? 0))[0];
  const crashed = (r?.tokens ?? []).filter((t) => (t.athCap ?? 0) >= 50_000 && (t.marketCap ?? 0) < (t.athCap ?? 0) * 0.1).length;
  const tone = !r ? "" : r.label === "Strong" ? "ok" : r.label === "Mixed" ? "mid" : "bad";

  return (
    <div className="stack scan-page dev-page" style={{ maxWidth: 1080 }}>
      <div className="token-search back-links">
        {from && <Link href={`/analytics/${chain}/${from}`} className="back-btn">← Back to {fromSym ? `$${fromSym}` : short(from)}</Link>}
        <Link href="/analytics" className="muted">← Scanner</Link>
      </div>
      {r && <RememberDev chain={chain} wallet={params.wallet} score={r.score ?? null} label={r.label ?? null} />}
      <header className="bd-top ln-top">
        <div>
          <h1>Dev wallet</h1>
          <p className="muted">{c.name} · <a className="mono" href={`${c.explorer}/${chain === "solana" ? "account" : "address"}/${params.wallet}`} target="_blank" rel="noopener noreferrer">{short(params.wallet)}</a> · their earlier tokens and how they did.</p>
        </div>
        {user && r && <div className="ln-top-r"><Link className="ln-ghost" href={at("fresh=1")} prefetch={false}>↻ Check again</Link></div>}
      </header>

      {from && (
        <nav className="scan-tabs" aria-label="Sections">
          {([
            ["Overview", `/analytics/${chain}/${from}`], ["Dev wallet", null], ["Wallets", `/analytics/${chain}/${from}?view=wallets`],
            ["Trades", `/analytics/${chain}/${from}?view=trades`], ["Safety", `/analytics/${chain}/${from}?view=safety`], ["Game arena", `/arena/${chain}/${from}`],
          ] as const).map(([name, href]) => href
            ? <Link key={name} href={href} scroll={false}>{name}</Link>
            : <Link key={name} href={at("")} aria-current="page" scroll={false}>{name}</Link>)}
        </nav>
      )}

      {r && v && (
        <section className={`card dev-verdict ${v.kind}`} aria-label="Can this dev push a project?">
          <small>Can this dev push a project?</small>
          <b className="dev-verdict-t">{v.kind === "push" ? "✅ " : v.kind === "avoid" ? "⛔ " : "⚠️ "}{v.title}</b>
          <div className="dev-verdict-cols">
            {v.good.length > 0 && <ul className="good">{v.good.map((x) => <li key={x}>{x}</li>)}</ul>}
            {v.bad.length > 0 && <ul className="bad">{v.bad.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
          <small className="muted">Based on their past launches only. A good past doesn&apos;t promise a good next token. Not financial advice.</small>
        </section>
      )}

      {!r ? (
        <div className="card stack" style={{ gap: 8 }}>
          {err ? <p className="notice warn" style={{ margin: 0 }}>{err}</p> : <>
            <b>Sign in to check this dev</b>
            <p className="muted" style={{ margin: 0 }}>We look up every token this wallet created and how each one did.</p>
            <Link className="btn primary" href={`/login?next=${encodeURIComponent(base)}`} style={{ alignSelf: "flex-start" }}>Sign in</Link>
          </>}
        </div>
      ) : (
        <>
          <div className="dev-grid">
            <section className={`card dev-score ${tone}`} aria-label="Dev score">
              <small>Dev score</small>
              <div className="dev-ring"><b>{r.score}</b><span>/100</span></div>
              <b className="dev-label">{r.label === "New dev" ? "New dev" : `${r.label} track record`}</b>
              <p>{r.summary}</p>
              {r.tokens.length > 0 && <div className="dev-chance"><span>Chance a new token from this dev bonds</span><b>≈{r.bondChance}%</b></div>}
            </section>
            <section className="card dev-stats" aria-label="Overview">
              <Link href={at("")} replace scroll={false} aria-current={show === "all" ? "page" : undefined}><small>Tokens launched</small><b>{r.stats.launched}</b></Link>
              <Link href={at("show=bonded")} replace scroll={false} aria-current={show === "bonded" ? "page" : undefined}><small>Bonded / on a DEX</small><b className="up">{r.stats.bonded}</b></Link>
              <Link href={at("show=alive")} replace scroll={false} aria-current={show === "alive" ? "page" : undefined}><small>Still doing well</small><b className="up">{r.stats.alive}</b></Link>
              <Link href={at("show=dead")} replace scroll={false} aria-current={show === "dead" ? "page" : undefined}><small>Dead</small><b className="down">{r.stats.dead}</b></Link>
              <div><small>Launched last 30 days</small><b>{r.stats.last30d}</b></div>
              <div><small>Best all-time high</small><b>{usd(bestAth?.athCap ?? r.stats.bestCap)}{(bestAth?.symbol ?? r.stats.bestSymbol) ? <small> ${bestAth?.symbol ?? r.stats.bestSymbol}</small> : null}</b></div>
              <div><small>Fell 90%+ from peak</small><b className={crashed ? "down" : ""}>{peaks.length ? crashed : "–"}</b></div>
            </section>
          </div>

          {(r.notes.length > 0 || r.limited) && (
            <section className="card stack dev-notes">
              <b>What stands out</b>
              <ul>{r.notes.map((n) => <li key={n}>{n}</li>)}{r.limited && <li className="muted">{r.limited}</li>}</ul>
            </section>
          )}

          <section className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <h2 style={{ margin: 0 }}>Their tokens{show !== "all" ? ` · ${show === "bonded" ? "bonded" : show === "alive" ? "doing well" : "dead"}` : ""}</h2>
              <small className="muted">{list.length} shown · tap one to scan it</small>
            </div>
            {!list.length && <div className="card empty">{r.tokens.length ? "None in this group." : "No earlier tokens found for this wallet."}</div>}
            <div className="dev-tokens">
              {list.map((t) => {
                const st = STATUS[t.status];
                return (
                  <Link key={t.token} href={`/analytics/${chain}/${t.token}?dev=${params.wallet}`} className="dev-token">
                    <TokenLogo src={t.logo} symbol={t.symbol || "?"} />
                    <span className="grow"><b>{t.symbol ? `$${t.symbol}` : short(t.token)}</b><small>{t.name || short(t.token)} · {ago(t.createdAt)}{t.launchedHere ? " · AUTISTIK" : ""}</small></span>
                    <span className="dev-nums"><b>{usd(t.marketCap)}</b><small>{t.athCap ? <>ATH {usd(t.athCap)}</> : <>liq {usd(t.liquidityUsd)}</>}</small></span>
                    <span className={`dev-st ${st.c}`}>{st.t}</span>
                  </Link>
                );
              })}
            </div>
          </section>
          <p className="muted" style={{ fontSize: ".8em" }}>From {r.sources.join(", ") || "on-chain data"} · checked {ago(r.scannedAt) === "today" ? "recently" : ago(r.scannedAt)}. &quot;Bonded&quot; means the token left its launchpad curve or got a real DEX pool. The score is an estimate from past results, not a promise and not financial advice.</p>
        </>
      )}
    </div>
  );
}
