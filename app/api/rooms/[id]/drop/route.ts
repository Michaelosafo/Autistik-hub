import { createPublicClient, getAddress, http, isAddress } from "viem";
import { json } from "@/lib/ai";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { DISPERSE, isDropChain } from "@/lib/room-drops";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function hostOf(id: string) {
  const { data } = await supabaseService().from("live_rooms").select("host_id,ended_at").eq("id", id).maybeSingle();
  return data;
}

/**
 * The room's host only. ?count=1: how many listeners connected a wallet. Otherwise: the wallets themselves, so the
 * host's wallet can send the drop (never shown in the room; the host's own wallet is left out).
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const me = await currentUser();
  if (!me) return json({ error: "Sign in first." }, 401);
  const room = await hostOf(params.id);
  if (!room || room.host_id !== me.id) return json({ error: "Only the host can send drops." }, 403);
  const { data } = await supabaseService().from("live_room_wallets").select("user_id,address").eq("room_id", params.id).neq("user_id", me.id).limit(2000);
  const wallets = [...new Set((data || []).map((r: any) => getAddress(r.address)))];
  if (new URL(req.url).searchParams.get("count")) return json({ count: wallets.length });
  return json({ count: wallets.length, recipients: wallets });
}

/** The host records a drop they sent (checked on-chain), so the room can show it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const me = await currentUser();
  if (!me) return json({ error: "Sign in first." }, 401);
  const room = await hostOf(params.id);
  if (!room || room.host_id !== me.id) return json({ error: "Only the host can send drops." }, 403);
  const b = await req.json().catch(() => ({}));
  if (!isDropChain(b.chain) || !/^0x[0-9a-fA-F]{64}$/.test(String(b.txHash)) || !(b.token === "native" || isAddress(b.token))) return json({ error: "Missing details." }, 400);
  const c = CHAINS[b.chain];
  const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
  const r = await pub.waitForTransactionReceipt({ hash: b.txHash, timeout: 30_000 }).catch(() => null);
  if (!r || r.status !== "success" || !r.to || getAddress(r.to) !== DISPERSE) return json({ error: "That transaction isn't a finished drop." }, 400);
  await supabaseService().from("live_room_drops").insert({
    room_id: params.id, host_id: me.id, chain: b.chain, token: b.token, symbol: String(b.symbol || "").slice(0, 16) || null,
    total: String(b.total || "0").slice(0, 40), recipients: Math.max(0, Math.min(100_000, Number(b.recipients) || 0)), tx_hash: b.txHash.toLowerCase(),
  }).then(() => {}, () => {});
  return json({ ok: true });
}
