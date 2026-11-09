import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { accountState, supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKETS = ["avatars", "chat-images", "chat-media", "tik-images", "live-recordings", "token-logos"];

/**
 * Deletes the signed-in member's account (required by Google Play and the privacy policy).
 * The database removes their profile, posts, chats, follows, passes and settings with it; public records (coins they
 * launched) stay, without their name. Members with 2-step verification must have entered their code. The owner's
 * account can't be deleted here (it would lock the admin area).
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "account-delete", 3, 3600);
  if (slow) return slow;
  const { user, mfa } = await accountState();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (mfa !== "ok") return json({ error: "Enter your 2-step code first, then try again." }, 403);
  const b = await req.json().catch(() => ({}));
  if (String(b.confirm || "").trim().toUpperCase() !== "DELETE") return json({ error: 'Type DELETE to confirm.' }, 400);
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "Not available right now. Email us and we'll delete it for you." }, 503);

  const sb = supabaseServer();
  const { data: owner } = await sb.rpc("is_owner");
  if (owner === true) return json({ error: "This is the Hub owner's account, so it can't be deleted here." }, 403);

  const svc = supabaseService();
  // Their uploaded files (each member's files sit in a folder named after their account).
  for (const bucket of BUCKETS) {
    try {
      const { data } = await svc.storage.from(bucket).list(user.id, { limit: 1000 });
      const paths = (data || []).filter((f) => f.name).map((f) => `${user.id}/${f.name}`);
      if (paths.length) await svc.storage.from(bucket).remove(paths);
    } catch { /* keep going: the account itself must still be deleted */ }
  }
  const { error } = await svc.auth.admin.deleteUser(user.id);
  if (error) { console.error("account delete:", error.message); return json({ error: "Couldn't delete it right now. Try again, or email us." }, 500); }
  await sb.auth.signOut().catch(() => {});
  return json({ ok: true });
}
