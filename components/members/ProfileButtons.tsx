"use client";
/** Message (opens a private chat) and the activity-privacy switch on a profile. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export function MessageButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { data, error } = await supabaseBrowser().rpc("start_dm", { p_other: id });
    setBusy(false);
    if (!error && data) router.push(`/chats?c=${data}`);
    else router.push("/chats");
  }
  return <button type="button" className="pp-btn" onClick={go} disabled={busy}>{busy ? "Opening…" : "Message"}</button>;
}

const OPTS = [
  { v: "everyone", label: "Everyone", note: "All members can see your activity" },
  { v: "followers", label: "Followers", note: "Only people who follow you" },
  { v: "private", label: "Only me", note: "Nobody else sees your activity" },
] as const;

export function ActivityPrivacy({ uid, initial }: { uid: string; initial: string }) {
  const [v, setV] = useState(initial || "everyone");
  const [msg, setMsg] = useState("");
  async function pick(next: string) {
    const prev = v; setV(next); setMsg("");
    const { error } = await supabaseBrowser().from("profiles").update({ activity_visibility: next }).eq("id", uid);
    if (error) { setV(prev); setMsg("Couldn't save. Try again."); } else setMsg("Saved.");
  }
  return (
    <div className="pp-privacy">
      <b>Who can see your activity</b>
      <div className="pp-seg" role="radiogroup" aria-label="Who can see your activity">
        {OPTS.map((o) => <button key={o.v} type="button" role="radio" aria-checked={v === o.v} className={v === o.v ? "on" : ""} onClick={() => pick(o.v)}>{o.label}</button>)}
      </div>
      <small className="muted">{OPTS.find((o) => o.v === v)?.note}. Swaps, trades and your wallet address are never shown.{msg && ` ${msg}`}</small>
    </div>
  );
}
