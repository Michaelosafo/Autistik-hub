"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MIN_PASSWORD, authMessage } from "@/lib/auth";

export default function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < MIN_PASSWORD) { setError(`Your password needs at least ${MIN_PASSWORD} characters.`); return; }
    if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) { setError("Your password needs at least one letter and one number."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setError(authMessage(error.message)); return; }
    setDone(true);
    setTimeout(() => { router.push("/companions"); router.refresh(); }, 1500);
  }

  if (done) return <div className="auth-card card stack"><h1>Password changed</h1><p>You&apos;re signed in. Taking you to Believer and Purity…</p></div>;

  return (
    <form className="auth-card card stack" onSubmit={save}>
      <div className="label">Account</div>
      <h1>Choose a new password</h1>
      {email && <p className="muted">For <b>{email}</b>.</p>}
      <label className="field"><span>New password</span>
        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <input id="newPassword" type={show ? "text" : "password"} autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
          <button className="btn small" type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
        </div>
      </label>
      <label className="field"><span>Type it again</span>
        <input id="newPassword2" type={show ? "text" : "password"} autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
      </label>
      {error && <div className="notice warn" role="alert">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save my new password"}</button>
    </form>
  );
}
