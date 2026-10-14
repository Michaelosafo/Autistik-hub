"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Row = { id: string; name: string; email: string; country: string; phone: string | null; message: string | null; for_someone_else: boolean; created_at: string };

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** People who registered interest in the AUTISTIK Fund. Admins only (protected by the database rules too). */
export default function FundAdmin() {
  const sb = supabaseBrowser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  async function load() {
    const { data, error } = await sb.from("fund_interest").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) { setMsg("Run supabase/fund.sql in Supabase to turn this list on."); setRows([]); return; }
    setRows((data as Row[]) || []);
  }
  useEffect(() => { load(); }, []);

  async function copyCsv() {
    const head = "name,email,country,phone,for_someone_else,message,registered";
    const body = (rows || []).map((r) => [r.name, r.email, r.country, r.phone, r.for_someone_else ? "yes" : "no", r.message, r.created_at].map(csvCell).join(",")).join("\n");
    try { await navigator.clipboard.writeText(head + "\n" + body); setMsg("Copied. Paste it into Google Sheets or Excel."); } catch { setMsg("Couldn't copy. Try another browser."); }
  }
  async function remove(id: string) {
    await sb.from("fund_interest").delete().eq("id", id);
    setConfirm(null); load();
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>AUTISTIK Fund · registered interest {rows ? `(${rows.length})` : ""}</h2>
        <button className="btn small" type="button" onClick={copyCsv} disabled={!rows?.length}>Copy as CSV</button>
      </div>
      <p className="muted" style={{ fontSize: ".9em" }}>Personal details. Only use them to contact people about the fund, and delete them when someone asks.</p>
      {msg && <span className="muted" style={{ fontSize: ".88em" }}>{msg}</span>}
      {rows && !rows.length && !msg && <div className="empty">Nobody has registered yet.</div>}
      {!!rows?.length && (
        <div className="scroll">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Phone</th><th>For</th><th>Message</th><th>When</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td><td className="mono">{r.email}</td><td>{r.country}</td><td>{r.phone || "–"}</td>
                  <td>{r.for_someone_else ? "Someone else" : "Self"}</td>
                  <td style={{ maxWidth: 260, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.message || "–"}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>{confirm === r.id
                    ? <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}><button className="btn small" type="button" onClick={() => remove(r.id)}>Delete</button><button className="btn small" type="button" onClick={() => setConfirm(null)}>Keep</button></span>
                    : <button className="btn small" type="button" onClick={() => setConfirm(r.id)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
