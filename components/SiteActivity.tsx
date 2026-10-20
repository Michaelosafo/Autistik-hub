import { supabaseService } from "@/lib/supabase/server";

const ICON: Record<string, string> = { search: "🔎", pin: "📌", unpin: "📍", pro: "💎", report: "🤖", alerts: "📲", launch: "🚀" };
const ago = (t: string) => {
  const m = (Date.now() - Date.parse(t)) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Admin only: how the site is being visited and what members are doing. */
export default async function SiteActivity() {
  const sb = supabaseService();
  // Counted in the database (supabase/analytics.sql: site_stats), so the numbers stay right however busy the site gets.
  const [{ data: st, error }, { data: acts }, { count: members }, { count: proActive }, { count: pins }] = await Promise.all([
    sb.rpc("site_stats"),
    sb.from("activity_log").select("at,user_id,kind,label,link").order("at", { ascending: false }).limit(60),
    sb.from("profiles").select("id", { count: "exact", head: true }),
    sb.from("pro_passes").select("id", { count: "exact", head: true }).gt("ends_at", new Date().toISOString()),
    sb.from("token_pins").select("user_id", { count: "exact", head: true }),
  ]);
  if (error) return <div className="card"><h2>📈 Site activity</h2><p className="muted">Visit tracking isn&apos;t set up yet (supabase/analytics.sql).</p></div>;
  const x: any = st || {};
  const days: { d: string; views: number; people: number }[] = x.daily || [];
  const peak = Math.max(1, ...days.map((d) => d.views));
  const total = x.week_views || 1;
  const { data: names } = await sb.from("profiles").select("id,alias").in("id", [...new Set((acts || []).map((a) => a.user_id).filter(Boolean))].slice(0, 100));
  const alias = (id: string | null) => (id && (names || []).find((n: any) => n.id === id)?.alias) || "Someone";

  return (
    <div className="card stack site-activity">
      <h2>📈 Site activity <span className="badge">Admin only</span></h2>
      <div className="an-stats">
        <div><span>Visits today</span><b>{x.today_views ?? 0}</b></div>
        <div><span>Real people today</span><b>{x.today_people ?? 0}</b></div>
        <div><span>Real people this week</span><b>{x.week_people ?? 0}</b></div>
        <div><span>Signed-in this week</span><b>{x.week_signed ?? 0}</b></div>
      </div>
      <div className="an-stats">
        <div><span>Members</span><b>{members ?? "–"}</b></div>
        <div><span>Pro members now</span><b>{proActive ?? 0}</b></div>
        <div><span>Pinned tokens</span><b>{pins ?? 0}</b></div>
        <div><span>Visits this week</span><b>{x.week_views ?? 0}</b></div>
      </div>

      <small className="muted">Real people = different internet connections (IP addresses), so the same person on several browsers or tabs counts once. Bots aren&apos;t counted. People sharing one Wi-Fi count as one. Browsers this week: {x.week_browsers ?? "–"}.</small>

      <b>Visits, last 14 days</b>
      <div className="vbars" aria-label="Visits per day">
        {days.map((d) => (
          <div key={d.d} className="vbar" title={`${d.d}: ${d.views} visits, ${d.people} real people`}>
            <span style={{ height: `${(d.views / peak) * 100}%` }} />
            <small>{d.d.slice(8)}</small>
          </div>
        ))}
      </div>

      <div className="sa-grid">
        <section><b>Top pages (7 days)</b><ol className="sa-list">{(x.pages || []).map(([k, c]: [string, number]) => <li key={k}><span className="mono">{k}</span><b>{c}</b></li>)}</ol></section>
        <section><b>Countries (7 days, people)</b><ol className="sa-list">{(x.countries || []).map(([k, c]: [string, number]) => <li key={k}><span>{k}</span><b>{c}</b></li>)}</ol></section>
        <section><b>Devices (7 days)</b><ol className="sa-list">{(x.devices || []).map(([k, c]: [string, number]) => <li key={k}><span>{k === "phone" ? "📱 Phone" : k === "tablet" ? "📲 Tablet" : "💻 Computer"}</span><b>{Math.round((c / Math.max(1, x.week_people || total)) * 100)}%</b></li>)}</ol>
          <b style={{ display: "block", marginTop: 10 }}>Came from (7 days)</b>
          <ol className="sa-list">{(x.referrers || []).map(([k, c]: [string, number]) => <li key={k}><span>{k}</span><b>{c}</b></li>)}</ol>
        </section>
      </div>

      <b>What members are doing</b>
      {!acts?.length && <div className="empty">Nothing yet. Searches, pins, Pro payments, reports and launches show here.</div>}
      <div className="alert-list">
        {(acts || []).map((a, i) => {
          const row = <><span className="alert-ic">{ICON[a.kind] || "•"}</span><span className="grow"><b>{alias(a.user_id)}</b> · {a.label || a.kind}</span><span className="muted nowrap">{ago(a.at)}</span></>;
          return a.link ? <a key={i} href={a.link} className="alert-row">{row}</a> : <div key={i} className="alert-row">{row}</div>;
        })}
      </div>
    </div>
  );
}
