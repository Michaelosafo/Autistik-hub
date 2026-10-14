import { verifyMessage, getAddress } from "viem";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { json } from "@/lib/ai";
import { linkMessage } from "@/lib/wallet";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  const body = await req.json().catch(() => null);
  const address = String(body?.address || "");
  const issued = String(body?.issued || "");
  const signature = String(body?.signature || "") as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return json({ error: "That isn't a BNB Chain address." }, 400);
  const age = Date.now() - Date.parse(issued);
  if (!(age >= 0 && age < 10 * 60 * 1000)) return json({ error: "That signature has expired. Try again." }, 400);

  const ok = await verifyMessage({ address: getAddress(address), message: linkMessage(user.id, issued), signature }).catch(() => false);
  if (!ok) return json({ error: "The signature didn't match that wallet." }, 400);

  const { error } = await supabaseService().from("wallets").upsert({ user_id: user.id, address: getAddress(address), verified_at: new Date().toISOString() });
  if (error) {
    if (String(error.message).includes("duplicate") || error.code === "23505") return json({ error: "That wallet is already linked to another Hub account." }, 409);
    return json({ error: "Couldn't save your wallet. Try again." }, 500);
  }
  return json({ address: getAddress(address) });
}
