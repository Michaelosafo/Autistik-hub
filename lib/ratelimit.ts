import { createHash } from "node:crypto";
import { supabaseService } from "@/lib/supabase/server";

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The visitor's IP address as Vercel reports it. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

/**
 * Allows at most `limit` requests per `windowSeconds` for this visitor (by IP, or by account when `who` is given).
 * Returns a "slow down" Response when over the limit, or null to carry on. Counting happens in the database
 * (supabase/security.sql), so it works across all of Vercel's servers. IPs are stored hashed, never as-is.
 * If the database isn't ready yet it lets the request through, so the site keeps working.
 */
export async function rateLimit(req: Request | null, name: string, limit: number, windowSeconds: number, who?: string): Promise<Response | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const id = who ? `u:${who}` : `ip:${req ? clientIp(req) : "unknown"}`;
  const key = name + ":" + createHash("sha256").update(id).digest("hex").slice(0, 32);
  try {
    const { data, error } = await supabaseService().rpc("hit_rate_limit", { p_key: key, p_limit: limit, p_window: windowSeconds });
    if (error) { console.error("rate limit check failed (has supabase/security.sql been run?):", error.message); return null; }
    if (data === false) {
      const wait = windowSeconds >= 3600 ? `${Math.round(windowSeconds / 3600)} hour${windowSeconds >= 7200 ? "s" : ""}` : windowSeconds >= 60 ? `${Math.round(windowSeconds / 60)} minute${windowSeconds >= 120 ? "s" : ""}` : "a minute";
      return new Response(JSON.stringify({ error: `Too many tries. Please wait ${wait} and try again.` }), {
        status: 429, headers: { "content-type": "application/json", "retry-after": String(windowSeconds) },
      });
    }
  } catch (e) {
    console.error("rate limit check failed:", e);
  }
  return null;
}

/** Checks a Cloudflare Turnstile "are you human" token. Passes when Turnstile isn't set up yet. */
export async function humanCheck(token: unknown, req: Request): Promise<Response | null> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return null;
  if (typeof token !== "string" || !token) return json({ error: "Please complete the \"are you human\" check, then try again." }, 400);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: clientIp(req) }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    if (d?.success) return null;
  } catch (e) {
    console.error("Turnstile check failed:", e);
  }
  return json({ error: "The \"are you human\" check didn't pass. Refresh the page and try again." }, 400);
}
