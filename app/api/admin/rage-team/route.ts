import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { addWallet, clearCurrent, deleteCa, removeWallet, revealWallet, saveCa, sendFromTeam, teamState } from "@/lib/rage-team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * BnbRage, shared: the owner and every helper admin (after the 2-step code) see and use the same team wallets and
 * the same CA list. Helpers have the owner's full access here, including removing a wallet and showing its private key.
 */
async function who(): Promise<{ ok: boolean; owner: boolean; name: string }> {
  const s = await adminState();
  if (!s.staff) return { ok: false, owner: false, name: "" };
  const { data: { user } } = await supabaseServer().auth.getUser();
  let name = s.owner ? "Owner" : "Admin";
  if (user) {
    const { data } = await supabaseService().from("profiles").select("alias").eq("id", user.id).maybeSingle();
    if (data?.alias) name = `${data.alias}${s.owner ? " (owner)" : ""}`;
  }
  return { ok: true, owner: s.owner && s.admin, name };
}

export async function GET() {
  const me = await who();
  if (!me.ok) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  try { return json({ ...(await teamState()), owner: me.owner }); }
  catch (e) { return json({ error: (e as Error).message }, 500); }
}

export async function POST(req: Request) {
  const slow = await rateLimit(req, "admin-rage-team", 60, 60);
  if (slow) return slow;
  const me = await who();
  if (!me.ok) return json({ error: "Admins only. Open the Admin page and enter your 2-step code first." }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    switch (String(b?.action || "")) {
      case "add": return json(await addWallet(me.name, b.key ? String(b.key) : undefined, b.label ? String(b.label) : undefined));
      case "remove":
        await removeWallet(me.name, b.slot); return json({ ok: true });
      case "reveal":
        return json({ key: await revealWallet(me.name, b.slot) });
      case "send": return json({ hash: await sendFromTeam(me.name, b.slot, { to: b.to ?? null, data: b.data, value: b.value }) });
      case "save-ca": await saveCa(me.name, String(b.address || ""), b.name, b.symbol); return json({ ok: true });
      case "clear-current": await clearCurrent(); return json({ ok: true });
      case "del-ca": await deleteCa(String(b.address || "")); return json({ ok: true });
      default: return json({ error: "Unknown." }, 404);
    }
  } catch (e) {
    return json({ error: (e as any)?.shortMessage || (e as Error).message || "Something went wrong." }, 400);
  }
}
