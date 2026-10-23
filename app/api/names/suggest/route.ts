import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";
import { memeName, handleOf } from "@/lib/names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Six fresh AUTISTIK names (with their @handles) nobody has yet. Used on the sign-up form and the profile page. */
export async function GET(req: Request) {
  const slow = await rateLimit(req, "name-suggest", 40, 600);
  if (slow) return slow;
  const cand = Array.from(new Set(Array.from({ length: 16 }, () => memeName())));
  const handles = cand.map(handleOf);
  let taken = new Set<string>();
  try {
    const sb = supabaseService();
    const [{ data: a }, { data: h }] = await Promise.all([
      sb.from("profiles").select("alias").in("alias", cand),
      sb.from("profiles").select("handle").in("handle", handles),
    ]);
    taken = new Set([...(a || []).map((r: any) => String(r.alias).toLowerCase()), ...(h || []).map((r: any) => String(r.handle))]);
  } catch { /* if the check fails, the database still refuses duplicates when the name is saved */ }
  const names = cand.filter((n) => !taken.has(n.toLowerCase()) && !taken.has(handleOf(n))).slice(0, 6).map((n) => ({ alias: n, handle: handleOf(n) }));
  return json({ names });
}
