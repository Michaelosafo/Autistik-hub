import Link from "next/link";
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
  // Everyone gets their own portal: the tokens they searched (scanning watches a token) or pinned.
  // Only the admin also sees everything across the site.
  const [{ data: watched }, { data: myPins }] = user
    ? await Promise.all([sb.from("launch_watchers").select("chain,token").eq("user_id", user.id).limit(300), sb.from("token_pins").select("chain,token").eq("user_id", user.id)])
    : [{ data: [] as any[] }, { data: [] as any[] }];
  const mineKeys = [...new Set([...(myPins || []), ...(watched || [])].map((w: any) => `${w.chain}:${w.token}`))];
  const mineTokens = [...new Set(mineKeys.map((k) => k.split(":")[1]))];
  const svc = supabaseService();
  const [{ data: myTokens }, { data: myEvents }, { data: allTokens }, { data: allEvents }] = await Promise.all([
    mineTokens.length ? sb.from("tracked_tokens").select("chain,token,name,symbol,viewed_at,image_url").in("token", mineTokens.slice(0, 300)) : Promise.resolve({ data: [] as any[] }),
    mineTokens.length ? sb.from("holder_events").select("*").in("token", mineTokens.slice(0, 300)).in("kind", ["sell", "exit"]).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] as any[] }),
    admin ? svc.from("tracked_tokens").select("chain,token,name,symbol,viewed_at,added_by,image_url").order("viewed_at", { ascending: false }).limit(60) : Promise.resolve({ data: [] as any[] }),
    admin ? svc.from("holder_events").select("*").in("kind", ["sell", "exit"]).order("created_at", { ascending: false }).limit(30) : Promise.resolve({ data: [] as any[] }),
  ]);
  const tokens = (myTokens || []).filter((t: any) => mineKeys.includes(`${t.chain}:${t.token}`)).sort((a: any, b: any) => Date.parse(b.viewed_at) - Date.parse(a.viewed_at));
  const events = (myEvents || []).filter((e: any) => mineKeys.includes(`${e.chain}:${e.token}`));
  // My pinned tokens and their latest signals.
  const { data: pins } = user ? await sb.from("token_pins").select("chain,token").eq("user_id", user.id).order("created_at", { ascending: false }) : { data: [] as any[] };
  const pinKeys = (pins || []).map((p: any) => p.token);
  const [{ data: pinTokens }, { data: sigs }] = pinKeys.length
    ? await Promise.all([sb.from("tracked_tokens").select("chain,token,name,symbol,image_url").in("token", pinKeys), sb.from("token_signals").select("chain,token,horizon,state,changed_at").in("token", pinKeys)])
    : [{ data: [] as any[] }, { data: [] as any[] }];
  const SIG: Record<string, string> = { buy: "🟢 Buy", take_profit: "💰 Take profit", sell: "🔴 Sell", wait: "⏳ Wait", avoid: "🚫 Avoid" };
  const names = new Map([...(allTokens || []), ...tokens].map((t: any) => [`${t.chain}:${t.token}`, t]));
  const missing = [...new Set([...events, ...(allEvents || [])].map((e: any) => e.token).filter((tk: string) => ![...names.keys()].some((k) => k.endsWith(tk))))];
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
        <Link href="/pro" className="pro-strip">💎 <b>AUTISTIK Pro</b>: 3 timeframes, whale radar, track record and an analyst report. Paid in $AUTISTIK →</Link>
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
                  <TokenLogo src={t.image_url} symbol={t.symbol || "?"} /><b>{t.symbol || short(p.token)}</b>
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
        <h2>🚨 Sell alerts on my tokens</h2>
        {!events.length && <div className="empty">{user ? "No sells on your tokens yet. They show here as soon as a top wallet or the dev sells." : "Sign in and search a token to see its sell alerts here."}</div>}
        <div className="alert-list">
          {events.map((e: any) => {
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
        <h2>🗂️ My tokens</h2>
        <p className="muted" style={{ fontSize: ".84em" }}>Only you see this list: every token you searched or pinned.</p>
        {!tokens.length && <div className="empty">{user ? "Nothing here yet. Search a token above and it'll be saved to your list." : "Sign in to keep your own list of tokens."}</div>}
        <div className="tracked-grid">
          {tokens.filter((t: any) => isAChain(t.chain)).map((t: any) => (
            <Link key={t.chain + t.token} href={`/analytics/${t.chain}/${t.token}`} className="tracked">
              <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><TokenLogo src={t.image_url} symbol={t.symbol || "?"} /><b>{t.symbol || short(t.token)}</b></span>
              <span className="muted">{t.name || ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
              <span className="badge v">{ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
            </Link>
          ))}
        </div>
      </div>

      {admin && (
        <div className="card stack admin-only">
          <h2>🛡️ All tokens on the site <span className="badge">Admin only</span></h2>
          <p className="muted" style={{ fontSize: ".84em" }}>Everything members have searched, newest first. More in Admin → Site activity.</p>
          <div className="tracked-grid">
            {(allTokens || []).filter((t: any) => isAChain(t.chain)).map((t: any) => (
              <Link key={t.chain + t.token} href={`/analytics/${t.chain}/${t.token}`} className="tracked">
                <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><TokenLogo src={t.image_url} symbol={t.symbol || "?"} /><b>{t.symbol || short(t.token)}</b></span>
                <span className="muted">{ago(t.viewed_at)}</span>
                <span className="badge v">{ACHAINS[t.chain as keyof typeof ACHAINS].name}</span>
              </Link>
            ))}
          </div>
          {!!allEvents?.length && <>
            <b>All sell alerts</b>
            <div className="alert-list">
              {(allEvents || []).slice(0, 15).map((e: any) => {
                const t: any = names.get(`${e.chain}:${e.token}`) || {};
                return (
                  <Link key={e.id} href={`/analytics/${e.chain}/${e.token}`} className="alert-row">
                    <span className="alert-ic">{e.is_dev ? "⚠️" : "📉"}</span>
                    <span className="grow"><b>{t.symbol || short(e.token)}</b> · <span className="mono">{short(e.wallet)}</span> {e.kind === "exit" ? "sold everything" : `sold ${Math.round(e.pct_of_holding)}%`}</span>
                    <span className="muted nowrap">{ago(e.created_at)}</span>
                  </Link>
                );
              })}
            </div>
          </>}
        </div>
      )}
      <p className="muted" style={{ fontSize: ".8em" }}>&quot;Sold&quot; means the wallet&apos;s balance went down: it sold or moved the tokens to another wallet. Data comes straight from the blockchain and is checked every 10 minutes. Nothing here is financial advice.</p>
    </div>
  );
}
