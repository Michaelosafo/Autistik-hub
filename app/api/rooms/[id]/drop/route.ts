import { createPublicClient, getAddress, http, isAddress } from "viem";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { DISPERSE, isDropChain } from "@/lib/room-drops";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The room and whether the signed-in member runs it (host or co-host) or is in it. */
async function access(id: string) {
  const me = await currentUser();
  if (!me) return { me: null, room: null, runs: false, inRoom: false };
  const sb = supabaseService();
  const [{ data }, { data: m }] = await Promise.all([
    sb.from("live_rooms").select("host_id,cohosts,ended_at").eq("id", id).maybeSingle(),
    sb.from("live_room_members").select("user_id").eq("room_id", id).eq("user_id", me.id).maybeSingle(),
  ]);
  const runs = !!data && (data.host_id === me.id || (data.cohosts || []).includes(me.id));
  return { me, room: data, runs, inRoom: runs || !!m };
}

/**
 * Everyone who joined the room has a wallet linked to their account (the join gate makes sure).
 * ?user=ID: one person's wallet, so anyone in the room can send them tokens (tap their picture, or Send in their wallet).
 * ?count=1 / no query: everyone's wallets, for the host and co-hosts to drop to the whole room at once.
 * Addresses are only handed to the sender's own browser for the transaction, never shown in the room.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const { me, room, runs, inRoom } = await access(params.id);
  if (!me) return json({ error: "Sign in first." }, 401);
  if (!room || !inRoom) return json({ error: "Join the live first." }, 403);
  const sb = supabaseService();
  const q = new URL(req.url).searchParams;
  const one = q.get("user");
  if (!one && !runs) return json({ error: "Only the host and co-hosts can send to everyone at once." }, 403);
  let ids: string[];
  if (one) {
    if (!UUID.test(one)) return json({ error: "Unknown person." }, 400);
    const slow = await rateLimit(req, "room-send-to", 40, 600, me.id);
    if (slow) return slow;
    const { data: there } = await sb.from("live_room_members").select("user_id").eq("room_id", params.id).eq("user_id", one).maybeSingle();
    const { data: r } = await sb.from("live_rooms").select("host_id,cohosts").eq("id", params.id).maybeSingle();
    if (!there && r?.host_id !== one && !(r?.cohosts || []).includes(one)) return json({ error: "That person isn't in this live." }, 404);
    ids = [one];
  } else {
    const { data } = await sb.from("live_room_members").select("user_id").eq("room_id", params.id).limit(5000);
    ids = (data || []).map((r: any) => r.user_id);
  }
  ids = ids.filter((x) => x !== me.id);
  const rows: { user_id: string; address: string }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb.from("wallets").select("user_id,address").in("user_id", ids.slice(i, i + 500));
    rows.push(...((data || []) as any[]));
  }
  // Older rooms: wallets people connected in the room before the join gate.
  if (!one) {
    const { data: extra } = await sb.from("live_room_wallets").select("user_id,address").eq("room_id", params.id).neq("user_id", me.id);
    for (const r of (extra || []) as any[]) if (!rows.some((x) => x.user_id === r.user_id)) rows.push(r);
  }
  const wallets = [...new Set(rows.filter((r) => isAddress(r.address)).map((r) => getAddress(r.address)))];
  if (q.get("count")) return json({ count: wallets.length });
  if (one && !wallets.length) return json({ error: "This person has no wallet linked yet." }, 404);
  return json({ count: wallets.length, recipients: wallets });
}

/** The sender records a send (checked on-chain), so the room can show it. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const { me, room, inRoom } = await access(params.id);
  if (!me) return json({ error: "Sign in first." }, 401);
  if (!room || !inRoom) return json({ error: "Join the live first." }, 403);
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
