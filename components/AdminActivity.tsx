import { adminActivity, type AdminActivity as Data } from "@/lib/admin-activity";
import AdminFeed from "@/components/AdminFeed";

const ago = (t: number) => {
  const m = (Date.now() - t) / 60000;
  return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

/** Admin only: everything happening on the site in one place. adminActivity() checks for the owner itself. */
export default async function AdminActivity() {
  return <AdminActivityView d={await adminActivity()} />;
}

export function AdminActivityView({ d }: { d: Data }) {
  const down = d.health.filter((h) => h.ok === false).length;
  return (
    <div className="card stack adm-act" id="activity">
      <h2>🛰 Everything happening <span className="badge">Admin only</span></h2>
      <div className="adm-tiles">
        {d.tiles.map((t) => <div key={t.label}><span>{t.label}</span><b>{t.value}</b>{t.sub && <small>{t.sub}</small>}</div>)}
      </div>

      <section className="stack" aria-labelledby="adm-health">
        <div className="adm-h"><b id="adm-health">Scanner and scheduled jobs</b><span className={"chip-flag " + (down ? "bad" : "ok")}>{down ? `${down} need${down > 1 ? "" : "s"} a look` : "All running"}</span></div>
        <ul className="adm-health">
          {d.health.map((h) => (
            <li key={h.name}>
              <i className={h.ok === true ? "ok" : h.ok === false ? "bad" : "na"} aria-label={h.ok === true ? "Working" : h.ok === false ? "Problem" : "Unknown"} />
              <span><b>{h.name}</b><small>{h.what}</small></span>
              <small className="adm-note">{h.note}</small>
            </li>
          ))}
        </ul>
      </section>

      <AdminFeed rows={d.feed.map((r) => ({ ...r, ago: ago(r.at) }))} />

      {d.launches.length > 0 && (
        <section className="stack">
          <b>Newest launches</b>
          <div className="alert-list">
            {d.launches.map((l) => (
              <a key={l.href} href={l.href} className="alert-row"><span className="alert-ic">🚀</span><span className="grow"><b>${l.symbol}</b> · {l.name} <small className="muted">· {l.chain} · {l.source} · {l.lp}</small></span><span className="muted nowrap">{ago(l.at)}</span></a>
            ))}
          </div>
        </section>
      )}
      {d.notes.map((n) => <small key={n} className="muted">ℹ️ {n}</small>)}
    </div>
  );
}
