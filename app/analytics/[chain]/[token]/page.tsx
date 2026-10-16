import Link from "next/link";
import { notFound } from "next/navigation";
import AnalyticsScan from "@/components/AnalyticsScan";
import WatchButton from "@/components/WatchButton";
import Arena from "@/components/Arena";
import { insights } from "@/lib/analytics-insights";
import { ACHAINS, checkToken, heldFor, isAChain } from "@/lib/analytics";
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
  if (!isAChain(params.chain) || !/^0x[0-9a-fA-F]{40}$/.test(params.token)) notFound();
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
    if (!t.checked_at || Date.now() - Date.parse(t.checked_at) > 3 * 60_000) {
      await Promise.race([checkToken(chain, t.token).catch(() => []), new Promise((r) => setTimeout(r, 6000))]);
      ({ data: t } = await sb.from("tracked_tokens").select("*").eq("chain", chain).eq("token", params.token).maybeSingle());
    }
  }

  const [{ data: holders }, { data: events }, { data: watch }, { data: wc }, { data: links }] = await Promise.all([
    sb.from("token_holders").select("*").eq("chain", chain).eq("token", t.token).order("rank", { ascending: true, nullsFirst: false }),
    sb.from("holder_events").select("*").eq("chain", chain).eq("token", t.token).order("created_at", { ascending: false }).limit(500),
    user ? sb.from("launch_watchers").select("token").eq("user_id", user.id).eq("chain", chain).eq("token", t.token) : Promise.resolve({ data: [] as any[] }),
    sb.from("launch_watch_counts").select("watchers").eq("chain", chain).eq("token", t.token).maybeSingle(),
    sb.from("token_links").select("a,b,kind").eq("chain", chain).eq("token", t.token).limit(500),
  ]);
  const signals = insights({ holders: (holders || []) as any, events: (events || []) as any, links: (links || []) as any, security: t.security, fullList: t.holder_source === "moralis" });
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
        </div>
      </div>

      <div className="card stack">
        <h2>♟️ The battle: buyers vs sellers</h2>
        <p className="muted" style={{ fontSize: ".86em" }}>A chess game between the top wallets that bought and the ones that sold. The bigger the move, the stronger the piece. Pick a time frame, and tap any piece to see how long they&apos;ve held and how likely they are to sell.</p>
        <Arena holders={(holders || []) as any} events={(events || []) as any} links={(links || []) as any} explorer={c.explorer} token={t.token} symbol={t.symbol || "TOKEN"} />
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
              <a className="mono" href={`${c.explorer}/token/${t.token}?a=${dev.wallet}`} target="_blank" rel="noopener noreferrer">{short(dev.wallet)}</a>
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
                  <a className="mono" href={`${c.explorer}/token/${t.token}?a=${h.wallet}`} target="_blank" rel="noopener noreferrer">{short(h.wallet)}</a>
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
