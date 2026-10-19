import Link from "next/link";
import Guide from "@/components/Guide";
import TokenLogo from "@/components/TokenLogo";
import AnalyticsScan from "@/components/AnalyticsScan";
import { ACHAINS, heldFor, isAChain } from "@/lib/analytics";
import { SCAN_CHAINS } from "@/lib/analytics-chains";
import { currentUser, supabaseServer, supabaseService } from "@/lib/supabase/server";
import { adminState } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · AUTISTIK Hub", description: "Top 40 wallets, the dev wallet and live sell alerts for any token." };

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const ago = (t: string) => heldFor(t) + " ago";

export default async function AnalyticsPage() {
  const [user, { admin }] = await Promise.all([currentUser(), adminState()]);
  const sb = supabaseServer();
  const svc = supabaseService();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  // Each member's own portal: their last 5 searches and their pins. Only the admin also sees everything.
  const [{ data: recent }, { data: pins }, { data: watchedAll }, { count: tracked }, { count: movesToday }] = await Promise.all([
    user ? sb.from("launch_watchers").select("chain,token,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5) : Promise.resolve({ data: [] as any[] }),
    user ? sb.from("token_pins").select("chain,token").eq("user_id", user.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    user ? sb.from("launch_watchers").select("token").eq("user_id", user.id).limit(300) : Promise.resolve({ data: [] as any[] }),
    svc.from("tracked_tokens").select("token", { count: "exact", head: true }),
    svc.from("holder_events").select("id", { count: "exact", head: true }).gt("created_at", dayAgo),
  ]);
  const myTokens = [...new Set([...(watchedAll || []), ...(pins || [])].map((w: any) => w.token))];
  const pinKeys = (pins || []).map((p: any) => p.token);
  const recentKeys = (recent || []).map((r: any) => r.token);
  const [{ data: info }, { data: sigs }, { data: alerts }, { count: alertsToday }, { data: allTokens }] = await Promise.all([
    [...pinKeys, ...recentKeys].length ? sb.from("tracked_tokens").select("chain,token,name,symbol,image_url,viewed_at").in("token", [...new Set([...pinKeys, ...recentKeys])]) : Promise.resolve({ data: [] as any[] }),
    pinKeys.length ? sb.from("token_signals").select("chain,token,horizon,state,changed_at").in("token", pinKeys) : Promise.resolve({ data: [] as any[] }),
    myTokens.length ? sb.from("holder_events").select("*").in("token", myTokens.slice(0, 300)).in("kind", ["sell", "exit"]).order("created_at", { ascending: false }).limit(1) : Promise.resolve({ data: [] as any[] }),
    myTokens.length ? sb.from("holder_events").select("id", { count: "exact", head: true }).in("token", myTokens.slice(0, 300)).in("kind", ["sell", "exit"]).gt("created_at", dayAgo) : Promise.resolve({ count: 0 }),
    admin ? svc.from("tracked_tokens").select("chain,token,name,symbol,viewed_at,image_url").order("viewed_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] as any[] }),
  ]);
  const tokenOf = (chain: string, token: string) => (info || []).find((t: any) => t.chain === chain && t.token === token) || ({} as any);
  const latest: any = (alerts || [])[0];
  let latestSym = "";
  if (latest) {
    const { data: t } = await sb.from("tracked_tokens").select("symbol").eq("chain", latest.chain).eq("token", latest.token).maybeSingle();
    latestSym = t?.symbol || short(latest.token);
  }
  const SIG: Record<string, string> = { buy: "🟢 Buy", take_profit: "💰 Take profit", sell: "🔴 Sell", wait: "⏳ Wait", avoid: "🚫 Avoid" };

  return (
    <div className="stack" style={{ maxWidth: 1020 }}>
      <section className="an-hero">
        <div className="an-hero-top">
          <div>
            <div className="an-kicker">AUTISTIK · ON-CHAIN ANALYTICS</div>
            <h1>Token intelligence</h1>
            <p>Top wallets, the dev, bundles, liquidity locks, buy &amp; sell zones and live trades for any token. Paste an address: the network is detected for you.</p>
          </div>
          <div className="an-live"><i />Live</div>
        </div>
        <AnalyticsScan signedIn={!!user} />
        <div className="an-metrics">
          <div><b>{SCAN_CHAINS.length}</b><span>networks</span></div>
          <div><b>{(tracked ?? 0).toLocaleString("en-US")}</b><span>tokens tracked</span></div>
          <div><b>{(movesToday ?? 0).toLocaleString("en-US")}</b><span>wallet moves today</span></div>
          <div><b>10 min</b><span>refresh</span></div>
        </div>
        <Link href="/pro" className="an-pro">💎 <b>Pro</b> · 3 timeframes, whale radar, track record &amp; analyst report →</Link>
      </section>
      <Guide id="analytics" title="Check a coin, in 3 steps" steps={[
        <>Paste a coin&apos;s address in the box above. We find its network for you.</>,
        <>See who holds it, the developer&apos;s wallet, taxes, liquidity locks and a buy or sell read in plain words.</>,
        <>Pin it to get an alert when big holders sell or it reaches a buy or sell zone.</>,
      ]} />

      {user && latest && (
        <Link href={`/analytics/${latest.chain}/${latest.token}`} className={"an-notify" + (latest.is_dev ? " dev" : "")}>
          <span className="an-bell">🔔{(alertsToday ?? 0) > 0 && <em>{alertsToday}</em>}</span>
          <span className="grow"><b>${latestSym}</b> · {latest.is_dev ? "Dev" : "Top holder"} {latest.kind === "exit" ? "sold everything" : `sold ${Math.round(latest.pct_of_holding)}%`}</span>
          <span className="muted nowrap">{ago(latest.created_at)} →</span>
        </Link>
      )}

      <div className="an-grid">
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Recent searches</h2><span className="muted" style={{ fontSize: ".8em" }}>last 5 · only you</span></div>
          {!recent?.length && <div className="empty">{user ? "Search a token above. Your last 5 show here." : "Sign in to keep your recent searches."}</div>}
          <div className="an-list">
            {(recent || []).filter((r: any) => isAChain(r.chain)).map((r: any) => {
              const t = tokenOf(r.chain, r.token);
              return (
                <Link key={r.chain + r.token} href={`/analytics/${r.chain}/${r.token}`} className="an-item">
                  <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
                  <span className="grow"><b>{t.symbol || short(r.token)}</b><small>{t.name || short(r.token)}</small></span>
                  <span className="net-tag">{ACHAINS[r.chain as keyof typeof ACHAINS].name}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>My pins</h2>{user && <Link className="btn small" href="/analytics/pins">All →</Link>}</div>
          {!pins?.length && <div className="empty">Pin a token (📌 on its page) for buy, take-profit, sell and wait alerts.</div>}
          <div className="an-list">
            {(pins || []).slice(0, 6).map((p: any) => {
              const t = tokenOf(p.chain, p.token);
              const sig = (h: string) => (sigs || []).find((x: any) => x.chain === p.chain && x.token === p.token && x.horizon === h);
              return (
                <Link key={p.chain + p.token} href={`/analytics/${p.chain}/${p.token}`} className="an-item">
                  <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
                  <span className="grow"><b>{t.symbol || short(p.token)}</b></span>
                  <span className="an-sigs">{(["short", "long"] as const).map((h) => { const x = sig(h); return <span key={h} className={"sig " + (x?.state || "")}>{h === "short" ? "⚡" : "📅"} {x ? SIG[x.state] : "…"}</span>; })}</span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>

      {admin && (
        <section className="card stack admin-only">
          <h2>All tokens on the site <span className="badge">Admin only</span></h2>
          <div className="an-list cols">
            {(allTokens || []).filter((t: any) => isAChain(t.chain)).map((t: any) => (
              <Link key={t.chain + t.token} href={`/analytics/${t.chain}/${t.token}`} className="an-item">
                <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
                <span className="grow"><b>{t.symbol || short(t.token)}</b><small>{ago(t.viewed_at)}</small></span>
                <span className="net-tag">{ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <p className="muted" style={{ fontSize: ".8em" }}>Data straight from the blockchain, refreshed every 10 minutes. Nothing here is financial advice.</p>
    </div>
  );
}
