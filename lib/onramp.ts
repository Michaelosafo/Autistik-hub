/**
 * Buy crypto with MoMo (MTN MoMo, Telecel Cash, AirtelTigo Money) through Onramper, which routes the order to licensed
 * on-ramp companies (Yellow Card and others). AUTISTIK never holds anyone's cedis or coins: the member pays the
 * provider, the provider checks their ID, and the coins go straight to the member's own wallet address.
 * Set ONRAMPER_API_KEY (pk_prod_…) and ONRAMPER_SIGNING_KEY (the Ed25519 private key, PEM, whose public half is
 * registered in the Onramper dashboard) in Vercel. Pre-filled wallet addresses must be signed, or Onramper rejects
 * the order. Server only.
 */
import { createPrivateKey, randomUUID, sign } from "crypto";

const API_KEY = (process.env.ONRAMPER_API_KEY || "").trim();
const SIGNING_KEY = (process.env.ONRAMPER_SIGNING_KEY || "").replace(/\\n/g, "\n").trim();
export const momoReady = () => !!API_KEY && !!SIGNING_KEY;

/** The coins offered, with Onramper's ids. Onramper's ids can be corrected here (or with ONRAMPER_IDS as JSON). */
export const MOMO_COINS = { usdt_bsc: "USDT (BNB Chain)", bnb_bsc: "BNB", usdt_sol: "USDT (Solana)", sol: "SOL" } as const;
export type MomoCoin = keyof typeof MOMO_COINS;
const IDS: Record<MomoCoin, { crypto: string; net: string; chain: "evm" | "sol" }> = {
  usdt_bsc: { crypto: "usdt_bsc", net: "BSC", chain: "evm" },
  bnb_bsc: { crypto: "bnb_bsc", net: "BSC", chain: "evm" },
  usdt_sol: { crypto: "usdt_sol", net: "SOLANA", chain: "sol" },
  sol: { crypto: "sol", net: "SOLANA", chain: "sol" },
  ...(() => { try { return JSON.parse(process.env.ONRAMPER_IDS || "{}"); } catch { return {}; } })(),
};

/** Onramper's URL signature, version 2 (Ed25519 over a canonical request). */
function signV2(fields: Record<string, string>) {
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const expiry = new Date(Date.now() + 15 * 60_000).toISOString();
  const query = new URLSearchParams(fields);
  query.sort();
  const canonical = ["ONRAMPER-SIG-V2", timestamp, nonce, "GET", "/", query.toString(), "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"].join("\n");
  const sig = sign(null, Buffer.from(canonical), createPrivateKey(SIGNING_KEY)).toString("base64");
  return { sigV2: `v2:${sig}`, sigV2Timestamp: timestamp, sigV2Nonce: nonce, sigV2Expiry: expiry, sigV2Fields: [...new Set([...query.keys()])].sort().join(",") };
}

/** The checkout link: cedis amount, coin, and the member's own wallet already filled in (signed, so it can't be changed). */
export function momoLink(p: { coin: MomoCoin; ghs: number; evm: string | null; sol: string | null; ref: string }): string {
  if (!momoReady()) throw new Error("Buying with MoMo isn't switched on yet.");
  const id = IDS[p.coin];
  const addr = id.chain === "sol" ? p.sol : p.evm;
  if (!addr) throw new Error(id.chain === "sol" ? "Set up your Solana wallet first." : "Set up your wallet first.");
  const signed: Record<string, string> = { apiKey: API_KEY, defaultAmount: String(Math.round(p.ghs)), networkWallets: `${id.net}:${addr}` };
  const url = new URL("https://buy.onramper.com/");
  for (const [k, v] of Object.entries({ ...signed, ...signV2(signed), mode: "buy", defaultFiat: "GHS", defaultCrypto: id.crypto, onlyCryptos: id.crypto, partnerContext: p.ref })) url.searchParams.set(k, v);
  return url.toString();
}
