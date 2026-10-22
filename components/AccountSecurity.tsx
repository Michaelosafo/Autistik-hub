"use client";
/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { MfaStep } from "@/lib/mfa";

type Factor = { id: string; friendly_name?: string; created_at: string; status: string; factor_type: string };
type Setup = { factorId: string; qr: string; secret: string; uri: string };

const BAD_CODE = "That code didn't work. Codes change every 30 seconds, so type the newest one. If it keeps failing, set your phone's date and time to automatic.";
const clean = (c: string) => c.replace(/\D/g, "");

/**
 * The member's 2-step verification:
 * - "code": type the code from the app to finish signing in
 * - "ok": turn it on (optional, recommended), or see the apps on the account, add a backup one, or remove one
 * `welcome`: just joined, so there's a "Skip for now" back to where they were going.
 */
export default function AccountSecurity({ step, next, email, welcome = false }: { step: MfaStep; next: string; email: string; welcome?: boolean }) {
  const mfa = supabaseBrowser().auth.mfa;
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await mfa.listFactors();
    if (error) { setMsg("We couldn't load your 2-step settings. Refresh the page to try again."); return []; }
    const all = (data.all as Factor[]).filter((f) => f.factor_type === "totp");
    setFactors(all.filter((f) => f.status === "verified"));
    return all;
  }, [mfa]);

  const startSetup = useCallback(async (all: Factor[]) => {
    setMsg(""); setCode("");
    // Clear half-finished setups, then start a fresh one.
    for (const f of all.filter((f) => f.status !== "verified")) await mfa.unenroll({ factorId: f.id });
    const n = all.filter((f) => f.status === "verified").length;
    const { data, error } = await mfa.enroll({ factorType: "totp", issuer: "AUTISTIK Hub", friendlyName: `${n ? "Backup" : "Phone"} ${new Date().toISOString().slice(0, 16).replace("T", " ")}` });
    if (error || !data) { setMsg("We couldn't start the setup. Refresh the page to try again."); return; }
    setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
  }, [mfa]);

  useEffect(() => { load(); }, [load]);

  const done = () => window.location.assign(next);

  async function verifySetup(e: React.FormEvent) {
    e.preventDefault();
    if (!setup) return;
    setBusy(true); setMsg("");
    const { error } = await mfa.challengeAndVerify({ factorId: setup.factorId, code: clean(code) });
    setBusy(false);
    if (error) { setMsg(BAD_CODE); return; }
    setSetup(null); setCode("");
    setMsg(factors?.length ? "Backup authenticator added." : "2-step verification is on. Your account is now much harder to break into.");
    load();
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (!factors?.length) return;
    setBusy(true); setMsg("");
    // With a backup app there's more than one: the code can come from any of them.
    for (const f of factors) {
      const { error } = await mfa.challengeAndVerify({ factorId: f.id, code: clean(code) });
      if (!error) { done(); return; }
    }
    setBusy(false); setMsg(BAD_CODE);
  }

  async function remove(f: Factor) {
    if (!factors?.length) return;
    const last = factors.length === 1;
    if (!confirm(last
      ? "Turn off 2-step verification? Your account will only be protected by your password or email again, which makes it easier to break into."
      : `Remove "${f.friendly_name || "this authenticator"}"? Its codes will stop working for your account.`)) return;
    setBusy(true);
    const { error } = await mfa.unenroll({ factorId: f.id });
    setBusy(false);
    setMsg(error ? "Couldn't remove it. Sign out and in again, then try once more." : last ? "2-step verification is off." : "Removed.");
    load();
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    window.location.assign("/");
  }

  async function copyKey() {
    if (!setup) return;
    try { await navigator.clipboard.writeText(setup.secret); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
  }

  const codeField = (
    <label className="field"><span>6-digit code</span>
      <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code}
        onChange={(e) => setCode(e.target.value)} autoFocus style={{ fontSize: "1.4em", letterSpacing: ".2em", maxWidth: 220 }} />
    </label>
  );

  const setupForm = setup && (
    <form className="stack" onSubmit={verifySetup}>
      <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
        <li>Install an authenticator app on your phone (see the guide below if you don&apos;t have one).</li>
        <li>In the app tap <b>+</b>, then <b>Scan a QR code</b>, and scan this:</li>
      </ol>
      <img src={setup.qr} alt="QR code to add AUTISTIK Hub to your authenticator app" width={200} height={200} style={{ background: "#fff", borderRadius: 10, padding: 8, alignSelf: "flex-start" }} />
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: ".9em" }}>Using this phone? You can&apos;t scan your own screen, so use one of these instead:</span>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn small" href={setup.uri}>Open in my authenticator app</a>
          <button className="btn small" type="button" onClick={copyKey}>{copied ? "Key copied ✓" : "Copy the key"}</button>
        </div>
        <details><summary className="muted">Show the key</summary><span className="mono" style={{ overflowWrap: "anywhere" }}>{setup.secret}</span></details>
      </div>
      <p style={{ margin: 0 }}>3. Type the 6-digit code the app now shows for <b>AUTISTIK Hub</b>:</p>
      {codeField}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Turn it on"}</button>
        {<button className="btn" type="button" onClick={() => { setSetup(null); load().then((all) => all.filter((f) => f.status !== "verified").forEach((f) => mfa.unenroll({ factorId: f.id }))); }}>Cancel</button>}
      </div>
    </form>
  );

  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      {step === "code" && (
        <form className="stack" onSubmit={verifyCode}>
          <div className="label">One more step</div>
          <h2>Enter your 6-digit code</h2>
          <p className="muted" style={{ margin: 0 }}>Open your authenticator app and type the code it shows for <b>AUTISTIK Hub</b>.</p>
          {codeField}
          <button className="btn primary" type="submit" disabled={busy || !factors}>{busy ? "Checking…" : "Continue"}</button>
        </form>
      )}

      {step === "ok" && factors?.length === 0 && (
        <>
          {welcome && <div className="label">Welcome to the Hub</div>}
          <h2>Make your account more secure</h2>
          <div className="notice warn stack" style={{ gap: 6 }}>
            <b>2-step verification is off for {email}.</b>
            <span>Right now anyone who gets your password, or into your email, can get into your account. Turn on 2-step verification and they&apos;d also need your phone. It takes about a minute, and we strongly recommend it.</span>
          </div>
          {setup ? setupForm : (
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" type="button" disabled={busy} onClick={() => load().then(startSetup)}>Turn on 2-step verification</button>
              {welcome && <a className="btn" href={next}>Skip for now</a>}
            </div>
          )}
          {welcome && !setup && <span className="muted" style={{ fontSize: ".9em" }}>You can turn it on any time from the menu: <b>Account security</b>.</span>}
        </>
      )}

      {step === "ok" && !!factors?.length && (
        <>
          <h2>Your authenticator apps</h2>
          <p className="muted" style={{ margin: 0 }}>2-step verification is <b>on</b> for {email} ✓. Every sign-in needs a code from one of these, so your password alone isn&apos;t enough to get in.</p>
          <ul className="stack" style={{ margin: 0, padding: 0, listStyle: "none", gap: 8 }}>
            {factors.map((f) => (
              <li key={f.id} className="notice row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span>🔐 <b>{f.friendly_name || "Authenticator"}</b> <small className="muted">added {new Date(f.created_at).toLocaleDateString()}</small></span>
                <button className="btn small" type="button" disabled={busy} onClick={() => remove(f)}>{factors.length > 1 ? "Remove" : "Turn off"}</button>
              </li>
            ))}
          </ul>
          {setup ? setupForm : (
            <>
              <p className="muted" style={{ margin: 0, fontSize: ".92em" }}>Add a backup, like a tablet or a second phone, so you can still sign in if you lose your phone.</p>
              <button className="btn" type="button" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => load().then(startSetup)}>Add a backup authenticator</button>
            </>
          )}
          {welcome && <a className="btn primary" href={next} style={{ alignSelf: "flex-start" }}>Continue</a>}
        </>
      )}
      {step === "ok" && factors === null && !msg && <div className="muted">Loading…</div>}

      {msg && <div className={`notice ${/added|Removed|is on|is off/.test(msg) ? "" : "warn"}`} role="status">{msg}</div>}
      {step !== "ok" && <button className="linkish" type="button" onClick={signOut} style={{ alignSelf: "flex-start" }}>Sign out instead</button>}
    </div>
  );
}
