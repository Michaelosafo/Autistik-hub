/**
 * AUTISTIK Chain, server side only: talks to a node's RPC and signs the owner's transactions.
 * Set in Vercel: CHAIN_RPC_URL (e.g. https://rpc.autistik.io) and CHAIN_OWNER_KEY (the owner's 32-byte hex seed from
 * `autd keygen`). The key never reaches the browser; only the site owner can use it, through /api/chain.
 * Signing must match chain/core/types.go (SignBytes) exactly.
 */
import { createHash, createPrivateKey, sign as edSign } from "crypto";

export const UNIT = 1_000_000_000n; // 1 ATK
export const chainRpc = () => (process.env.CHAIN_RPC_URL || "").trim().replace(/\/+$/, "");
const ownerSeed = () => (process.env.CHAIN_OWNER_KEY || "").trim().toLowerCase().replace(/^0x/, "");
export const chainReady = () => !!chainRpc();
export const ownerReady = () => /^[0-9a-f]{64}$/.test(ownerSeed());

export type ChainTx = { type: string; pubkey: string; nonce: number; fee: number; to?: string; amount?: number; kind?: string; data?: string; power?: number; sig: string };

function ownerKey() {
  // ed25519 private key from its 32-byte seed (PKCS#8 wrapper).
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(ownerSeed(), "hex")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function ownerPubHex(): string {
  const jwk = ownerKey().export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export function addressOf(pubHex: string): string {
  const h = createHash("sha256").update(Buffer.concat([Buffer.from("AUTISTIK-ADDR"), Buffer.from(pubHex, "hex")])).digest("hex");
  return "atk" + h.slice(0, 40);
}

export function signBytes(chainId: string, t: Omit<ChainTx, "sig">): Buffer {
  return Buffer.from([
    "AUTISTIK-TX/1", chainId, t.type, t.pubkey.toLowerCase(), String(t.nonce), String(t.fee), (t.to || "").toLowerCase(), String(t.amount || 0),
    t.kind || "", Buffer.from(t.data || "", "utf8").toString("hex"), String(t.power || 0),
  ].join("\n"));
}

async function rpc<T>(path: string, init?: RequestInit): Promise<T> {
  const base = chainRpc();
  if (!base) throw new Error("CHAIN_RPC_URL isn't set in Vercel yet.");
  const r = await fetch(base + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any).error || `Node answered ${r.status}`);
  return j as T;
}
export const chainGet = <T = any>(path: string) => rpc<T>(path);

/** Sign a transaction with the owner key and send it. Amounts are in units (1 ATK = 1e9). */
export async function ownerSend(t: { type: string; to?: string; amount?: bigint; kind?: string; data?: string; power?: number }) {
  if (!ownerReady()) throw new Error("CHAIN_OWNER_KEY isn't set in Vercel.");
  const pub = ownerPubHex();
  const [st, acct] = await Promise.all([rpc<{ chain_id: string; min_fee: number; owner: string }>("/status"), rpc<{ next_nonce: number }>(`/account/${addressOf(pub)}`)]);
  if (st.owner !== addressOf(pub)) throw new Error("CHAIN_OWNER_KEY is not the chain's owner key.");
  const amount = t.amount ?? 0n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Amount too large for one transaction.");
  const tx: Omit<ChainTx, "sig"> = { type: t.type, pubkey: pub, nonce: acct.next_nonce, fee: st.min_fee, ...(t.to ? { to: t.to } : {}), ...(amount ? { amount: Number(amount) } : {}), ...(t.kind ? { kind: t.kind } : {}), ...(t.data ? { data: t.data } : {}), ...(t.power ? { power: t.power } : {}) };
  const sig = edSign(null, signBytes(st.chain_id, tx), ownerKey()).toString("hex");
  return rpc<{ hash: string }>("/tx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...tx, sig }) });
}

/** "12.5" ATK → units. */
export function toUnits(atk: string | number): bigint {
  const s = String(atk).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new Error("Type an amount like 100 or 2.5");
  const [w, f = ""] = s.split(".");
  return BigInt(w) * UNIT + BigInt((f + "000000000").slice(0, 9));
}
