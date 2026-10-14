"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function SessionForms({ signedIn, admin }: { signedIn: boolean; admin: boolean }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [app, setApp] = useState({ full_name: "", role: "", country: "", verify_link: "", topic: "" });
  const [appStatus, setAppStatus] = useState("");
  const [ns, setNs] = useState({ title: "", host: "", kind: "Talk show", date: "", time: "18:00", join_link: "", description: "" });
  const [nsStatus, setNsStatus] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: a } = await sb.from("practitioner_applications").select("status").eq("user_id", data.user.id).maybeSingle();
      if (a) setAppStatus(a.status === "approved" ? "You're a verified practitioner." : a.status === "rejected" ? "Your application wasn't approved this time." : "Application received. The team will review it.");
    });
  }, [signedIn]);

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!app.full_name.trim() || !app.role.trim() || !/^https?:\/\//.test(app.verify_link.trim())) { setAppStatus("Add your name, credential and a link (starting with https://) we can check."); return; }
    const { error } = await sb.from("practitioner_applications").insert({ ...app, verify_link: app.verify_link.trim() });
    setAppStatus(error ? "Couldn't send. You may have applied already." : "Application received. The team will review it.");
  }
  async function addSession(e: React.FormEvent) {
    e.preventDefault();
    const t = Date.parse(`${ns.date.trim()}T${ns.time.trim() || "18:00"}:00Z`);
    if (!ns.title.trim() || isNaN(t)) { setNsStatus("Add a title and a date like 2026-10-24."); return; }
    if (ns.join_link && !/^https:\/\//.test(ns.join_link)) { setNsStatus("The join link must start with https://"); return; }
    const { error } = await sb.from("sessions").insert({ title: ns.title.trim(), host: ns.host.trim() || null, kind: ns.kind, starts_at: new Date(t).toISOString(), join_link: ns.join_link.trim() || null, description: ns.description.trim() || null });
    if (error) { setNsStatus("Couldn't publish: " + error.message); return; }
    setNsStatus("Published."); setNs({ title: "", host: "", kind: "Talk show", date: "", time: "18:00", join_link: "", description: "" }); router.refresh();
  }
  const set = (k: string) => (e: any) => setApp({ ...app, [k]: e.target.value });
  const setS = (k: string) => (e: any) => setNs({ ...ns, [k]: e.target.value });

  return (
    <div className="grid2">
      <form className="card stack" onSubmit={apply}>
        <h2>Are you a practitioner?</h2>
        <p className="muted" style={{ fontSize: ".92em" }}>Psychologists, OTs, speech therapists, autism coaches and autistic advocates can apply to host. The team reviews every application by hand.</p>
        {!signedIn ? <p><Link href="/login">Sign in</Link> to apply.</p> : (
          <>
            <label className="field"><span>Full name</span><input type="text" maxLength={80} value={app.full_name} onChange={set("full_name")} /></label>
            <label className="field"><span>Role and credential</span><input type="text" maxLength={120} placeholder="e.g. Clinical psychologist, licence no." value={app.role} onChange={set("role")} /></label>
            <label className="field"><span>Country</span><input type="text" maxLength={60} value={app.country} onChange={set("country")} /></label>
            <label className="field"><span>Link to verify you</span><input type="text" maxLength={200} placeholder="https:// registry page, LinkedIn or clinic site" value={app.verify_link} onChange={set("verify_link")} /></label>
            <label className="field"><span>What would you host?</span><textarea maxLength={500} value={app.topic} onChange={set("topic")} /></label>
            <div className="row"><button className="btn primary" type="submit">Send application</button><span className="muted">{appStatus}</span></div>
          </>
        )}
      </form>
      {admin && (
        <form className="card stack" onSubmit={addSession}>
          <h2>Add a session <span className="badge gold">Admin</span></h2>
          <label className="field"><span>Title</span><input type="text" maxLength={100} value={ns.title} onChange={setS("title")} /></label>
          <label className="field"><span>Host</span><input type="text" maxLength={100} value={ns.host} onChange={setS("host")} /></label>
          <label className="field"><span>Format</span>
            <select value={ns.kind} onChange={setS("kind")}><option>Talk show</option><option>Q&amp;A</option><option>Support circle</option><option>Workshop</option></select>
          </label>
          <div className="row">
            <label className="field" style={{ flex: 1, minWidth: 140 }}><span>Date</span><input type="text" placeholder="2026-10-24" value={ns.date} onChange={setS("date")} /></label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}><span>Time (UTC)</span><input type="text" placeholder="18:00" value={ns.time} onChange={setS("time")} /></label>
          </div>
          <label className="field"><span>Join link</span><input type="text" placeholder="https:// X Space, YouTube Live, Google Meet…" value={ns.join_link} onChange={setS("join_link")} /></label>
          <label className="field"><span>Description</span><textarea maxLength={600} value={ns.description} onChange={setS("description")} /></label>
          <div className="row"><button className="btn primary" type="submit">Publish session</button><span className="muted">{nsStatus}</span></div>
        </form>
      )}
    </div>
  );
}
