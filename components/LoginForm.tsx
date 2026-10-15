"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MIN_PASSWORD, authMessage } from "@/lib/auth";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/env";
import HumanCheck, { TURNSTILE_SITE_KEY, type HumanCheckHandle } from "@/components/HumanCheck";

type Mode = "signin" | "join" | "forgot";

const TITLES: Record<Mode, [string, string]> = {
  signin: ["Welcome back", "Sign in with your email and password."],
  join: ["Join the Hub", "Create a free account. We'll email you a link to confirm it, then you can chat with Believer and Purity."],
  forgot: ["Reset your password", "Enter your email and we'll send you a link to choose a new password."],
};

function strength(pw: string) {
  let s = 0;
  if (pw.length >= MIN_PASSWORD) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/i.test(pw) && /\d/.test(pw)) s++;
  if (/[^a-z0-9]/i.test(pw)) s++;
  return s; // 0–4
}

export default function LoginForm({ next, initialError, initialMode }: { next: string; initialError: string; initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [show, setShow] = useState(false);
  const [adult, setAdult] = useState(false);
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ? authMessage(initialError) : "");
  const [sent, setSent] = useState<"" | "confirm" | "reset" | "link">("");
  const [canResend, setCanResend] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const human = useRef<HumanCheckHandle>(null);
  const sb = supabaseBrowser();
  // Each "are you human" token works once, so get a fresh one after every try.
  const captchaToken = () => (TURNSTILE_SITE_KEY ? captcha : undefined);
  const needCaptcha = () => {
    if (TURNSTILE_SITE_KEY && !captcha) { setError("One moment: the \"are you human\" check is still loading. Try again in a few seconds."); return true; }
    return false;
  };
  const confirmUrl = (n: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(n)}`;

  function switchTo(m: Mode) { setMode(m); setError(""); setSent(""); setCanResend(false); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setCanResend(false);
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { setError("Please enter a valid email address."); return; }
    if (!SUPABASE_CONFIGURED) { setError("Sign-in isn't set up on this site yet. The site owner needs to add the Supabase settings in Vercel and redeploy."); return; }
    if (mode === "join") {
      if (!adult || !rules) { setError("Please tick both boxes to join."); return; }
      if (password.length < MIN_PASSWORD) { setError(`Your password needs at least ${MIN_PASSWORD} characters.`); return; }
      if (password !== password2) { setError("The two passwords don't match."); return; }
    }
    if (needCaptcha()) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: em, password, options: { captchaToken: captchaToken() } });
        if (error) { setError(authMessage(error.message)); setCanResend(/not confirmed/i.test(error.message)); return; }
        router.push(next); router.refresh();
      } else if (mode === "join") {
        const { data, error } = await sb.auth.signUp({ email: em, password, options: { emailRedirectTo: confirmUrl(next), data: { confirmed_adult: true }, captchaToken: captchaToken() } });
        if (error) { setError(authMessage(error.message)); return; }
        // Supabase returns a user with no identities when the email is already registered.
        if (data.user && data.user.identities && data.user.identities.length === 0) { setError(authMessage("already registered")); return; }
        if (data.session) { router.push(next); router.refresh(); return; } // email confirmation switched off
        setSent("confirm"); setCanResend(true);
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`, captchaToken: captchaToken() });
        if (error) { setError(authMessage(error.message)); return; }
        setSent("reset");
      }
    } catch (err: any) {
      setError(authMessage(err?.message || "failed to fetch"));
    } finally { setBusy(false); human.current?.reset(); }
  }

  async function resend() {
    const em = email.trim().toLowerCase();
    if (!em) { setError("Type your email above first."); return; }
    if (needCaptcha()) return;
    setBusy(true); setError("");
    const { error } = await sb.auth.resend({ type: "signup", email: em, options: { emailRedirectTo: confirmUrl(next), captchaToken: captchaToken() } });
    setBusy(false); human.current?.reset();
    if (error) setError(authMessage(error.message)); else setSent("confirm");
  }

  async function magicLink() {
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { setError("Type your email above first."); return; }
    if (needCaptcha()) return;
    setBusy(true); setError("");
    const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: confirmUrl(next), shouldCreateUser: false, captchaToken: captchaToken() } });
    setBusy(false); human.current?.reset();
    if (error) setError(/signups not allowed|not found/i.test(error.message) ? "There's no account with this email yet. Create one first." : authMessage(error.message));
    else setSent("link");
  }

  const [title, sub] = TITLES[mode];
  const s = strength(password);

  if (sent) {
    return (
      <div className="auth-card card stack">
        <div className="label">Check your email</div>
        <h1>{sent === "confirm" ? "Confirm your email" : sent === "reset" ? "Password link sent" : "Sign-in link sent"}</h1>
        <p>We sent an email to <b>{email.trim()}</b>.{" "}
          {sent === "confirm" ? "Open it and press Confirm my email. Then you're in, and Believer and Purity are ready to chat."
            : sent === "reset" ? "Open it and press Choose a new password."
            : "Open it and press Sign me in."}</p>
        <div className="notice" style={{ fontSize: ".9em" }}>It comes from AUTISTIK Hub and usually arrives within a minute. Check your spam or promotions folder if you can&apos;t see it.</div>
        <div className="row" style={{ gap: 8 }}>
          {sent === "confirm" && <HumanCheck ref={human} onToken={setCaptcha} />}
          {sent === "confirm" && <button className="btn" type="button" disabled={busy} onClick={resend}>{busy ? "Sending…" : "Send it again"}</button>}
          <button className="btn" type="button" onClick={() => switchTo("signin")}>Back to sign in</button>
        </div>
        {error && <div className="notice warn" role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className="auth-card card stack">
      <div className="row auth-tabs" role="tablist" aria-label="Sign in or join">
        <button type="button" role="tab" className="btn small toggle" aria-selected={mode === "signin"} aria-pressed={mode === "signin"} onClick={() => switchTo("signin")}>Sign in</button>
        <button type="button" role="tab" className="btn small toggle" aria-selected={mode === "join"} aria-pressed={mode === "join"} onClick={() => switchTo("join")}>Create account</button>
      </div>
      <h1>{title}</h1>
      <p className="muted">{sub} Other members only see your Hub name, never your email.</p>

      <form className="stack" onSubmit={submit} noValidate>
        <label className="field"><span>Email</span>
          <input id="loginEmail" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>

        {mode !== "forgot" && (
          <label className="field"><span>Password</span>
            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input id="loginPassword" type={show ? "text" : "password"} autoComplete={mode === "join" ? "new-password" : "current-password"} required minLength={mode === "join" ? MIN_PASSWORD : undefined} value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <button className="btn small" type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
            </div>
          </label>
        )}

        {mode === "join" && (
          <>
            <div className="pw-meter" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i < s ? "on" : ""} />)}</div>
            <span className="muted" style={{ fontSize: ".82em", marginTop: -6 }}>At least {MIN_PASSWORD} characters. Mixing letters, numbers and symbols makes it stronger.</span>
            <label className="field"><span>Type the password again</span>
              <input id="loginPassword2" type={show ? "text" : "password"} autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </label>
            <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}><input id="loginAdult" type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /> <span>I am 18 or older.</span></label>
            <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}><input id="loginRules" type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} /> <span>I&apos;ve read the <Link href="/safety" target="_blank">community guidelines</Link> and will follow them.</span></label>
          </>
        )}

        <HumanCheck ref={human} onToken={setCaptcha} />
        {error && <div className="notice warn" role="alert">{error}</div>}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "join" ? "Create my account" : "Email me a reset link"}
        </button>
      </form>

      <div className="stack" style={{ gap: 6, fontSize: ".9em" }}>
        {mode === "signin" && (
          <>
            <button className="linkish" type="button" onClick={() => switchTo("forgot")}>Forgot your password?</button>
            <button className="linkish" type="button" disabled={busy} onClick={magicLink}>Email me a sign-in link instead</button>
            {canResend && <button className="linkish" type="button" disabled={busy} onClick={resend}>Send the confirmation email again</button>}
            <span className="muted">New here? <button className="linkish" type="button" onClick={() => switchTo("join")}>Create an account</button></span>
          </>
        )}
        {mode === "join" && <span className="muted">Already have an account? <button className="linkish" type="button" onClick={() => switchTo("signin")}>Sign in</button></span>}
        {mode === "forgot" && <button className="linkish" type="button" onClick={() => switchTo("signin")}>Back to sign in</button>}
      </div>
    </div>
  );
}
