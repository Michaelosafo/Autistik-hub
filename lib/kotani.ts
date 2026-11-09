/**
 * Buy with MoMo, inside AUTISTIK, through Kotani Pay (a licensed on-ramp): the member types their MoMo number and
 * amount here, Kotani collects the cedis (the member approves on their phone) and sends the coins to the member's own
 * wallet address. AUTISTIK never holds the cedis or the coins.
 * Vercel: KOTANI_API_KEY (secret), KOTANI_ENV ("sandbox" or "production"). Optional KOTANI_COINS / KOTANI_NETWORKS as
 * JSON to correct the coin and MoMo network names Kotani expects. Server only.
 */
const KEY = (process.env.KOTANI_API_KEY || "").trim();
const BASE = process.env.KOTANI_ENV === "production" ? "https://api.kotanipay.com" : "https://sandbox-api.kotanipay.com";
export const kotaniReady = () => !!KEY;
export const kotaniSandbox = () => process.env.KOTANI_ENV !== "production";

const json = <T,>(name: string, fallback: T): T => { try { return { ...fallback, ...JSON.parse(process.env[name] || "{}") }; } catch { return fallback; } };
/** The coins offered: our key → Kotani's chain and token names, and which wallet receives them. */
export const MOMO_KOTANI_COINS = json("KOTANI_COINS", {
  usdt_bsc: { label: "USDT (BNB Chain)", chain: "BSC", token: "USDT", wallet: "evm" },
  usdc_base: { label: "USDC (Base)", chain: "BASE", token: "USDC", wallet: "evm" },
  usdt_sol: { label: "USDT (Solana)", chain: "SOLANA", token: "USDT", wallet: "sol" },
} as Record<string, { label: string; chain: string; token: string; wallet: "evm" | "sol" }>);
/** Ghana's MoMo networks: what people know them as → Kotani's provider name. */
export const MOMO_NETWORKS = json("KOTANI_NETWORKS", { MTN: "MTN", Telecel: "VODAFONE", AirtelTigo: "AIRTELTIGO" } as Record<string, string>);

async function kotani(path: string, init: RequestInit = {}): Promise<any> {
  if (!KEY) throw new Error("Buying with MoMo isn't switched on yet.");
  const r = await fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json", ...(init.headers || {}) }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || j?.success === false) throw new Error(String(j?.message || j?.error || `MoMo service error (${r.status})`).slice(0, 180));
  return j;
}

/** A Ghana number in international form (024 123 4567 → +233241234567). */
export function ghPhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+233")) d = d.slice(4); else if (d.startsWith("233")) d = d.slice(3); else if (d.startsWith("0")) d = d.slice(1);
  return /^[2-5]\d{8}$/.test(d) ? `+233${d}` : null;
}

/** Starts an order: Kotani asks the member to approve the MoMo payment, then sends the coins to `address`. */
export async function startOnramp(p: { ref: string; phone: string; name: string; network: string; ghs: number; chain: string; token: string; address: string; callback?: string }) {
  const j = await kotani("/api/v3/onramp", {
    method: "POST",
    body: JSON.stringify({
      mobileMoney: { phoneNumber: p.phone, accountName: p.name, providerNetwork: p.network },
      fiatAmount: p.ghs, currency: "GHS", country: "GH", chain: p.chain, token: p.token,
      receiverAddress: p.address, referenceId: p.ref, ...(p.callback ? { callbackUrl: p.callback } : {}),
    }),
  });
  const d = j?.data || {};
  return { id: String(d.id || ""), message: String(d.message || j?.message || ""), redirectUrl: (d.redirectUrl as string) || null };
}

/** Where an order is, read from Kotani: pending (waiting for the MoMo approval or the coins), done, or failed. */
export async function onrampStatus(ref: string) {
  const j = await kotani(`/api/v3/onramp/${encodeURIComponent(ref)}`);
  const d = j?.data || j || {};
  const raw = String(d.status || d.state || d.transactionStatus || "").toUpperCase();
  // The coins' transaction, wherever Kotani puts it.
  const find = (o: any, depth = 0): string | null => {
    if (!o || typeof o !== "object" || depth > 3) return null;
    for (const [k, v] of Object.entries(o)) {
      if (/hash|txid|signature/i.test(k) && typeof v === "string" && v.length > 20) return v;
      const sub = find(v, depth + 1); if (sub) return sub;
    }
    return null;
  };
  const status = /SUCCESS|COMPLETE|SETTLED|DONE|PAID_OUT/.test(raw) ? "done" : /FAIL|CANCEL|REJECT|EXPIRE|ERROR|DECLINE/.test(raw) ? "failed" : /PAID|COLLECTED|RECEIVED/.test(raw) ? "paid" : "pending";
  const amount = Number(d.cryptoAmount ?? d.amountCrypto ?? d.tokenAmount ?? NaN);
  return { status: status as "pending" | "paid" | "done" | "failed", raw, tx: find(d), cryptoAmount: isFinite(amount) ? amount : null, error: status === "failed" ? String(d.message || d.reason || raw).slice(0, 160) : null };
}
