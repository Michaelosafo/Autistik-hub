import Link from "next/link";
import AnalyticsScan from "@/components/AnalyticsScan";
import { ACHAINS, heldFor, isAChain } from "@/lib/analytics";
import { SCAN_CHAINS } from "@/lib/analytics-chains";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analytics · AUTISTIK Hub", description: "Top 40 wallets, the dev wallet and live sell alerts for any token." };

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const ago = (t: string) => heldFor(t) + " ago";

export default async function AnalyticsPage() {
  const user = await currentUser();
  const sb = supabaseServer();
  const [{ data: events }, { data: tokens }] = await Promise.all([
    sb.from("holder_events").select("*").in("kind", ["sell", "exit"]).order("created_at", { ascending: false }).limit(30),
    sb.from("tracked_tokens").select("chain,token,name,symbol,dev,holder_source,viewed_at").order("viewed_at", { ascending: false }).limit(30),
  ]);
  // My pinned tokens and their latest signals.
  const { data: pins } = user ? await sb.from("token_pins").select("chain,token").eq("user_id", user.id).order("created_at", { ascending: false }) : { data: [] as any[] };
  const pinKeys = (pins || []).map((p: any) => p.token);
  const [{ data: pinTokens }, { data: sigs }] = pinKeys.length
    ? await Promise.all([sb.from("tracked_tokens").select("chain,token,name,symbol").in("token", pinKeys), sb.from("token_signals").select("chain,token,horizon,state,changed_at").in("token", pinKeys)])
    : [{ data: [] as any[] }, { data: [] as any[] }];
  const SIG: Record<string, string> = { buy: "🟢 Buy", take_profit: "💰 Take profit", sell: "🔴 Sell", wait: "⏳ Wait", avoid: "🚫 Avoid" };
  const names = new Map((tokens || []).map((t: any) => [`${t.chain}:${t.token}`, t]));
  const missing = [...new Set((events || []).map((e: any) => e.token).filter((tk: string) => ![...names.keys()].some((k) => k.endsWith(tk))))];
  if (missing.length) {
    const { data } = await sb.from("tracked_tokens").select("chain,token,name,symbol").in("token", missing);
    for (const t of data || []) names.set(`${t.chain}:${t.token}`, t);
  }

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <h1>Analytics</h1>
        <p className="muted">See any token&apos;s top 40 wallets and the dev, how long they&apos;ve held, and get an alert when they sell.</p>
      </div>
      <div className="card stack">
        <AnalyticsScan signedIn={!!user} />
        <div className="chain-chips" aria-label="Chains you can scan">{SCAN_CHAINS.map((c) => <span key={c.key} className="badge v">{c.name}</span>)}</div>
        <p className="muted" style={{ fontSize: ".82em" }}>Tokens launched on AUTISTIK are tracked automatically. Scanning a token also turns on its sell alerts for you (🔔 at the top).</p>
      </div>

      {user && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>📌 My pins</h2><Link className="btn small" href="/analytics/pins">Open My pins →</Link></div>
          {!pins?.length && <div className="empty">Pin a token (📌 on its page) to get an alert when it&apos;s time to buy, take profit, sell or wait.</div>}
          <div className="pins-list">
            {(pins || []).map((p: any) => {
              const t: any = (pinTokens || []).find((x: any) => x.chain === p.chain && x.token === p.token) || {};
              const sig = (h: string) => (sigs || []).find((x: any) => x.chain === p.chain && x.token === p.token && x.horizon === h);
              return (
                <Link key={p.chain + p.token} href={`/analytics/${p.chain}/${p.token}`} className="pin-row">
                  <b>{t.symbol || short(p.token)}</b>
                  {(["short", "long"] as const).map((h) => {
                    const x = sig(h);
                    return <span key={h} className={"sig " + (x?.state || "")}>{h === "short" ? "⚡" : "📅"} {x ? SIG[x.state] : "Checking…"}</span>;
                  })}
                </Link>
              );
            })}
          </div>
          {!!pins?.length && <p className="muted" style={{ fontSize: ".8em" }}>⚡ day trade · 📅 long term. Checked every 10 minutes. A guide, not financial advice.</p>}
        </div>
      )}

      <div className="card stack">
        <h2>🚨 Live sell alerts</h2>
        {!events?.length && <div className="empty">No sells spotted yet. They show here as soon as a tracked wallet sells.</div>}
        <div className="alert-list">
          {(events || []).map((e: any) => {
            const t: any = names.get(`${e.chain}:${e.token}`) || {};
            return (
              <Link key={e.id} href={`/analytics/${e.chain}/${e.token}`} className={"alert-row" + (e.is_dev ? " dev" : "")}>
                <span className="alert-ic">{e.is_dev ? "⚠️" : e.kind === "exit" ? "🏃" : "📉"}</span>
                <span className="grow">
                  <b>{t.symbol || short(e.token)}</b> · {e.is_dev ? "Dev" : "Holder"} <span className="mono">{short(e.wallet)}</span> {e.kind === "exit" ? "sold everything" : `sold ${Math.round(e.pct_of_holding)}%`}
                  {e.held_since && <span className="muted"> · held {heldFor(e.held_since, Date.parse(e.created_at))}</span>}
                </span>
                <span className="muted nowrap">{ago(e.created_at)}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="card stack">
        <h2>Tracked tokens</h2>
        {!tokens?.length && <div className="empty">Nothing tracked yet. Scan a token above to start.</div>}
        <div className="tracked-grid">
          {(tokens || []).filter((t: any) => isAChain(t.chain)).map((t: any) => (
            <Link key={t.chain + t.token} href={`/analytics/${t.chain}/${t.token}`} className="tracked">
              <b>{t.symbol || short(t.token)}</b>
              <span className="muted">{t.name || ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
              <span className="badge v">{ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
            </Link>
          ))}
        </div>
      </div>
      <p className="muted" style={{ fontSize: ".8em" }}>&quot;Sold&quot; means the wallet&apos;s balance went down: it sold or moved the tokens to another wallet. Data comes straight from the blockchain and is checked every 10 minutes. Nothing here is financial advice.</p>
    </div>
  );
}
