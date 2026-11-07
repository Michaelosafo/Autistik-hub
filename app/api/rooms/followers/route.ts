import { json } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Follower counts for the people in a live room (public numbers). ?ids=a,b,c (up to 80). */
export async function GET(req: Request) {
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") || "").split(",").filter((x) => UUID.test(x)))].slice(0, 80);
  const sb = supabaseService();
  const counts = await Promise.all(ids.map((id) => sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", id).then((r) => r.count ?? 0, () => 0)));
  return json(Object.fromEntries(ids.map((id, i) => [id, counts[i]])), 200);
}
