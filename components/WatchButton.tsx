"use client";
import { useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function WatchButton({ uid, chain, token, watching, count }: { uid: string | null; chain: string; token: string; watching: boolean; count: number }) {
  const [on, setOn] = useState(watching);
  const [n, setN] = useState(count);
  const [busy, setBusy] = useState(false);
  if (!uid) return <Link className="btn" href="/login">👀 Watch ({n})</Link>;

  async function toggle() {
    setBusy(true);
    const sb = supabaseBrowser().from("launch_watchers");
    const { error } = on
      ? await sb.delete().eq("user_id", uid).eq("chain", chain).eq("token", token)
      : await sb.insert({ user_id: uid, chain, token });
    if (!error) { setOn(!on); setN((x) => x + (on ? -1 : 1)); }
    setBusy(false);
  }
  return (
    <button className="btn toggle" type="button" aria-pressed={on} disabled={busy} onClick={toggle}>
      👀 {on ? "Watching" : "Watch"} ({n})
    </button>
  );
}
