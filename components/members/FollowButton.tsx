"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** Follow / Following toggle. Unfollowing asks once, so a slip of the finger doesn't drop someone. */
export default function FollowButton({ id, initial, small, back, onChange }: { id: string; initial: boolean; small?: boolean; back?: boolean; onChange?: (on: boolean) => void }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [msg, setMsg] = useState("");

  async function toggle() {
    if (on && !sure) { setSure(true); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.push(`/login?next=/members/${id}`); return; }
    const { error } = on
      ? await sb.from("follows").delete().eq("follower_id", user.id).eq("followee_id", id)
      : await sb.from("follows").insert({ followee_id: id });
    setBusy(false); setSure(false);
    if (error) { setMsg(/slow down/i.test(error.message) ? error.message : "Couldn't save. Try again."); return; }
    setOn(!on); onChange?.(!on); router.refresh();
  }

  const cls = `btn ${on ? "" : "primary"} ${small ? "small" : ""}`.trim();
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className={cls} type="button" disabled={busy} onClick={toggle} aria-pressed={on}>
        {sure ? "Unfollow?" : on ? "Following ✓" : back ? "Follow back" : "+ Follow"}
      </button>
      {sure && <button className={`btn ${small ? "small" : ""}`} type="button" onClick={() => setSure(false)}>Keep</button>}
      {msg && <span className="muted" role="status" style={{ fontSize: ".85em" }}>{msg}</span>}
    </span>
  );
}
