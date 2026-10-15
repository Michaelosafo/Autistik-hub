"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PROFILE_COLORS } from "@/lib/badges";

/** Change your Hub name and colour. The database only lets you change these two things, and only on your own profile. */
export default function ProfileEdit({ alias: a0, color: c0 }: { alias: string; color: string }) {
  const router = useRouter();
  const [alias, setAlias] = useState(a0);
  const [color, setColor] = useState(c0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = alias.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 40) { setMsg("Your Hub name needs 2 to 40 characters."); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setBusy(false); setMsg("Please sign in again."); return; }
    const { error } = await sb.from("profiles").update({ alias: name, color }).eq("id", user.id);
    setBusy(false);
    if (error) { setMsg(/reserved|team/i.test(error.message) ? error.message : "Couldn't save. Try a different name."); return; }
    setMsg("Saved.");
    router.refresh();
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Edit your profile</h2>
      <label className="field"><span>Hub name</span>
        <input type="text" value={alias} maxLength={40} onChange={(e) => setAlias(e.target.value)} autoComplete="nickname" />
      </label>
      <span className="muted" style={{ fontSize: ".82em", marginTop: -6 }}>Don&apos;t use your real name if you&apos;d rather stay private.</span>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ padding: 0, marginBottom: 6 }}>Colour</legend>
        <div className="row" style={{ gap: 8 }}>
          {PROFILE_COLORS.map((c) => (
            <button key={c} type="button" className="swatch" aria-pressed={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} style={{ background: c }} />
          ))}
        </div>
      </fieldset>
      <div className="row"><button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      {msg && <span className="muted" role="status">{msg}</span>}
    </form>
  );
}
