import { randomUUID } from "crypto";
import { json } from "@/lib/ai";
import { rateLimit } from "@/lib/ratelimit";
import { currentUser, supabaseService } from "@/lib/supabase/server";
import { MOMO_KOTANI_COINS, MOMO_NETWORKS, ghPhone, kotaniReady, kotaniSandbox, onrampStatus, startOnramp } from "@/lib/kotani";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Buy with MoMo (Kotani Pay). GET options: coins and networks. POST start: begin an order (the member approves on
 * their phone). POST status: where an order is. Coins only ever go to the member's own wallet address, sent from the
 * browser of the signed-in member; the cedis go to Kotani, never to AUTISTIK.
 */
export async function GET(_req: Request, { params }: { params: { action: string } }) {
  if (params.action !== "options") return json({ error: "Not found." }, 404);
  return json({ ready: kotaniReady(), sandbox: kotaniSandbox(), coins: Object.fromEntries(Object.entries(MOMO_KOTANI_COINS).map(([k, v]) => [k, { label: v.label, wallet: v.wallet }])), networks: Object.keys(MOMO_NETWORKS) });
}

export async function POST(req: Request, { params }: { params: { action: string } }) {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  const b = await req.json().catch(() => ({}));
  const sb = supabaseService();

  if (params.action === "start") {
    if (!kotaniReady()) return json({ error: "Buying with MoMo isn't switched on yet." }, 503);
    const slow = await rateLimit(req, "momo-start", 6, 3600, user.id);
    if (slow) return slow;
    const coin = MOMO_KOTANI_COINS[String(b.coin)];
    const network = MOMO_NETWORKS[String(b.network)];
    const phone = ghPhone(String(b.phone || ""));
    const name = String(b.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const ghs = Math.round(Number(b.ghs) * 100) / 100;
    if (!coin) return json({ error: "Pick a coin." }, 400);
    if (!network) return json({ error: "Pick your MoMo network." }, 400);
    if (!phone) return json({ error: "Enter your MoMo number, like 024 123 4567." }, 400);
    if (name.length < 3) return json({ error: "Enter the name on your MoMo account." }, 400);
    if (!(ghs >= 10 && ghs <= 5000)) return json({ error: "Enter between GH₵10 and GH₵5,000." }, 400);
    const address = coin.wallet === "sol" ? String(b.sol || "") : String(b.evm || "");
    if (coin.wallet === "sol" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : !/^0x[0-9a-fA-F]{40}$/.test(address)) return json({ error: coin.wallet === "sol" ? "Set up your Solana wallet first." : "Set up your wallet first." }, 400);
    // Only one open order at a time.
    const { data: open } = await sb.from("momo_orders").select("id").eq("user_id", user.id).in("status", ["pending", "paid"]).gt("created_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1);
    if (open?.length) return json({ error: "You have a MoMo payment in progress. Approve it on your phone or wait a few minutes.", id: open[0].id }, 409);
    const ref = `atk-${randomUUID()}`;
    const { data: row, error } = await sb.from("momo_orders").insert({ user_id: user.id, reference_id: ref, network: String(b.network), phone_last4: phone.slice(-4), ghs, chain: coin.chain, token: coin.token, address }).select("id").single();
    if (error) return json({ error: "Couldn't start the order." }, 500);
    try {
      const r = await startOnramp({ ref, phone, name, network, ghs, chain: coin.chain, token: coin.token, address });
      return json({ id: row.id, message: r.message, redirectUrl: r.redirectUrl });
    } catch (e: any) {
      await sb.from("momo_orders").update({ status: "failed", error: String(e?.message || "").slice(0, 160), updated_at: new Date().toISOString() }).eq("id", row.id);
      return json({ error: e?.message || "Couldn't start the MoMo payment." }, 502);
    }
  }

  if (params.action === "status") {
    const slow = await rateLimit(req, "momo-status", 60, 60, user.id);
    if (slow) return slow;
    const { data: o } = await sb.from("momo_orders").select("*").eq("id", String(b.id || "")).eq("user_id", user.id).maybeSingle();
    if (!o) return json({ error: "Order not found." }, 404);
    if (o.status === "done" || o.status === "failed") return json({ order: o });
    try {
      const s = await onrampStatus(o.reference_id);
      const up = { status: s.status, provider_status: s.raw, tx_hash: s.tx ?? o.tx_hash, crypto_amount: s.cryptoAmount ?? o.crypto_amount, error: s.error, updated_at: new Date().toISOString() };
      // An order nobody approved for 30 minutes is over.
      if (s.status === "pending" && Date.now() - Date.parse(o.created_at) > 30 * 60_000) Object.assign(up, { status: "failed", error: "The MoMo payment wasn't approved in time." });
      await sb.from("momo_orders").update(up).eq("id", o.id);
      return json({ order: { ...o, ...up } });
    } catch { return json({ order: o }); }
  }
  return json({ error: "Not found." }, 404);
}
