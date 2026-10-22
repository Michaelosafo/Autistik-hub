"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MIN_PASSWORD, authMessage } from "@/lib/auth";
import { SUPABASE_CONFIGURED } from "@/lib/supabase/env";
import type { Providers } from "@/lib/auth-providers";
import { memeName, nicknameProblem } from "@/lib/names";
import HumanCheck, { TURNSTILE_SITE_KEY, type HumanCheckHandle } from "@/components/HumanCheck";

type Mode = "signin" | "join" | "forgot";

const TITLES: Record<Mode, [string, string]> = {
  signin: ["Welcome back", "Sign in with Google, Apple or your email."],
  join: ["Join the Hub", "Create a free account. We'll email you a 6-digit code to confirm it. You get a free AUTISTIK wallet too, made for this email."],
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

export default function LoginForm({ next, initialError, initialMode, providers = { google: true, apple: true } }: { next: string; initialError: string; initialMode: Mode; providers?: Providers }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [nick, setNick] = useState("");
  useEffect(() => { setNick(memeName()); }, []); // after loading, so the server and browser agree on the page
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
  const [otp, setOtp] = useState("");
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
      const bad = nicknameProblem(nick);
      if (bad) { setError(bad); return; }
      if (!adult || !rules) { setError("Please tick both boxes to join."); return; }
      if (password.length < MIN_PASSWORD) { setError(`Your password needs at least ${MIN_PASSWORD} characters.`); return; }
      if (!/[a-z]/i.test(password) || !/\d/.test(password)) { setError("Your password needs at least one letter and one number."); return; }
      if (password !== password2) { setError("The two passwords don't match."); return; }
    }
    if (needCaptcha()) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email: em, password, options: { captchaToken: captchaToken() } });
        if (error) { setError(authMessage(error.message)); setCanResend(/not confirmed/i.test(error.message)); return; }
        // A full page load, so the 2-step code is asked for straight away (see middleware.ts).
        window.location.assign(next);
      } else if (mode === "join") {
        const { data, error } = await sb.auth.signUp({ email: em, password, options: { emailRedirectTo: confirmUrl(next), data: { confirmed_adult: true, nickname: nick.trim().replace(/\s+/g, " ") }, captchaToken: captchaToken() } });
        if (error) { setError(authMessage(error.message)); return; }
        if (data.session) { window.location.assign(next); return; } // email confirmation switched off
        // An email that's already registered gets the same answer as a new one, so this form can't be used to
        // find out who has an account. (Supabase sends nothing in that case; the screen says what to do.)
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

  // The email has a 6-digit code as well as the button, so it works even when the link opens in another browser.
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    const token = otp.replace(/\D/g, "");
    if (token.length < 6) { setError("Type the 6-digit code from the email."); return; }
    setBusy(true); setError("");
    const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: sent === "confirm" ? "signup" : "email" });
    setBusy(false);
    if (error) { setError(/expired|invalid/i.test(error.message) ? "That code didn't work or has expired. Check the newest email, or send a new one." : authMessage(error.message)); return; }
    // New accounts see the (optional, recommended) 2-step verification offer first.
    window.location.assign(sent === "confirm" ? `/security?welcome=1&next=${encodeURIComponent(next)}` : next);
  }

  async function magicLink() {
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { setError("Type your email above first."); return; }
    if (needCaptcha()) return;
    setBusy(true); setError("");
    const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: confirmUrl(next), shouldCreateUser: false, captchaToken: captchaToken() } });
    setBusy(false); human.current?.reset();
    // "No account" looks exactly like success, so nobody can test which emails are registered.
    if (error && !/signups not allowed|not found|user not found/i.test(error.message)) setError(authMessage(error.message));
    else setSent("link");
  }

  async function social(provider: "google" | "apple") {
    setError("");
    if (!SUPABASE_CONFIGURED) { setError("Sign-in isn't set up on this site yet."); return; }
    const name = provider === "google" ? "Google" : "Apple";
    // Switched off in Supabase: say so here, instead of sending them to an error page.
    if (!providers[provider]) { setError(`${name} sign-in is being switched on and will work soon. For now, create an account with your email (Gmail works) and a password.`); return; }
    setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: confirmUrl(next) + "&adult=1" } });
    // On success the browser leaves for Google or Apple, so we only get here on an error.
    if (error) { setBusy(false); setError(/not enabled|unsupported provider/i.test(error.message) ? `${name} sign-in isn't switched on yet. Use your email for now.` : authMessage(error.message)); }
  }

  const [title, sub] = TITLES[mode];
  const s = strength(password);

  if (sent) {
    return (
      <div className="auth-card card stack">
        <div className="label">Check your email</div>
        <h1>{sent === "confirm" ? "Confirm your email" : sent === "reset" ? "Password link sent" : "Sign-in link sent"}</h1>
        <p>If <b>{email.trim()}</b> {sent === "confirm" ? "is new here" : "has an account"}, we&apos;ve sent it an email.{" "}
          {sent === "confirm" ? "Type the 6-digit code from it below (or press Confirm my email in the email)."
            : sent === "reset" ? "Open it and press Choose a new password."
            : "Type the 6-digit code from it below (or press Sign me in in the email)."}</p>
        {sent !== "reset" && (
          <form className="stack" onSubmit={verifyCode} style={{ gap: 8 }}>
            <label className="field"><span>Code from the email</span>
              <input id="emailCode" inputMode="numeric" autoComplete="one-time-code" maxLength={12} required value={otp} onChange={(e) => setOtp(e.target.value)} autoFocus
                style={{ fontSize: "1.4em", letterSpacing: ".2em", maxWidth: 240 }} />
            </label>
            <button className="btn primary" type="submit" disabled={busy} style={{ alignSelf: "flex-start" }}>{busy ? "Checking…" : sent === "confirm" ? "Confirm my email" : "Sign me in"}</button>
          </form>
        )}
        {sent === "confirm" && <p className="muted" style={{ margin: 0 }}>Already have an account with this email? Nothing new is sent: just <button className="linkish" type="button" onClick={() => switchTo("signin")}>sign in</button> or reset your password.</p>}
        {sent !== "confirm" && <p className="muted" style={{ margin: 0 }}>No email after a few minutes? The address may not have an account yet: <button className="linkish" type="button" onClick={() => switchTo("join")}>create one</button>.</p>}
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

      {mode !== "forgot" && (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <button type="button" className="btn oauth-btn" disabled={busy} onClick={() => social("google")}>
              <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
              Continue with Google
            </button>
            <button type="button" className="btn oauth-btn apple" disabled={busy} onClick={() => social("apple")}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.5 1.3-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4 1-1.4 1.3-2.7 1.4-2.8-.1 0-2.6-1-2.4-4.3zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z"/></svg>
              Continue with Apple
            </button>
          </div>
          <small className="muted" style={{ marginTop: -4 }}>By continuing you confirm you&apos;re 18 or older and will follow the <Link href="/safety" target="_blank">community guidelines</Link>.</small>
          <div className="or-line"><span>or use your email</span></div>
        </>
      )}

      <form className="stack" onSubmit={submit} noValidate>
        {mode === "join" && (
          <div className="stack" style={{ gap: 4 }}>
            <label className="field"><span>Nickname</span>
              <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <input id="loginNick" type="text" autoComplete="nickname" maxLength={40} required value={nick} onChange={(e) => setNick(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
                <button className="btn small" type="button" onClick={() => setNick(memeName())} aria-label="Suggest another meme name">🎲</button>
              </div>
            </label>
            <span className="muted" style={{ fontSize: ".82em" }}>This is how members see and find you, with an @handle like on X. Your email is never shown to anyone. You can change it later.</span>
          </div>
        )}
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
            <div className="notice" style={{ fontSize: ".88em" }}>🔐 <b>Tip:</b> after joining, turn on <b>2-step verification</b> (a code from an app on your phone). It&apos;s optional, but it makes your account much harder to break into.</div>
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
