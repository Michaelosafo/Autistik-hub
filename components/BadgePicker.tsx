"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import VerifiedBadge, { BADGES } from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * Verified members choose which of the 10 badges shows next to their name, everywhere on AUTISTIK. When they've just
 * been verified (no choice yet) it opens straight away and asks them to pick.
 */
export default function BadgePicker({ current, name }: { current: number | null; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(!current);
  const [pick, setPick] = useState<number>(current || 1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function save() {
    setBusy(true); setMsg("");
    const { error } = await supabaseBrowser().rpc("set_verified_badge", { p_badge: pick });
    setBusy(false);
    if (error) { setMsg(error.message || "Couldn't save. Try again."); return; }
    setMsg("✅ Saved. It shows next to your name everywhere.");
    setOpen(false);
    router.refresh();
  }
  if (!open) return (
    <button type="button" className="btn small bp-open" onClick={() => setOpen(true)}>
      <VerifiedBadge n={current} size={18} /> Change my verified badge
    </button>
  );
  return (
    <section className="card stack bp" aria-labelledby="bp-h">
      <div>
        <b id="bp-h">{current ? "Your verified badge" : "🎉 You're verified! Choose your badge"}</b>
        <small className="muted" style={{ display: "block" }}>It shows next to your name on posts, chats, lives and your profile. Change it any time.</small>
      </div>
      <div className="bp-preview">
        <span className="bp-name">{name}</span><VerifiedBadge n={pick} size={26} />
      </div>
      <div className="bp-grid" role="radiogroup" aria-label="Verified badges">
        {BADGES.map((b, i) => (
          <button key={b.name} type="button" role="radio" aria-checked={pick === i + 1} className={"bp-item" + (pick === i + 1 ? " on" : "")} onClick={() => setPick(i + 1)}>
            <VerifiedBadge n={i + 1} size={40} />
            <small>{b.name}</small>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Use this badge"}</button>
        {current && <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>}
      </div>
      {msg && <small className="muted" role="status">{msg}</small>}
    </section>
  );
}
