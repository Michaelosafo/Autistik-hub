"use client";
import NameSuggest from "@/components/NameSuggest";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PROFILE_COLORS } from "@/lib/badges";
import { HANDLE, handleOf } from "@/lib/names";

/** Change your Hub name and colour. The database only lets you change these two things, and only on your own profile. */
export default function ProfileEdit({ alias: a0, color: c0, handle: h0 }: { alias: string; color: string; handle?: string | null }) {
  const router = useRouter();
  const [alias, setAlias] = useState(a0);
  const [color, setColor] = useState(c0);
  const [handle, setHandle] = useState(h0 || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const name = alias.trim().replace(/\s+/g, " ");
    // Team words are checked by the database (team accounts may use them).
    if (name.length < 2 || name.length > 40) { setMsg("Your nickname needs 2 to 40 characters."); return; }
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (h0 != null && !HANDLE.test(h)) { setMsg("Your @handle needs 3 to 20 letters, numbers or _."); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { setBusy(false); setMsg("Please sign in again."); return; }
    const { error } = await sb.from("profiles").update(h0 != null && h !== h0 ? { alias: name, color, handle: h } : { alias: name, color }).eq("id", user.id);
    setBusy(false);
    if (error) { setMsg(/permission denied/i.test(error.message) ? "Couldn't change your @handle just yet. Try again in a minute." : error.message.length < 140 ? error.message : "Couldn't save. Try a different name."); return; }
    setMsg("Saved.");
    router.refresh();
  }

  // A fresh meme name from the database, guaranteed not to be anyone else's.
  async function reroll() {
    setBusy(true); setMsg("");
    const { data, error } = await supabaseBrowser().rpc("reroll_alias");
    setBusy(false);
    if (error || typeof data !== "string") { setMsg("Couldn't roll a new name right now."); return; }
    setAlias(data); setMsg(`You're now ${data}.`);
    router.refresh();
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>Edit your profile</h2>
      <label className="field"><span>Nickname</span>
        <input type="text" value={alias} maxLength={40} onChange={(e) => setAlias(e.target.value)} autoComplete="nickname" />
      </label>
      <div className="row" style={{ gap: 8, marginTop: -4 }}>
        <button className="btn small" type="button" disabled={busy} onClick={reroll}>🎲 New meme name</button>
        <span className="muted" style={{ fontSize: ".82em" }}>Or type your own. Every name is one of a kind.</span>
      </div>
      <NameSuggest onPick={(p) => { setAlias(p.alias); if (h0 != null) setHandle(p.handle); }} />
      <span className="muted" style={{ fontSize: ".82em" }}>Don&apos;t use your real name if you&apos;d rather stay private.</span>
      {h0 != null && (
        <label className="field"><span>@handle</span>
          <div className="handle-in"><span aria-hidden="true">@</span><input type="text" value={handle} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_]/g, "").toLowerCase())} /></div>
          <button className="btn small" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setHandle(handleOf(alias))}>Make my @handle match my name</button>
          <span className="muted" style={{ fontSize: ".82em" }}>People send you tokens by this name. It always leads to your same wallet, even after you change it.</span>
        </label>
      )}
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
