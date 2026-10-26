import Link from "next/link";
import TokenLogo from "@/components/TokenLogo";
import AnalyticsScan from "@/components/AnalyticsScan";
import PinButton from "@/components/PinButton";
import PushButton from "@/components/PushButton";
import { ACHAINS, isAChain } from "@/lib/analytics";
import { usd } from "@/lib/analytics-zones";
import { currentUser, supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "My pins · AUTISTIK Hub" };

const SIG: Record<string, string> = { buy: "Buy", take_profit: "Take profit", sell: "Sell", wait: "Wait", avoid: "Avoid" };
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

export default async function PinsPage() {
  const user = await currentUser();
  if (!user) return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <Link href="/analytics" className="muted">← Stats</Link>
      <div className="card stack"><h1>My pins</h1><p className="muted">Sign in to pin tokens and get an alert when they enter the buy range or reach the sell range.</p>
        <Link className="btn primary" href="/login?next=/analytics/pins">Sign in</Link></div>
    </div>
  );
  const sb = supabaseServer();
  const { data: pins } = await sb.from("token_pins").select("chain,token,created_at").eq("user_id", user.id).order("created_at", { ascending: false });
  const keys = (pins || []).map((p: any) => p.token);
  const [{ data: toks }, { data: sigs }] = keys.length
    ? await Promise.all([sb.from("tracked_tokens").select("chain,token,name,symbol,image_url").in("token", keys), sb.from("token_signals").select("chain,token,horizon,state,detail,changed_at").in("token", keys)])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <Link href="/analytics" className="muted">← Stats</Link>
      <div className="page-head">
        <h1>My pins</h1>
        <p className="muted">Pin a token and we&apos;ll tell you when it enters the buy range or reaches the sell range, using what buyers are feeling, the chart and the project itself. Checked every 10 minutes.</p>
      </div>
      <div className="card stack">
        <b>Pin a token</b>
        <AnalyticsScan signedIn label="Pin" pin />
        <PushButton />
        <Link href="/pro" className="pro-strip">Free members can pin 3 tokens. <b>AUTISTIK Pro</b> lets you pin 30 and adds whale and rug alerts →</Link>
      </div>

      {!pins?.length && <div className="empty">No pins yet. Paste a token address above, or press on any token&apos;s page.</div>}
      <div className="stack" style={{ gap: 10 }}>
        {(pins || []).filter((p: any) => isAChain(p.chain)).map((p: any) => {
          const t: any = (toks || []).find((x: any) => x.chain === p.chain && x.token === p.token) || {};
          const sig = (h: string) => (sigs || []).find((x: any) => x.chain === p.chain && x.token === p.token && x.horizon === h);
          const z: any = sig("zone")?.detail;
          return (
            <div key={p.chain + p.token} className="pin-card">
              <Link href={`/analytics/${p.chain}/${p.token}`} style={{ textDecoration: "none", color: "inherit", display: "flex", gap: 8, alignItems: "center" }}>
                <TokenLogo src={t.image_url} symbol={t.symbol || "?"} />
                <span><b>{t.symbol || short(p.token)}</b>
                <small>{ACHAINS[p.chain as keyof typeof ACHAINS].name}</small></span>
              </Link>
              <Link href={`/analytics/${p.chain}/${p.token}`} style={{ textDecoration: "none", color: "inherit" }}>
                {z ? (
                  <>
                    <span className="pz">{z.title}</span> <span className="muted">· now {usd(z.price)}</span>
                    <small>
                      {z.buy && <>buy {usd(z.buy[0])}–{usd(z.buy[1])} · </>}
                      {z.sell && <>sell {usd(z.sell[0])}–{usd(z.sell[1])} · </>}
                      {z.strength?.label} ({z.strength?.agree}/{z.strength?.total} signs)
                    </small>
                    <small>Day trade: {SIG[sig("short")?.state] || "…"} · Long term: {SIG[sig("long")?.state] || "…"}</small>
                  </>
                ) : <span className="muted">Working out the zones… check back in a few minutes.</span>}
              </Link>
              <PinButton signedIn chain={p.chain} token={p.token} pinned />
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: ".8em" }}>Not financial advice. Zones show what people usually do at these prices, not what will happen.</p>
    </div>
  );
}
