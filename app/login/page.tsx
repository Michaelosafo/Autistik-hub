"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [adult, setAdult] = useState(false);
  const [rules, setRules] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!adult || !rules) { setMsg("Please confirm both boxes to join."); return; }
    setState("sending"); setMsg("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { confirmed_adult: true } },
    });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }

  return (
    <div className="auth-card card stack">
      <div className="label">Join the Hub</div>
      <h1>Sign in with your email</h1>
      <p className="muted">We&apos;ll email you a sign-in link. No password needed. Other members only see your Hub name, never your email.</p>
      {state === "sent" ? (
        <div className="notice">Check your inbox for the link from AUTISTIK Hub. You can close this page.</div>
      ) : (
        <form className="stack" onSubmit={send}>
          <label className="field"><span>Email</span><input type="text" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> <span>I am 18 or older.</span></label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /> <span>I&apos;ve read the <a href="/safety" target="_blank">community guidelines</a> and will follow them.</span></label>
          <button className="btn primary" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
          {msg && <div className="notice warn">{msg}</div>}
        </form>
      )}
    </div>
  );
}
