import { json } from "@/lib/ai";
import { currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TURN relay details for live rooms, so voices get through on networks that block direct connections (common on
 * mobile data). Members only. Set either:
 *  - CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN (Cloudflare Realtime TURN; short-lived credentials made here), or
 *  - TURN_URLS (comma separated, e.g. turn:x:3478,turns:x:443?transport=tcp) + TURN_USERNAME + TURN_CREDENTIAL.
 * Nothing set: an empty list, and rooms use STUN only (direct connections).
 */
let cache: { at: number; servers: any[] } | null = null;

export async function GET() {
  const user = await currentUser().catch(() => null);
  if (!user) return json({ iceServers: [] }, 401);
  if (cache && Date.now() - cache.at < 10 * 60_000) return json({ iceServers: cache.servers });
  let servers: any[] = [];
  const id = process.env.CLOUDFLARE_TURN_KEY_ID, token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (id && token) {
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 86400 }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) console.warn(`[rooms/ice] Cloudflare TURN refused (${r.status}): check CLOUDFLARE_TURN_KEY_ID / CLOUDFLARE_TURN_API_TOKEN`);
      const list = Array.isArray(j?.iceServers) ? j.iceServers : j?.iceServers ? [j.iceServers] : [];
      // Keep TURN entries only (STUN is already in the page), and skip port 53, which some browsers block.
      servers = list.map((s: any) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u: string) => /^turns?:/.test(u) && !/:53\b/.test(u)) })).filter((s: any) => s.urls.length);
    } catch { servers = []; }
  } else if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers = [{ urls: process.env.TURN_URLS.split(",").map((u) => u.trim()).filter(Boolean), username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL }];
  }
  if (servers.length) { cache = { at: Date.now(), servers }; console.log(`[rooms/ice] voice relay ready (${servers.reduce((n, x) => n + x.urls.length, 0)} routes)`); }
  else console.warn("[rooms/ice] no voice relay: calls on mobile data may not connect");
  return json({ iceServers: servers });
}
