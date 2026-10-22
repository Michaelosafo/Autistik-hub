import { createHmac, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Counts a page visit for the admin's Site activity panel. Stores the page, a random browser id (a cookie), a secret
// hash of the IP address (so one network counts as one person; the IP itself is never stored), the country (from
// Vercel) and the kind of device. Nothing else.
export async function POST(req: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response(null, { status: 204 });
  const slow = await rateLimit(req, "track", 300, 600);
  if (slow) return new Response(null, { status: 204 });
  const body = await req.json().catch(() => null);
  const path = String(body?.path || "");
  if (!/^\/[A-Za-z0-9/_.~%-]{0,299}$/.test(path) || /^\/(api|admin|login|auth|reset-password|me)(\/|$)/.test(path)) return new Response(null, { status: 204 });
  // The referrer is stored as a bare site name only (e.g. "x.com"); anything else is dropped.
  const raw = String(body?.ref || "").trim().toLowerCase();
  let ref: string | null = null;
  try { const h = raw.includes("/") ? new URL(raw).hostname : raw; ref = /^[a-z0-9.-]{1,200}$/.test(h) && h.includes(".") && h !== new URL(req.url).hostname ? h : null; } catch {}

  const jar = cookies();
  let visitor = jar.get("hv")?.value || "";
  const fresh = !/^[a-f0-9-]{36}$/.test(visitor);
  if (fresh) visitor = randomUUID();
  const ua = req.headers.get("user-agent") || "";
  const device = /iPad|Tablet/i.test(ua) ? "tablet" : /Mobi|Android|iPhone/i.test(ua) ? "phone" : "computer";
  const country = (req.headers.get("x-vercel-ip-country") || "").slice(0, 8) || null;
  // Bots and link previews aren't people.
  if (/bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|telegrambot/i.test(ua)) return new Response(null, { status: 204 });
  const ip = clientIp(req);
  const salt = process.env.IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const ipHash = ip && ip !== "unknown" && salt ? createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32) : null;
  const user = await currentUser();
  await supabaseService().from("page_views").insert({ path, visitor, ip_hash: ipHash, user_id: user?.id ?? null, country, device, referrer: ref });
  const res = new Response(null, { status: 204 });
  if (fresh) res.headers.append("set-cookie", `hv=${visitor}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
  return res;
}
