"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useMfaEnrollment } from "@privy-io/react-auth";

type Step = { kind: "start" } | { kind: "scan"; qr: string; secret: string } | { kind: "error"; text: string };

/**
 * Before the AUTISTIK wallet can be used: an authenticator app is required. Once it's added, Privy asks for a code
 * from it before the wallet signs anything or shows its key, so a stolen email or password alone can't move funds.
 */
export default function AuthenticatorGate({ email, onDone, onSignOut }: { email: string | null; onDone: () => void; onSignOut: () => void }) {
  const { initEnrollmentWithTotp, submitEnrollmentWithTotp } = useMfaEnrollment();
  const [step, setStep] = useState<Step>({ kind: "start" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function begin() {
    setBusy(true); setMsg("");
    try {
      const { authUrl, secret } = await initEnrollmentWithTotp();
      const qr = await import("qrcode").then((m) => m.toDataURL(authUrl, { margin: 1, width: 220 }));
      setStep({ kind: "scan", qr, secret });
    } catch (e: any) {
      setStep({ kind: "error", text: /not enabled|not allowed/i.test(e?.message || "") ? "Authenticator apps aren't switched on for the wallet yet. The site owner needs to turn on TOTP under MFA in the Privy dashboard." : e?.message || "Couldn't start the setup. Please try again." });
    } finally { setBusy(false); }
  }
  useEffect(() => { begin(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try { await submitEnrollmentWithTotp({ mfaCode: code.replace(/\s/g, "") }); onDone(); }
    catch { setMsg("That code didn't work. Make sure the time on your phone is set automatically, then type the newest code."); }
    finally { setBusy(false); }
  }

  return (
    <form className="card stack auth-gate" style={{ maxWidth: 520, margin: "0 auto" }} onSubmit={verify}>
      <div className="an-kicker">STEP 2 OF 2 · PROTECT YOUR WALLET</div>
      <h2 style={{ margin: 0 }}>Add an authenticator app</h2>
      <p className="muted" style={{ margin: 0 }}>
        Your AUTISTIK wallet{email ? <> for <b>{email}</b></> : null} is ready. Before you can fund it or trade, link an authenticator app.
        After this, the wallet asks for a 6-digit code from the app before it sends anything, so even someone who gets into your email can&apos;t take your coins.
      </p>
      <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
        <li>Install a free authenticator app on your phone: <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>Authy</b> (App Store or Google Play).</li>
        <li>Open it and tap <b>+</b> (or <b>Add account</b>), then <b>Scan a QR code</b>, and point your camera at this code:</li>
      </ol>
      {step.kind === "scan" && (
        <>
          <img src={step.qr} alt="QR code to scan with your authenticator app" width={220} height={220} style={{ background: "#fff", borderRadius: 10, padding: 8, alignSelf: "center" }} />
          <details><summary className="muted">On this phone, or can&apos;t scan? Type this key instead</summary>
            <p className="muted" style={{ margin: "6px 0" }}>In the app choose <b>Enter a setup key</b>, name it AUTISTIK, and paste:</p>
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{step.secret}</span>
          </details>
        </>
      )}
      {step.kind === "start" && <div className="muted">Making your code…</div>}
      {step.kind === "error" && <div className="notice warn">{step.text} <button type="button" className="btn small" onClick={begin} disabled={busy}>Try again</button></div>}
      <p style={{ margin: 0 }}>3. The app now shows <b>AUTISTIK</b> with a 6-digit code that changes every 30 seconds. Type it here:</p>
      <label className="field"><span>6-digit code</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} disabled={step.kind !== "scan"} />
      </label>
      <button className="btn primary" type="submit" disabled={busy || step.kind !== "scan"}>{busy ? "Checking…" : "Turn on and open my wallet"}</button>
      {msg && <div className="notice warn" role="alert">{msg}</div>}
      <div className="notice" style={{ fontSize: ".88em" }}>
        <b>Keep the app.</b> If you get a new phone, move your accounts across before wiping the old one. Nobody from AUTISTIK will ever ask for your codes.
      </div>
      <button type="button" className="linkish" onClick={onSignOut} style={{ alignSelf: "flex-start" }}>Not now, sign out of the wallet</button>
    </form>
  );
}
