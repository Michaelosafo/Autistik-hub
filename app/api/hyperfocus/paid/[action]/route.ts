import { json } from "@/lib/ai";
import { cookies } from "next/headers";
import { APP_COOKIE } from "@/lib/android-app";

/** Paid races aren't offered in the Google Play app (Play's real-money gaming rules); the website keeps them. */
const inApp = () => cookies().get(APP_COOKIE)?.value === "android";
import { rateLimit } from "@/lib/ratelimit";
import { PRO_TOKEN } from "@/lib/pro";
import { ENTRY_USD, ROOM_SIZE, SPLIT, enabled, gameAccount, inputs, join, leave, openRoom, quote, roomView, sweep, tokenDecimals } from "@/lib/hyperfocus-paid";

// Hyperfocus GP paid races. The rules are in lib/hyperfocus-paid.ts. Entry money only moves from the player's own
// wallet (they sign it); prizes and refunds come from the game wallet through one checked queue.
// An entry's secret travels in the x-hf-secret header, never in the address, so it stays out of logs.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITS: Record<string, [number, number]> = { status: [60, 60], room: [120, 60], quote: [10, 60], join: [30, 60], inputs: [60, 60], leave: [10, 60] };

export async function GET(req: Request, { params }: { params: { action: string } }) {
  const a = params.action;
  if (a !== "status" && a !== "room") return json({ error: "Not found." }, 404);
  const limited = await rateLimit(req, `hf-paid-${a}`, ...LIMITS[a]);
  if (limited) return limited;
  if (a === "status") {
    const on = enabled() && !inApp();
    if (on) await sweep().catch(() => null);
    return json({ enabled: on, entryUsd: ENTRY_USD, roomSize: ROOM_SIZE, split: SPLIT.map(Number), marketingPct: 30, token: PRO_TOKEN, decimals: await tokenDecimals(),
      gameWallet: on ? gameAccount()!.address : null, open: on ? await openRoom().catch(() => ({ players: 0 })) : null });
  }
  const id = String(new URL(req.url).searchParams.get("id") || "");
  const entry = String(req.headers.get("x-hf-entry") || ""), secret = String(req.headers.get("x-hf-secret") || "");
  const v = await roomView(id, entry && secret ? { id: entry, secret } : undefined);
  return v ? json(v) : json({ error: "That race wasn't found." }, 404);
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const a = params.action === "finish" ? "inputs" : params.action;
  if (!["quote", "join", "inputs", "leave"].includes(a)) return json({ error: "Not found." }, 404);
  if (inApp() && (a === "quote" || a === "join")) return json({ error: "Paid races aren't available in the app. Play them on autistik.io." }, 403);
  const limited = await rateLimit(req, `hf-paid-${a}`, ...LIMITS[a]);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const id = String(b.entryId || ""), secret = String(req.headers.get("x-hf-secret") || b.secret || "");
  const r: any =
    a === "quote" ? await quote(String(b.wallet || ""), String(b.name || ""), String(b.car || ""), String(b.color || "")) :
    a === "join" ? await join(id, secret, String(b.txHash || "")) :
    a === "inputs" ? await inputs(id, secret, b.from, String(b.chunk || "")) :
    await leave(id, secret);
  return json(r, r?.error ? (r.retry ? 409 : 400) : 200);
}
