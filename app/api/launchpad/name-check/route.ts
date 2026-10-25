import { json } from "@/lib/ai";
import { namesTaken } from "@/lib/launch-names";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is this name / ticker still free on the Launch Pad? (Checked live while the creator types.) */
export async function GET(req: Request) {
  const slow = await rateLimit(req, "name-check", 120, 600);
  if (slow) return slow;
  const u = new URL(req.url);
  const name = (u.searchParams.get("name") || "").slice(0, 40), symbol = (u.searchParams.get("symbol") || "").slice(0, 16);
  return json(await namesTaken(name, symbol));
}
