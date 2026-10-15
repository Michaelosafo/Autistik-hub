"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = { kind: "loading" } | { kind: "setup"; factorId: string; qr: string; secret: string } | { kind: "code"; factorId: string } | { kind: "error"; text: string };

/** 2-step verification for the admin area: a 6-digit code from an authenticator app, on top of email + password. */
export default function AdminMfa() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const mfa = supabaseBrowser().auth.mfa;
      const { data, error } = await mfa.listFactors();
      if (error) return setStep({ kind: "error", text: error.message });
      const ready = data.totp.find((f) => f.status === "verified");
      if (ready) return setStep({ kind: "code", factorId: ready.id });
      // Clear half-finished setups, then start a fresh one.
      for (const f of data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified")) await mfa.unenroll({ factorId: f.id });
      const { data: en, error: enErr } = await mfa.enroll({ factorType: "totp", friendlyName: `AUTISTIK admin ${new Date().toISOString().slice(0, 10)}` });
      if (enErr || !en) return setStep({ kind: "error", text: enErr?.message || "Couldn't start 2-step setup." });
      setStep({ kind: "setup", factorId: en.id, qr: en.totp.qr_code, secret: en.totp.secret });
    })();
  }, []);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (step.kind !== "setup" && step.kind !== "code") return;
    setBusy(true); setMsg("");
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) { setMsg("That code didn't work. Check the time on your phone is set automatically, then try the newest code."); return; }
    router.refresh();
  }

  if (step.kind === "loading") return <div className="card muted">Checking your 2-step verification…</div>;
  if (step.kind === "error") return <div className="notice alert">2-step verification isn&apos;t available: {step.text}</div>;
  return (
    <form className="card stack" style={{ maxWidth: 460 }} onSubmit={verify}>
      {step.kind === "setup" ? (
        <>
          <h2>Turn on 2-step verification</h2>
          <p className="muted">The admin area needs a 6-digit code from an authenticator app as well as your password. You only set this up once.</p>
          <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6 }}>
            <li>Install <b>Google Authenticator</b>, <b>Microsoft Authenticator</b> or <b>Authy</b> on your phone.</li>
            <li>In the app, tap <b>+</b> and scan this code:</li>
          </ol>
          <img src={step.qr} alt="QR code for your authenticator app" width={200} height={200} style={{ background: "#fff", borderRadius: 10, padding: 8, alignSelf: "flex-start" }} />
          <details><summary className="muted">Can&apos;t scan? Type this key instead</summary><span className="mono" style={{ overflowWrap: "anywhere" }}>{step.secret}</span></details>
          <p>3. Type the 6-digit code the app shows:</p>
        </>
      ) : (
        <>
          <h2>Enter your 2-step code</h2>
          <p className="muted">Open your authenticator app and type the 6-digit code for AUTISTIK.</p>
        </>
      )}
      <label className="field"><span>6-digit code</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
      </label>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
      {msg && <div className="notice warn">{msg}</div>}
    </form>
  );
}
