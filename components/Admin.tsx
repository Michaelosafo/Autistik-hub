"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { GROUPS, CHANNELS } from "@/lib/groups";

export default function Admin() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[]>([]);
  const [wallets, setWallets] = useState<Record<string, string>>({});
  const [apps, setApps] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [groups, setGroups] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<any>(null);
  const [roundName, setRoundName] = useState("");
  const [qualify, setQualify] = useState(50);
  const [confirmRound, setConfirmRound] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const [{ data: pts }, { data: w }, { data: a }, { data: r }, { data: gm }, { data: st }] = await Promise.all([
      sb.from("member_points").select("*").order("points", { ascending: false }).limit(1000),
      sb.from("wallets").select("user_id,address"),
      sb.from("practitioner_applications").select("*").order("created_at", { ascending: false }),
      sb.from("reports").select("post_id,reason,created_at,post:posts(id,channel,body,hidden,author_id,author:profiles(alias))").order("created_at", { ascending: false }).limit(200),
      sb.from("group_members").select("group_id"),
      sb.from("app_settings").select("*").eq("id", 1).single(),
    ]);
    setRows(pts || []);
    setWallets(Object.fromEntries((w || []).map((x: any) => [x.user_id, x.address])));
    setApps(a || []);
    const byPost: Record<string, any> = {};
    for (const x of r || []) { if (!x.post) continue; byPost[x.post_id] ||= { ...x.post, count: 0 }; byPost[x.post_id].count++; }
    setReports(Object.values(byPost));
    const c: Record<string, number> = {}; for (const x of gm || []) c[x.group_id] = (c[x.group_id] || 0) + 1; setGroups(c);
    setSettings(st); setRoundName(st?.round_name || ""); setQualify(st?.qualify_points ?? 50);
  }
  useEffect(() => { load(); }, []);

  async function approve(a: any) {
    await sb.from("practitioners").insert({ user_id: a.user_id, full_name: a.full_name, role: a.role });
    await sb.from("practitioner_applications").update({ status: "approved" }).eq("user_id", a.user_id);
    load();
  }
  async function reject(a: any) { await sb.from("practitioner_applications").update({ status: "rejected" }).eq("user_id", a.user_id); load(); }
  async function unverify(a: any) {
    await sb.from("practitioners").delete().eq("user_id", a.user_id);
    await sb.from("practitioner_applications").update({ status: "pending" }).eq("user_id", a.user_id); load();
  }
  async function hide(p: any, hidden: boolean) { await sb.from("posts").update({ hidden }).eq("id", p.id); load(); }
  async function clearReports(p: any) { await sb.from("reports").delete().eq("post_id", p.id); load(); }
  async function saveSettings() {
    const { error } = await sb.from("app_settings").update({ round_name: roundName, qualify_points: qualify }).eq("id", 1);
    setMsg(error ? "Couldn't save settings." : "Settings saved."); load();
  }
  async function startNewRound() {
    const next = (roundName.match(/(\d+)/) ? roundName.replace(/(\d+)/, (n) => String(Number(n) + 1)) : roundName + " (new)");
    const { error } = await sb.from("app_settings").update({ round_name: next, round_started_at: new Date().toISOString() }).eq("id", 1);
    setConfirmRound(false); setMsg(error ? "Couldn't start a new round." : `${next} started. Everyone's points are back to 0.`); load();
  }

  const need = settings?.qualify_points ?? 50;
  const eligible = rows.filter((r) => r.points >= need && wallets[r.user_id]);

  return (
    <>
      {msg && <div className="notice">{msg}</div>}
      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Airdrop list · {settings?.round_name}</h2>
          <a className="btn small primary" href="/api/admin/airdrop">Download CSV ({eligible.length})</a>
        </div>
        <p className="muted" style={{ fontSize: ".9em" }}>Members with {need}+ points and a verified wallet. Merge with your BscScan holder snapshot, set token amounts, then run <span className="mono">npm run merkle</span> (see README step 7).</p>
        <div className="scroll"><table>
          <thead><tr><th>Member</th><th>Wallet</th><th>Posts</th><th>Sessions</th><th>Support</th><th>Points</th><th>Status</th></tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={7} className="muted">No members yet.</td></tr>}
            {rows.slice(0, 300).map((r) => {
              const ok = r.points >= need && wallets[r.user_id];
              return (
                <tr key={r.user_id}>
                  <td>{r.alias}</td><td className="mono">{wallets[r.user_id] ? wallets[r.user_id].slice(0, 8) + "…" + wallets[r.user_id].slice(-4) : "—"}</td>
                  <td className="num">{r.posts}</td><td className="num">{r.sessions}</td><td className="num">{r.support}</td><td className="num">{r.points}</td>
                  <td><span className={ok ? "badge" : "badge gold"}>{ok ? "Eligible" : wallets[r.user_id] ? `Under ${need} pts` : "No wallet"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      <div className="grid2">
        <div className="card stack">
          <h2>Round settings</h2>
          <label className="field"><span>Round name</span><input type="text" value={roundName} onChange={(e) => setRoundName(e.target.value)} /></label>
          <label className="field"><span>Points needed to qualify</span><input type="text" inputMode="numeric" value={qualify} onChange={(e) => setQualify(Number(e.target.value) || 0)} /></label>
          <div className="row"><button className="btn primary small" type="button" onClick={saveSettings}>Save</button></div>
          <p className="muted" style={{ fontSize: ".88em" }}>Round started {settings ? new Date(settings.round_started_at).toLocaleString() : ""}. Download this round's CSV before starting a new one.</p>
          {confirmRound ? (
            <div className="notice warn stack" style={{ gap: 8 }}>
              <b>Start a new round? Everyone's points go back to 0.</b>
              <div className="row"><button className="btn primary small" type="button" onClick={startNewRound}>Yes, start new round</button><button className="btn small" type="button" onClick={() => setConfirmRound(false)}>Cancel</button></div>
            </div>
          ) : <div className="row"><button className="btn small" type="button" onClick={() => setConfirmRound(true)}>Start a new round</button></div>}
        </div>
        <div className="card stack">
          <h2>Group sizes</h2>
          <table><thead><tr><th>Group</th><th>Members</th></tr></thead>
            <tbody>{GROUPS.map((g) => <tr key={g.id}><td>{g.name}</td><td className="num">{groups[g.id] || 0}</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: ".88em" }}>To make someone else an admin, run the SQL at the bottom of supabase/schema.sql with their email.</p>
        </div>
      </div>

      <div className="card stack">
        <h2>Practitioner applications</h2>
        {!apps.length && <div className="empty">No applications yet.</div>}
        {apps.map((a) => (
          <div key={a.user_id} className="card stack" style={{ background: "var(--bg)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}><h3>{a.full_name} · {a.role}</h3><span className={a.status === "approved" ? "badge v" : "badge gold"}>{a.status}</span></div>
            <p className="muted">{a.country || "Country not given"}</p>
            {a.topic && <p>{a.topic}</p>}
            <a className="mono" href={a.verify_link} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: "anywhere" }}>{a.verify_link}</a>
            <div className="row">
              {a.status !== "approved" && <button className="btn primary small" type="button" onClick={() => approve(a)}>Approve &amp; verify</button>}
              {a.status === "pending" && <button className="btn small" type="button" onClick={() => reject(a)}>Reject</button>}
              {a.status === "approved" && <button className="btn small" type="button" onClick={() => unverify(a)}>Remove badge</button>}
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Reported posts</h2>
        {!reports.length && <div className="empty">No reported posts.</div>}
        {reports.map((p) => (
          <div key={p.id} className="card stack" style={{ background: "var(--bg)" }} data-g={CHANNELS[p.channel]?.group.id}>
            <div className="row"><span className="badge gold">{p.count} report{p.count > 1 ? "s" : ""}</span><span className="where">{CHANNELS[p.channel]?.group.name} › #{CHANNELS[p.channel]?.name}</span>{p.hidden && <span className="badge">Hidden</span>}</div>
            <p><b>{p.author?.alias || "Member"}:</b> {p.body}</p>
            <div className="row">
              <button className="btn small primary" type="button" onClick={() => hide(p, !p.hidden)}>{p.hidden ? "Unhide" : "Hide post"}</button>
              <button className="btn small" type="button" onClick={() => clearReports(p)}>Dismiss reports</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
