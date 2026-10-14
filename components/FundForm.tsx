"use client";
import { useState } from "react";
import Link from "next/link";

export default function FundForm() {
  const [f, setF] = useState({ name: "", email: "", country: "", phone: "", message: "", forSomeoneElse: false, consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Something went wrong. Try again."); return; }
      setDone(true);
    } catch {
      setError("Couldn't reach the Hub. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="card stack" id="interest">
        <h2>Thank you</h2>
        <p>We&apos;ve saved your details. We&apos;ll email <b>{f.email}</b> when the AUTISTIK Fund opens. You don&apos;t need to do anything else.</p>
      </div>
    );
  }

  return (
    <form className="card stack" id="interest" onSubmit={submit}>
      <h2>Register your interest</h2>
      <p className="muted" style={{ fontSize: ".9em" }}>This is not an application and doesn&apos;t commit you to anything. We only use these details to contact you when the fund opens.</p>
      <div className="grid2" style={{ gap: 12 }}>
        <label className="field"><span>Name</span><input id="fundName" type="text" autoComplete="name" required value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Email</span><input id="fundEmail" type="email" autoComplete="email" required value={f.email} onChange={set("email")} /></label>
        <label className="field"><span>Country you live in</span><input id="fundCountry" type="text" autoComplete="country-name" required value={f.country} onChange={set("country")} /></label>
        <label className="field"><span>Phone (optional)</span><input id="fundPhone" type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} /></label>
      </div>
      <label className="field"><span>Message (optional)</span><textarea id="fundMessage" maxLength={1000} placeholder="Anything you'd like us to know" value={f.message} onChange={set("message")} /></label>
      {/* Hidden from people; bots fill it in and get ignored. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} style={{ position: "absolute", left: "-9999px" }} aria-hidden="true" />
      <label className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}><input id="fundOther" type="checkbox" checked={f.forSomeoneElse} onChange={set("forSomeoneElse")} /> <span>I&apos;m a parent, guardian or caregiver registering for someone else.</span></label>
      <label className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}><input id="fundConsent" type="checkbox" checked={f.consent} onChange={set("consent")} /> <span>I agree that AUTISTIK can store these details and email me about the fund. See <Link href="/safety">Safety &amp; privacy</Link>.</span></label>
      {error && <div className="notice alert" role="alert">{error}</div>}
      <div className="row"><button className="btn primary" type="submit" disabled={busy || !f.consent}>{busy ? "Saving…" : "Register my interest"}</button></div>
    </form>
  );
}
