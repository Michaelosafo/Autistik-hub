"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type App = { id: string; kind: string; status: string; note: string | null; created_at: string };

/** Apply for a badge: ✓ VERIFIED (approved members) or ✓ TEAM (people who work with AUTISTIK). The owner decides. */
export default function BadgeApply({ verified, team }: { verified?: boolean; team?: boolean }) {
  const sb = supabaseBrowser();
  const [apps, setApps] = useState<App[]>([]);
  const [kind, setKind] = useState<"verified" | "team">("verified");
  const [reason, setReason] = useState("");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await sb.from("badge_applications").select("id,kind,status,note,created_at").order("created_at", { ascending: false }).limit(5);
    setApps((data || []) as App[]);
  }
  useEffect(() => { load(); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) { setMsg("Tell us a little more (at least 10 characters)."); return; }
    setBusy(true); setMsg("");
    const { error } = await sb.from("badge_applications").insert({ kind, reason: reason.trim().slice(0, 600), link: link.trim().slice(0, 300) || null });
    setBusy(false);
    if (error) { setMsg(/duplicate|badge_one_pending/i.test(error.message) ? "You already have an application waiting." : "Couldn't send it. Try again."); return; }
    setReason(""); setLink(""); setMsg("Sent! The AUTISTIK owner will review it."); load();
  }

  const pending = apps.find((a) => a.status === "pending");
  const have = team ? "✓ TEAM" : verified ? "✓ VERIFIED" : "";
  return (
    <form className="card stack" onSubmit={send}>
      <h2>🏅 Badge</h2>
      {have && <p style={{ margin: 0 }}>You have the <b>{have}</b> badge.</p>}
      {pending ? (
        <p className="muted" style={{ margin: 0 }}>Your {pending.kind === "team" ? "team" : "verified"} badge application is waiting for review.</p>
      ) : team ? null : (
        <>
          <label className="field"><span>Which badge?</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
              <option value="verified">✓ Verified: a creator, project or known member</option>
              <option value="team">✓ Team: I work with AUTISTIK</option>
            </select>
          </label>
          <label className="field"><span>Why should you get it?</span>
            <textarea value={reason} maxLength={600} onChange={(e) => setReason(e.target.value)} placeholder="Who you are, and what you do on AUTISTIK" />
          </label>
          <label className="field"><span>A link that shows who you are (optional)</span>
            <input type="text" value={link} maxLength={300} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </label>
          <div className="row" style={{ gap: 8 }}><button className="btn primary" disabled={busy} type="submit">{busy ? "Sending…" : "Apply for badge"}</button><span className="muted">{msg}</span></div>
        </>
      )}
      {apps.filter((a) => a.status !== "pending").slice(0, 2).map((a) => (
        <p key={a.id} className="muted" style={{ margin: 0, fontSize: ".88em" }}>{a.kind === "team" ? "Team" : "Verified"} application: {a.status}{a.note ? ` · ${a.note}` : ""}</p>
      ))}
      {pending && msg && <span className="muted">{msg}</span>}
    </form>
  );
}
