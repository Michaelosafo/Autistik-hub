/**
 * Alerts that reach the member's phone or computer even when the site is closed (Web Push).
 * Every alert is also saved to the 🔔 list. Push needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel;
 * without them alerts still show in the 🔔 list and as pop-ups while the site is open.
 */
import webpush from "web-push";
import { supabaseService } from "@/lib/supabase/server";

export type Note = { user_id: string; title: string; body?: string | null; link?: string | null; strong?: boolean };

const PUBLIC = (process.env.VAPID_PUBLIC_KEY || "").trim();
const PRIVATE = (process.env.VAPID_PRIVATE_KEY || "").trim();
export const pushKey = () => (PUBLIC && PRIVATE ? PUBLIC : null);

let ready = false;
function setup() {
  if (ready || !pushKey()) return ready;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://autistik.io", PUBLIC, PRIVATE);
  return (ready = true);
}

/** Saves the alerts to each member's 🔔 list and pushes them to their devices. Never throws. */
export async function notify(notes: Note[]) {
  if (!notes.length) return;
  const sb = supabaseService();
  const rows = notes.map(({ user_id, title, body, link }) => ({ user_id, title: title.slice(0, 200), body: body?.slice(0, 500) ?? null, link: link ?? null }));
  for (let i = 0; i < rows.length; i += 500) await sb.from("notifications").insert(rows.slice(i, i + 500));
  if (!setup()) return;
  try {
    const users = [...new Set(notes.map((n) => n.user_id))];
    const subs: any[] = [];
    for (let i = 0; i < users.length; i += 200) {
      const { data } = await sb.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth").in("user_id", users.slice(i, i + 200));
      subs.push(...(data || []));
    }
    const dead: number[] = [];
    const jobs = notes.flatMap((n) => subs.filter((s) => s.user_id === n.user_id).map((s) => async () => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body || "", link: n.link || "/analytics", strong: !!n.strong }),
          { TTL: 3600, urgency: n.strong ? "high" : "normal" },
        );
      } catch (e: any) {
        // The device unsubscribed or the browser dropped it: forget it.
        if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id);
      }
    }));
    for (let i = 0; i < jobs.length; i += 20) await Promise.all(jobs.slice(i, i + 20).map((j) => j()));
    if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);
  } catch (e) { console.error("push failed", (e as Error).message); }
}
