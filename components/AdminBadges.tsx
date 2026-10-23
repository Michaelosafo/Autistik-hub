"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type A = { id: string; user_id: string; kind: string; reason: string; link: string | null; created_at: string; profile?: { alias: string; handle: string | null } | null };

/** Admin: review badge applications. Approve gives the badge; team badges take a title like "Host". */
export default function AdminBadges() {
  const sb = supabaseBrowser();
  const [list, setList] = useState<A[]>([]);
  const [title, setTitle] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function load() {
    const { data, error } = await sb.from("badge_applications").select("id,user_id,kind,reason,link,created_at").eq("status", "pending").order("created_at").limit(50);
    if (error) return;
    const rows = (data || []) as A[];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const { data: ps } = ids.length ? await sb.from("profiles").select("id,alias,handle").in("id", ids) : { data: [] as any[] };
    const m = new Map((ps || []).map((p: any) => [p.id, p]));
    setList(rows.map((r) => ({ ...r, profile: m.get(r.user_id) || null })));
  }
  useEffect(() => { load(); }, []);

  async function decide(a: A, ok: boolean) {
    setMsg("");
    const { error } = await sb.rpc("review_badge", { p_id: a.id, p_approve: ok, p_title: a.kind === "team" ? title[a.id] || "Team" : null, p_note: null });
    setMsg(error ? error.message : ok ? "Badge given." : "Declined.");
    load();
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <b>🏅 Badge applications ({list.length})</b>
      {!list.length && <p className="muted" style={{ margin: 0 }}>Nothing waiting.</p>}
      {list.map((a) => (
        <div key={a.id} className="stack" style={{ gap: 4, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <div><b>{a.profile?.alias || "Member"}</b> {a.profile?.handle && <span className="muted">@{a.profile.handle}</span>} · wants <b>{a.kind === "team" ? "✓ TEAM" : "✓ VERIFIED"}</b></div>
          <p style={{ margin: 0, overflowWrap: "anywhere" }}>{a.reason}</p>
          {a.link && <a href={a.link.startsWith("http") ? a.link : `https://${a.link}`} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: "anywhere" }}>{a.link}</a>}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {a.kind === "team" && <input type="text" placeholder="Title, e.g. Host" value={title[a.id] || ""} maxLength={30} onChange={(e) => setTitle({ ...title, [a.id]: e.target.value })} style={{ maxWidth: 200 }} />}
            <button className="btn primary small" onClick={() => decide(a, true)}>Approve</button>
            <button className="btn small" onClick={() => decide(a, false)}>Decline</button>
          </div>
        </div>
      ))}
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
