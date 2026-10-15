"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

const WHAT: Record<string, string> = {
  posts: "post", reports: "reports", sessions: "session", app_settings: "round settings",
  practitioners: "practitioner", practitioner_applications: "practitioner application", fund_interest: "Fund entry",
};

function describe(e: any): string {
  const thing = WHAT[e.target_table] || e.target_table;
  if (e.target_table === "posts" && e.action === "update") return e.details?.hidden ? "hid a post" : "unhid a post";
  if (e.target_table === "reports") return "dismissed a report";
  if (e.target_table === "practitioner_applications") return `marked a practitioner application ${e.details?.status || "updated"}`;
  if (e.target_table === "sessions") return `${e.action === "insert" ? "added" : e.action === "update" ? "edited" : "removed"} the session "${e.details?.title || ""}"`;
  if (e.target_table === "practitioners") return e.action === "insert" ? `verified ${e.details?.full_name || "a practitioner"}` : `unverified ${e.details?.full_name || "a practitioner"}`;
  return `${e.action === "insert" ? "added" : e.action === "update" ? "changed" : "deleted"} ${thing}`;
}

/** Every admin action, newest first. Written by the database itself, so it can't be edited or deleted from the site. */
export default function AdminLog() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<any[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    sb.from("admin_log").select("id,action,target_table,details,created_at,admin:profiles(alias)").order("created_at", { ascending: false }).limit(100)
      .then(({ data, error }) => { if (error) setMissing(true); setRows(data || []); });
  }, []);
  return (
    <div className="card stack">
      <h2>Admin log</h2>
      <p className="muted" style={{ fontSize: ".88em" }}>Every action an admin takes, newest first. Nobody can edit or delete these entries from the site.</p>
      {missing && <div className="notice warn" style={{ fontSize: ".9em" }}>The admin log isn&apos;t set up yet. Run <code>supabase/security.sql</code> in Supabase → SQL Editor.</div>}
      {rows && !rows.length && !missing && <div className="empty">No admin actions yet.</div>}
      {rows && rows.length > 0 && (
        <table><tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="muted" style={{ whiteSpace: "nowrap", fontSize: ".85em" }}>{new Date(e.created_at).toLocaleString()}</td>
              <td><b>{e.admin?.alias || "Admin"}</b> {describe(e)}{e.details?.excerpt ? <span className="muted">: “{e.details.excerpt}”</span> : null}</td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}
