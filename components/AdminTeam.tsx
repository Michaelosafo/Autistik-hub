"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import MemberName from "@/components/members/MemberName";

type P = { id: string; alias: string; color: string; is_team?: boolean; team_title?: string | null };

/** Admin: choose who is on the team. Team accounts get the gold ✓ TEAM badge everywhere their name shows. */
export default function AdminTeam() {
  const sb = supabaseBrowser();
  const [team, setTeam] = useState<P[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<P[]>([]);
  const [title, setTitle] = useState("Team");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(true);

  async function load() {
    const { data, error } = await sb.from("profiles").select("id,alias,color,is_team,team_title").eq("is_team", true).order("alias");
    if (error) { setReady(false); return; }
    setTeam((data || []) as P[]);
  }
  useEffect(() => { load(); }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const s = q.replace(/[%_,()\\]/g, " ").trim();
    if (!s) return;
    const { data } = await sb.from("profiles").select("id,alias,color,is_team,team_title").ilike("alias", `%${s}%`).limit(10);
    setFound((data || []) as P[]);
  }
  async function set(p: P, on: boolean) {
    setMsg("");
    const { error } = await sb.rpc("set_team", { p_id: p.id, p_on: on, p_title: on ? title.trim() || "Team" : null, p_alias: on ? name.trim() || null : null });
    if (error) { setMsg(error.message); return; }
    setMsg(on ? `${name.trim() || p.alias} is now on the team.` : `${p.alias} is no longer on the team.`);
    setName(""); setFound([]); setQ(""); load();
  }

  if (!ready) return <div className="card stack"><h2>Team accounts</h2><p className="muted">Run <span className="mono">supabase/members-live.sql</span> in Supabase to turn this on.</p></div>;
  return (
    <div className="card stack" id="team">
      <h2>Team accounts</h2>
      <p className="muted" style={{ fontSize: ".9em" }}>Team names show a gold <span className="team-badge">✓ TEAM</span> badge, and only team accounts can use words like AUTISTIK, Team, Dev or Founder in their name, so nobody can pretend to be you.</p>
      {!team.length && <div className="empty">No team accounts yet. Search a member below to add them.</div>}
      {team.map((p) => (
        <div key={p.id} className="member-row">
          <span className="stack" style={{ gap: 0 }}><MemberName m={p} avatar /><span className="muted" style={{ fontSize: ".8em" }}>{p.team_title}</span></span>
          <button className="btn small" type="button" onClick={() => set(p, false)}>Remove from team</button>
        </div>
      ))}
      <form className="row" onSubmit={search} style={{ gap: 8 }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a member by name" aria-label="Find a member" style={{ flex: 1, minWidth: 0 }} />
        <button className="btn small" type="submit">Search</button>
      </form>
      {!!found.length && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Title</span><input type="text" maxLength={30} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Founder, Host, Dev…" /></label>
            <label className="field" style={{ flex: 2, minWidth: 180 }}><span>Team name (optional)</span><input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AUTISTIK Mike" /></label>
          </div>
          {found.map((p) => (
            <div key={p.id} className="member-row">
              <MemberName m={p} avatar />
              {p.is_team ? <span className="muted">On the team</span> : <button className="btn small primary" type="button" onClick={() => set(p, true)}>Make team</button>}
            </div>
          ))}
        </div>
      )}
      {msg && <span className="muted" role="status">{msg}</span>}
    </div>
  );
}
