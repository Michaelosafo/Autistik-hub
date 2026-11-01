import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { PRO_TOKEN } from "@/lib/pro";
import { ENTRY_USD, ROOM_SIZE, SPLIT, finish, gameAccount, join, leave, openRoom, quote, roomView, tokenDecimals } from "@/lib/hyperfocus-paid";

// Hyperfocus GP paid races. Read the rules in lib/hyperfocus-paid.ts. Entry money only moves from the player's own
// wallet (they sign it); payouts and refunds come from the game wallet.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMITS: Record<string, [number, number]> = { status: [60, 60], room: [120, 60], quote: [10, 60], join: [20, 60], finish: [10, 60], leave: [10, 60] };

export async function GET(req: Request, { params }: { params: { action: string } }) {
  const a = params.action;
  if (a !== "status" && a !== "room") return json({ error: "Not found." }, 404);
  const limited = await rateLimit(req, `hf-paid-${a}`, ...LIMITS[a]);
  if (limited) return limited;
  const u = new URL(req.url);
  if (a === "status") {
    const g = gameAccount();
    return json({ enabled: !!g, entryUsd: ENTRY_USD, roomSize: ROOM_SIZE, split: SPLIT.map(Number), marketingPct: 30, token: PRO_TOKEN, decimals: await tokenDecimals(), gameWallet: g?.address ?? null, open: g ? await openRoom().catch(() => ({ players: 0 })) : null });
  }
  const id = String(u.searchParams.get("id") || ""), entry = String(u.searchParams.get("entry") || ""), secret = String(u.searchParams.get("secret") || "");
  const v = await roomView(id, entry && secret ? { id: entry, secret } : undefined);
  return v ? json(v) : json({ error: "That race wasn't found." }, 404);
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const a = params.action;
  if (!["quote", "join", "finish", "leave"].includes(a)) return json({ error: "Not found." }, 404);
  const limited = await rateLimit(req, `hf-paid-${a}`, ...LIMITS[a]);
  if (limited) return limited;
  const b = await req.json().catch(() => ({}));
  const r: any =
    a === "quote" ? await quote(String(b.wallet || ""), String(b.name || ""), String(b.car || ""), String(b.color || "")) :
    a === "join" ? await join(String(b.entryId || ""), String(b.secret || ""), String(b.txHash || "")) :
    a === "finish" ? await finish(String(b.entryId || ""), String(b.secret || ""), String(b.inputs || "")) :
    await leave(String(b.entryId || ""), String(b.secret || ""));
  return json(r, r?.error ? (r.retry ? 409 : 400) : 200);
}
