import { getAddress } from "viem";
import { json } from "@/lib/ai";
import { linkBuiltinWallet } from "@/lib/privy-server";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Joining a live: every member needs a wallet so they can get the host's drops. Uses the wallet already linked to the
 * account, or links their free AUTISTIK wallet (confirmed email). If neither, the room asks them to create or connect
 * one. On success they're recorded as in the room (private: only the server reads it). The address is never returned.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return json({ error: "Unknown room." }, 404);
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const sb = supabaseService();
  const { data: room } = await sb.from("live_rooms").select("id,ended_at").eq("id", params.id).maybeSingle();
  if (!room || room.ended_at) return json({ error: "This live has ended." }, 410);
  const { data: have } = await sb.from("wallets").select("address").eq("user_id", user.id).maybeSingle();
  let address: string | null = have?.address ?? null;
  if (!address && user.email && user.email_confirmed_at) address = await linkBuiltinWallet(user.id, user.email);
  if (!address) return json({ wallet: false, canCreate: !!(user.email && user.email_confirmed_at) });
  await sb.from("live_room_members").upsert({ room_id: params.id, user_id: user.id, joined_at: new Date().toISOString() });
  const a = getAddress(address);
  return json({ wallet: true, short: `${a.slice(0, 6)}…${a.slice(-4)}`, address: a }); // only to the member themselves
}
