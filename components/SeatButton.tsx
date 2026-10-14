"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

/** "Save my seat" toggle for a session. With `remove`, renders the admin delete button instead. */
export default function SeatButton({ sessionId, remove }: { sessionId: string; remove?: boolean }) {
  const sb = supabaseBrowser();
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    sb.auth.getUser().then(async ({ data }) => {
      const id = data.user?.id ?? null;
      setUid(id);
      if (id && !remove) {
        const { data: r } = await sb.from("rsvps").select("session_id").eq("session_id", sessionId).eq("user_id", id).maybeSingle();
        setGoing(!!r);
      }
    });
  }, [sessionId]);

  if (remove) {
    return <button className="btn small" type="button" onClick={async () => { await sb.from("sessions").delete().eq("id", sessionId); router.refresh(); }}>Remove</button>;
  }
  async function toggle() {
    if (!uid) { router.push("/login"); return; }
    setBusy(true);
    if (going) await sb.from("rsvps").delete().eq("session_id", sessionId).eq("user_id", uid);
    else await sb.from("rsvps").insert({ session_id: sessionId });
    setGoing(!going); setBusy(false); router.refresh();
  }
  return (
    <button className={going ? "btn small" : "btn primary small"} type="button" disabled={busy} onClick={toggle}>
      {going ? "Seat saved ✓" : "Save my seat"}
    </button>
  );
}
