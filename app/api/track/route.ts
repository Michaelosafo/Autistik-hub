import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Counts a page visit for the admin's Site activity panel. Stores the page, a random visitor id (a cookie, not the
// IP address), the country (from Vercel) and the kind of device. Nothing else.
export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response(null, { status: 204 });
  const slow = await rateLimit(req, "track", 300, 600);
  if (slow) return new Response(null, { status: 204 });
  const body = await req.json().catch(() => null);
  const path = String(body?.path || "");
  if (!/^\/[A-Za-z0-9/_.~%-]{0,299}$/.test(path) || path.startsWith("/api")) return new Response(null, { status: 204 });
  let ref: string | null = null;
  try { const r = new URL(String(body?.ref || "")); ref = r.hostname === new URL(req.url).hostname ? null : r.hostname.slice(0, 200); } catch {}

  const jar = cookies();
  let visitor = jar.get("hv")?.value || "";
  const fresh = !/^[a-f0-9-]{36}$/.test(visitor);
  if (fresh) visitor = randomUUID();
  const ua = req.headers.get("user-agent") || "";
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "phone" : "computer";
  const country = (req.headers.get("x-vercel-ip-country") || "").slice(0, 8) || null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  await supabaseService().from("page_views").insert({ path, visitor, user_id: user?.id ?? null, country, device, referrer: ref });
  const res = new Response(null, { status: 204 });
  if (fresh) res.headers.append("set-cookie", `hv=${visitor}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  return res;
}
