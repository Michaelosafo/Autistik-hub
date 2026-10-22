import { json } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { rateLimit } from "@/lib/ratelimit";
import { pushKey } from "@/lib/push";
import { supabaseServer, supabaseService, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The public key a device needs to sign up for push alerts (null when push isn't set up yet).
export async function GET() {
  return json({ key: pushKey() });
}

// Save this device so alerts reach it even when the site is closed. One device belongs to one member.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "push-subscribe", 20, 3600);
  if (slow) return slow;
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const b = await req.json().catch(() => null);
  const endpoint = String(b?.endpoint || ""), p256dh = String(b?.keys?.p256dh || ""), auth = String(b?.keys?.auth || "");
  if (!/^https:\/\/[^\s]{10,990}$/.test(endpoint) || !/^[A-Za-z0-9_-]{20,190}=*$/.test(p256dh) || !/^[A-Za-z0-9_-]{8,90}=*$/.test(auth)) {
    return json({ error: "That device can't receive alerts." }, 400);
  }
  const sb = supabaseService();
  // Keep at most 10 devices per member (the newest).
  const { data: mine } = await sb.from("push_subscriptions").select("id").eq("user_id", user.id).order("created_at", { ascending: false });
  if ((mine || []).length >= 10) await sb.from("push_subscriptions").delete().in("id", mine!.slice(9).map((r: any) => r.id));
  await sb.from("push_subscriptions").upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: "endpoint" });
  logActivity(user.id, "alerts", "Turned on phone alerts");
  return json({ ok: true });
}

// Stop alerts on this device.
export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in." }, 401);
  const b = await req.json().catch(() => null);
  await supabaseService().from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", String(b?.endpoint || ""));
  return json({ ok: true });
}
