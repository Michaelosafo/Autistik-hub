/**
 * AUTISTIK Chain admin API: the site OWNER only (with their 2-step code done).
 * GET  status | blocks | activity | validators | account?address= | tx?hash=
 * POST mint | transfer | validator | activity | name   (signed with CHAIN_OWNER_KEY on the server)
 */
import { adminState } from "@/lib/admin";
import { chainGet, chainReady, ownerReady, ownerSend, toUnits, addressOf, ownerPubHex } from "@/lib/chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const addrOk = (a: unknown) => typeof a === "string" && /^atk[0-9a-f]{40}$/.test(a);

async function ownerOnly() {
  const s = await adminState();
  return s.owner && s.staff;
}

export async function GET(req: Request, { params }: { params: { action: string } }) {
  if (!(await ownerOnly())) return json({ error: "Owner only." }, 403);
  if (!chainReady()) return json({ setup: true, ownerKey: ownerReady() });
  const q = new URL(req.url).searchParams;
  try {
    switch (params.action) {
      case "status": {
        const st = await chainGet("/status");
        const fund = await chainGet(`/account/${st.fund}`).catch(() => null);
        return json({ ...st, fund_balance: fund?.balance ?? null, owner_key: ownerReady(), owner_matches: ownerReady() ? addressOf(ownerPubHex()) === st.owner : null });
      }
      case "blocks": return json(await chainGet(`/blocks?limit=${Math.min(100, Number(q.get("limit")) || 20)}`));
      case "activity": {
        const p = new URLSearchParams();
        for (const k of ["kind", "type", "address"]) if (q.get(k)) p.set(k, q.get(k)!);
        p.set("limit", String(Math.min(200, Number(q.get("limit")) || 50)));
        return json(await chainGet(`/activity?${p}`));
      }
      case "validators": return json(await chainGet("/validators"));
      case "account": {
        const a = q.get("address") || "";
        if (!addrOk(a) && !/^@[a-z0-9_]{3,20}$/.test(a)) return json({ error: "Type an atk… address or @name." }, 400);
        return json(await chainGet(`/account/${encodeURIComponent(a)}`));
      }
      case "tx": {
        const h = q.get("hash") || "";
        if (!/^[0-9a-f]{64}$/.test(h)) return json({ error: "Not a transaction hash." }, 400);
        return json(await chainGet(`/tx/${h}`));
      }
    }
    return json({ error: "Unknown." }, 404);
  } catch (e) { return json({ error: (e as Error).message }, 502); }
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  if (!(await ownerOnly())) return json({ error: "Owner only." }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    switch (params.action) {
      case "mint":
      case "transfer": {
        if (!addrOk(b.to)) return json({ error: "Type a valid atk… address." }, 400);
        const amount = toUnits(b.amount);
        if (amount <= 0n) return json({ error: "Amount must be above 0." }, 400);
        return json({ ok: true, ...(await ownerSend({ type: params.action, to: b.to, amount })) });
      }
      case "validator": {
        if (!/^[0-9a-f]{64}$/.test(String(b.pubkey || ""))) return json({ error: "Paste the validator's 64-character public key." }, 400);
        const power = Math.floor(Number(b.power));
        if (!(power >= 0 && power <= 1000)) return json({ error: "Power must be 0 (remove) to 1000." }, 400);
        return json({ ok: true, ...(await ownerSend({ type: "validator", data: b.pubkey, power })) });
      }
      case "activity": {
        const kind = String(b.kind || "other");
        if (!["game", "buy", "sell", "post", "tip", "stake", "reward", "donate", "other"].includes(kind)) return json({ error: "Unknown kind." }, 400);
        return json({ ok: true, ...(await ownerSend({ type: "activity", kind, data: String(b.data || "").slice(0, 500) })) });
      }
      case "name": {
        if (!/^[a-z0-9_]{3,20}$/.test(String(b.name || ""))) return json({ error: "3–20 of a-z, 0-9, _" }, 400);
        return json({ ok: true, ...(await ownerSend({ type: "name", data: b.name })) });
      }
    }
    return json({ error: "Unknown." }, 404);
  } catch (e) { return json({ error: (e as Error).message }, 400); }
}
