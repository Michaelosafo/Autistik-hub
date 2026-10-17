import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsScan from "@/components/AnalyticsScan";
import WatchButton from "@/components/WatchButton";
import Arena from "@/components/Arena";
import { insights } from "@/lib/analytics-insights";
import { holdOutlook, tradeCall, tradingPlans, whoMightSell } from "@/lib/analytics-signals";
import { getPairStats } from "@/lib/market";
import TradePlans from "@/components/TradePlans";
import { ACHAINS, checkToken, heldFor, isAChain, isChainAddress, syncTrades } from "@/lib/analytics";
import { walletUrl } from "@/lib/explorer";
import AutoRefresh from "@/components/AutoRefresh";
import { currentUser, supabaseServer, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const pct = (n: unknown) => { const v = Number(n); return !isFinite(v) ? "–" : v >= 10 ? v.toFixed(1) + "%" : v >= 0.01 ? v.toFixed(2) + "%" : "<0.01%"; };
const amt = (n: unknown) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(n) || 0);

export async function generateMetadata({ params }: { params: { chain: string; token: string } }) {
  return { title: `Analytics ${params.token.slice(0, 8)}… · AUTISTIK Hub` };
}

function status(h: any, last: any) {
  const now = Number(h.balance), peak = Number(h.peak_balance);
  if ((peak > 0 && now <= peak * 0.01) || last?.kind === "exit") return { cls: "down", text: "Sold everything" + (last ? ` · ${heldFor(last.created_at)} ago` : "") };
  if (last && (last.kind === "sell" || last.kind === "exit")) return { cls: "down", text: `Sold ${Math.round(last.pct_of_holding)}% · ${heldFor(last.created_at)} ago` };
  if (last?.kind === "buy") return { cls: "up", text: `Bought more · ${heldFor(last.created_at)} ago` };
  return { cls: "", text: "Holding" };
}

export default async function TokenAnalytics({ params }: { params: { chain: string; token: string } }) {
  if (!isAChain(params.chain) || !isChainAddress(params.chain, params.token)) notFound();
  const chain = params.chain, c = ACHAINS[chain];
  const sb = supabaseServer();
  let { data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", params.token).maybeSingle();
  const user = await currentUser();
  if (!t) return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <Link href="/analytics" className="muted">← Analytics</Link>
      <div className="card stack">
        <h1>Not tracked yet</h1>
        <p className="muted">Scan this token to see its top 40 wallets and the dev, and get sell alerts.</p>
        <AnalyticsScan signedIn={!!user} />
      </div>
    </div>
  );

  // Fresh balances when someone looks (free: public blockchain reads), at most every 3 minutes.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const svc = supabaseService();
    await svc.from("tracked_tokens").update({ viewed_at: new Date().toISOString() }).eq("chain", chain).eq("token", t.token);
    const tradesStale = !t.trades_at || Date.now() - Date.parse(t.trades_at) > 60_000;
    const balancesStale = !t.checked_at || Date.now() - Date.parse(t.checked_at) > 3 * 60_000;
    if (tradesStale || balancesStale) {
      await Promise.race([
        Promise.all([tradesStale ? syncTrades(chain, t.token, 2).catch(() => 0) : 0, balancesStale ? checkToken(chain, t.token).catch(() => []) : []]),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
      ({ data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", params.token).maybeSingle());
    }
  }

  const movePromise = getPairStats(c.dex, t.token);
  const [{ data: holders }, { data: events }, { data: watch }, { data: wc }, { data: links }, { data: trades }] = await Promise.all([
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", t.token).order("rank", { ascending: true, nullsFirst: false }),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", t.token).order("created_at", { ascending: false }).limit(500),
    user ? sb.from("launch_watchers").select("token").eq("user_id", user.id).eq("chain", chain).eq("token", t.token) : Promise.resolve({ data: [] as any[] }),
    sb.from("launch_watch_counts").select("watchers").eq("chain", chain).eq("token", t.token).maybeSingle(),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", t.token).limit(500),
    sb.from("token_trades").select("wallet,side,amount,balance_after,pct_after,at,tx_hash,block").eq("chain", chain).eq("token", t.token)
      .gt("at", new Date(Date.now() - 7 * 86_400_000).toISOString()).order("at", { ascending: false }).limit(1000),
  ]);
  const signals = insights({ holders: (holders || []) as any, events: (events || []) as any, links: (links || []) as any, security: t.security, fullList: t.holder_source === "moralis" });
  const sigIn = { holders: (holders || []) as any, events: (events || []) as any, trades: (trades || []) as any, links: (links || []) as any, dev: t.dev, security: t.security };
  const call = tradeCall(sigIn);
  const { groups, suspects } = whoMightSell(sigIn);
  const hold = holdOutlook(sigIn, call);
  const plans = tradingPlans(call, hold, await movePromise);
  const lastEvent = new Map<string, any>();
  for (const e of events || []) if (!lastEvent.has(e.wallet)) lastEvent.set(e.wallet, e);
  const top = (holders || []).filter((h: any) => h.in_top).slice(0, 40);
  const dev = (holders || []).find((h: any) => h.is_dev);
  const devEvents = (events || []).filter((e: any) => e.is_dev && e.kind !== "buy");
  const s = (t.security || {}) as any;
  const topShare = top.filter((h: any) => !h.is_contract).reduce((a: number, h: any) => a + (Number(h.pct) || 0), 0);
  const sells24 = (events || []).filter((e: any) => e.kind !== "buy" && Date.now() - Date.parse(e.created_at) < 86_400_000).length;
  const flag = (ok: boolean | null | undefined, good: string, bad: string) => ok == null ? null : <span className={"chip-flag " + (ok ? "ok" : "bad")}>{ok ? "✓ " + good : "⚠ " + bad}</span>;

  return (
    <div className="stack" style={{ maxWidth: 1040 }}>
      <AutoRefresh seconds={60} />
      <Link href="/analytics" className="muted">← Analytics</Link>
      <div className="card stack an-head">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="label">{c.name} · Analytics</div>
            <h1>{t.symbol || short(t.token)} <span className="muted" style={{ fontSize: ".5em" }}>{t.name}</span></h1>
            <a className="mono muted" href={`${c.explorer}/token/${t.token}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: ".85em", overflowWrap: "anywhere" }}>{t.token}</a>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <WatchButton uid={user?.id ?? null} chain={chain} token={t.token} watching={!!watch?.length} count={(wc as any)?.watchers ?? 0} />
            <a className="btn small" href={`https://dexscreener.com/${c.dex}/${t.token}`} target="_blank" rel="noopener noreferrer">📈 Chart</a>
            <AnalyticsScan signedIn={!!user} chain={chain} token={t.token} label="Refresh" />
          </div>
        </div>
        <p className="muted" style={{ fontSize: ".85em" }}>👀 Watch this token to get a 🔔 alert when the dev or a top wallet sells. Balances checked {heldFor(t.checked_at) || "just now"} ago.</p>
        <div className="an-stats">
          <div><span>Top wallets hold</span><b>{pct(topShare)}</b></div>
          <div><span>Sells in 24 h</span><b>{sells24}</b></div>
          <div><span>Holders</span><b>{s.holderCount ? Intl.NumberFormat("en-US").format(s.holderCount) : "–"}</b></div>
          <div><span>Buy / sell tax</span><b>{s.buyTax == null ? "–" : `${Math.round(s.buyTax)}% / ${Math.round(s.sellTax ?? 0)}%`}</b></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {flag(s.honeypot === false ? true : s.honeypot === true ? false : null, "Not a honeypot", "Honeypot: you may not be able to sell")}
          {flag(s.openSource, "Code is public", "Code is hidden")}
          {flag(s.mintable === false ? true : s.mintable === true ? false : null, "No new tokens can be made", "Owner can make new tokens")}
          {flag(s.canTakeBack === false ? true : s.canTakeBack === true ? false : null, "Ownership can't be taken back", "Ownership can be taken back")}
          {flag(s.freezable === false ? true : s.freezable === true ? false : null, "Wallets can't be frozen", "The owner can freeze your tokens")}
        </div>
      </div>


      <div className={"card stack verdict " + call.kind}>
        <div className="label">🧭 Buy or sell? The read right now</div>
        <div className="verdict-top">
          <span className="verdict-emoji" aria-hidden>{call.emoji}</span>
          <div className="grow">
            <h2>{call.title}</h2>
            <p>{call.summary}</p>
          </div>
        </div>
        {call.kind !== "avoid" && (
          <div className="verdict-meter" aria-label={`Buy score ${call.score} out of 100`}>
            <span style={{ left: `${call.score}%` }} />
            <small>Sell</small><small>Wait</small><small>Buy</small>
          </div>
        )}
        <details open>
          <summary>Why?</summary>
          <ul className="signals">{call.reasons.map((r, i) => <li key={i} className={r.level}>{r.text}</li>)}</ul>
        </details>
        <TradePlans plans={plans} symbol={t.symbol || "this token"} />
        <p className="fin-note">⚠️ Nothing stated here is financial advice. It&apos;s worked out automatically from blockchain activity and can be wrong. Do your own research and never put in more than you can afford to lose.</p>
      </div>

      <div className="card stack">
        <h2>♟️ The battle: holders vs sellers</h2>
        <p className="muted" style={{ fontSize: ".86em" }}>Holders defend from the bottom, sellers attack from the top. The bigger the bag (or the sale), the stronger the piece. Pick a time frame and tap any piece to see its holdings.</p>
        <Arena holders={(holders || []) as any} events={(events || []) as any} trades={(trades || []) as any} links={(links || []) as any} explorer={c.explorer} token={t.token} symbol={t.symbol || "TOKEN"} />
      </div>


      <div className="card stack">
        <h2>🕸️ Connected wallets &amp; who might sell next</h2>
        <p className="muted" style={{ fontSize: ".86em" }}>Wallets that sent tokens to each other or bought at the exact same moment are often the same person. Tap a wallet to see it on the explorer.</p>
        <h3>Connected groups</h3>
        {!groups.length && <div className="empty">No connected wallets found yet. We keep checking every trade.</div>}
        <div className="conn-list">
          {groups.slice(0, 5).map((g, i) => (
            <div key={i} className={"conn-group " + g.risk.level}>
              <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <b>{g.wallets.length} wallets · hold {pct(g.pct)}{g.withDev ? " · tied to the dev" : ""}</b>
                <span className={"risk-pill " + g.risk.level}>{g.risk.level === "high" ? "Likely to sell" : g.risk.level === "medium" ? "Might sell" : "Calm"} · {g.risk.score}/100</span>
              </div>
              <div className="club-conn">
                {g.wallets.map((w) => <a key={w} className="mono" href={walletUrl(c.explorer, t.token, w)} target="_blank" rel="noopener noreferrer">{short(w)}{w === t.dev ? " (dev)" : ""}</a>)}
              </div>
              <small className="muted">Why connected: {g.how.join("; ")}.</small>
              {g.risk.reasons.length > 0 && <small>Why they might sell: {g.risk.reasons.join("; ")}.</small>}
            </div>
          ))}
        </div>
        <h3>Most likely to sell</h3>
        {!suspects.length && <div className="empty">✓ No wallet looks likely to sell right now.</div>}
        <div className="alert-list">
          {suspects.slice(0, 8).map((x) => (
            <a key={x.wallet} className="alert-row suspect" href={walletUrl(c.explorer, t.token, x.wallet)} target="_blank" rel="noopener noreferrer">
              <span className={"risk-ring " + x.risk.level} style={{ ["--r" as any]: x.risk.score }}>{x.risk.score}</span>
              <span className="grow">
                <span className="mono">{short(x.wallet)}</span>{x.isDev ? " (dev)" : ""} <span className="muted">· holds {pct(x.pct)}</span>
                <small className="muted" style={{ display: "block" }}>{x.risk.reasons.join(" · ")}</small>
              </span>
            </a>
          ))}
        </div>
        <p className="muted" style={{ fontSize: ".78em" }}>The number is the chance-to-sell score (0 to 100), worked out from past sells, holding time, links to the dev and bag size. A guide, not a promise.</p>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}><h2>⚡ Live trades</h2><span className="live-dot">LIVE · updates every minute</span></div>
        {!trades?.length && <div className="empty">{chain === "solana" ? "Live trades for Solana are coming soon. Sells by the top wallets and the dev are still caught by the balance checks every few minutes." : t.pair ? "No buys or sells in the last few hours. New ones show here within a minute." : "Looking for this token's trading pool… If it has no pool on DexScreener yet, trades can't be shown."}</div>}
        <div className="alert-list">
          {(trades || []).slice(0, 15).map((x: any) => (
            <a key={x.tx_hash + x.wallet + x.side} className={"alert-row trade " + x.side} href={`${c.explorer}/tx/${x.tx_hash}`} target="_blank" rel="noopener noreferrer">
              <span className="alert-ic">{x.side === "buy" ? "🟢" : x.wallet === t.dev ? "⚠️" : "🔴"}</span>
              <span className="grow">
                <span className="mono">{short(x.wallet)}</span>{x.wallet === t.dev ? " (dev)" : ""} {x.side === "buy" ? "bought" : "sold"} <b>{amt(x.amount)} {t.symbol}</b>
                {Number(t.total_supply) > 0 && <span className="muted"> · {((Number(x.amount) / Number(t.total_supply)) * 100).toFixed(2)}% of supply</span>}
                {x.pct_after != null && <span className="muted"> · now holds {pct(x.pct_after)}</span>}
              </span>
              <span className="muted nowrap">{heldFor(x.at)} ago</span>
            </a>
          ))}
        </div>
      </div>

      {signals.length > 0 && (
        <div className="card stack">
          <h2>💡 What buyers should know</h2>
          <ul className="signals">{signals.map((s, i) => <li key={i} className={s.level}>{s.text}</li>)}</ul>
          <p className="muted" style={{ fontSize: ".78em" }}>Worked out automatically from the blockchain. It&apos;s a guide, not financial advice.</p>
        </div>
      )}

      <div className={"card stack dev-card" + (devEvents.length ? " warn" : "")}>
        <h2>🧑‍💻 Dev wallet</h2>
        {!dev ? <p className="muted">We couldn&apos;t find who launched this token.</p> : (
          <>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <a className="mono" href={walletUrl(c.explorer, t.token, dev.wallet)} target="_blank" rel="noopener noreferrer">{short(dev.wallet)}</a>
              <span className="badge v">{t.dev_source === "launchpad" ? "Launched on AUTISTIK" : t.dev_source === "creator" ? "Created the contract" : "Contract owner"}</span>
              <span>holds <b>{pct(dev.pct)}</b> of supply ({amt(dev.balance)} {t.symbol})</span>
              {(dev.acquired_at || dev.first_seen_at) && <span className="muted">· since {heldFor(dev.acquired_at || dev.first_seen_at)} ago</span>}
            </div>
            {devEvents.length
              ? <ul className="dev-sells">{devEvents.slice(0, 5).map((e: any) => <li key={e.id}>⚠️ {e.kind === "exit" ? "Sold everything" : `Sold ${Math.round(e.pct_of_holding)}% (${amt(e.amount)} ${t.symbol})`} · {heldFor(e.created_at)} ago</li>)}</ul>
              : <p className="muted">✓ No sells by the dev since we started tracking.</p>}
          </>
        )}
      </div>

      <div className="card stack">
        <h2>Top {top.length || 40} wallets</h2>
        {t.holder_source === "goplus" && <p className="muted" style={{ fontSize: ".82em" }}>Showing the top 10 for now. The full top 40 needs the Moralis key (see GO-LIVE.md).</p>}
        <div role="table" aria-label="Top wallets" className="an-table">
          <div className="an-row head" role="row"><span>#</span><span>Wallet</span><span className="n">Supply</span><span className="n hide-sm">Holding for</span><span className="n">Status</span></div>
          {top.map((h: any) => {
            const st = status(h, lastEvent.get(h.wallet));
            return (
              <div key={h.wallet} className={"an-row" + (h.is_dev ? " is-dev" : "")} role="row">
                <span className="muted">{h.rank}</span>
                <span className="an-wallet">
                  <a className="mono" href={walletUrl(c.explorer, t.token, h.wallet)} target="_blank" rel="noopener noreferrer">{short(h.wallet)}</a>
                  {h.is_dev && <span className="badge gold">DEV</span>}
                  {h.is_contract && <span className="badge">{h.label || "Contract / pool"}</span>}
                  {!h.is_contract && h.label && <span className="badge">{h.label}</span>}
                </span>
                <span className="n">{pct(h.pct)}</span>
                <span className="n hide-sm">{heldFor(h.acquired_at || h.first_seen_at) || "–"}</span>
                <span className={"n an-st " + st.cls}>{st.text}</span>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ fontSize: ".8em" }}>&quot;Holding for&quot; counts from the wallet&apos;s first purchase when known, otherwise from when we started tracking it. Pools and contracts are shown but never raise alerts.</p>
      </div>

      <div className="card stack">
        <h2>Recent activity</h2>
        {!events?.length && <div className="empty">No moves yet. Checked every 10 minutes.</div>}
        <div className="alert-list">
          {(events || []).slice(0, 30).map((e: any) => (
            <div key={e.id} className={"alert-row" + (e.is_dev ? " dev" : "")}>
              <span className="alert-ic">{e.kind === "buy" ? "🟢" : e.is_dev ? "⚠️" : e.kind === "exit" ? "🏃" : "📉"}</span>
              <span className="grow">
                {e.is_dev ? "Dev" : "Wallet"} <span className="mono">{short(e.wallet)}</span> {e.kind === "buy" ? `bought ${amt(e.amount)}` : e.kind === "exit" ? "sold everything" : `sold ${Math.round(e.pct_of_holding)}% (${amt(e.amount)})`} {t.symbol}
                {e.kind !== "buy" && e.held_since && <span className="muted"> · after {heldFor(e.held_since, Date.parse(e.created_at))}</span>}
              </span>
              <span className="muted nowrap">{heldFor(e.created_at)} ago</span>
            </div>
          ))}
        </div>
      </div>
      <p className="muted" style={{ fontSize: ".8em" }}>Safety checks from GoPlus. Data comes straight from the blockchain. Nothing here is financial advice.</p>
    </div>
  );
}
