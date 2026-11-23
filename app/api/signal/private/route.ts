import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { coinBy, cnCreate, cnQuote, cnReady, cnStatus, okAddress } from "@/lib/changenow";

/**
 * Signal's private route (owner only): coin → XMR into your own Monero wallet, or XMR → coin out to a fresh wallet,
 * through ChangeNOW deposit addresses. No keys or funds pass through the Hub; it only asks ChangeNOW for addresses
 * and status.
 *
 * POST { action: "ready" | "quote" | "create" | "status", ... }
 */
export const dynamic = "force-dynamic";

const amt = (v: unknown) => { const s = String(v ?? "").trim(); return /^\d+(\.\d+)?$/.test(s) && Number(s) > 0 ? s : null; };

export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "ready") return json({ ready: cnReady() });
    if (b.action === "status") {
      const id = String(b.id ?? "");
      if (!/^[0-9a-zA-Z]{6,40}$/.test(id)) return json({ error: "Bad swap id." }, 400);
      return json(await cnStatus(id));
    }
    const from = coinBy(String(b.from ?? "")), to = coinBy(String(b.to ?? ""));
    if (!from || !to || from.key === to.key || (from.kind !== "xmr" && to.kind !== "xmr")) return json({ error: "Pick a coin to swap with XMR." }, 400);
    const amount = amt(b.amount);
    if (!amount) return json({ error: "Enter an amount." }, 400);
    if (b.action === "quote") return json(await cnQuote(from, to, amount));
    if (b.action === "create") {
      const address = String(b.address ?? "").trim(), refund = String(b.refund ?? "").trim();
      if (!okAddress(to, address)) return json({ error: `That isn't a ${to.label.split(" · ")[1] || to.label} address.` }, 400);
      if (refund && !okAddress(from, refund)) return json({ error: `The refund address isn't a ${from.label.split(" · ")[1] || from.label} address.` }, 400);
      return json(await cnCreate(from, to, amount, address, refund || undefined));
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message.slice(0, 300) }, 502);
  }
}
