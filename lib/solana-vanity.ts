/**
 * Solana token addresses that end in "tik" (like pump.fun's "pump"). Server only.
 * A launch takes a ready address from the pool (supabase/sol-vanity.sql). If the pool is empty it searches for a
 * bounded period. It fails closed if no matching mint is found: never create a non-vanity mint for a V3 launch.
 */
import { generateKeyPairSync } from "crypto";
import { Keypair } from "@solana/web3.js";
import { supabaseService } from "@/lib/supabase/server";

export const VANITY_SUFFIX = "tik";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const MOD = 58 ** VANITY_SUFFIX.length;
// The address's last base58 characters are the public key's value mod 58^n, so the check never encodes the address.
const TARGET = [...VANITY_SUFFIX].reduce((v, ch) => v * 58 + B58.indexOf(ch), 0);

/** Searches for up to `ms` milliseconds. Node's own ed25519 is about 5x faster than generating in JavaScript. */
export function grind(ms: number): Keypair | null {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < 500; i++) {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const pub = publicKey.export({ format: "der", type: "spki" }).subarray(12);
      let r = 0;
      for (const b of pub) r = (r * 256 + b) % MOD;
      if (r !== TARGET) continue;
      const kp = Keypair.fromSeed(privateKey.export({ format: "der", type: "pkcs8" }).subarray(16));
      if (kp.publicKey.toBase58().endsWith(VANITY_SUFFIX)) return kp;
    }
  }
  return null;
}

/** A keypair for a new token's mint. Never falls back to an address without the required suffix. */
export async function vanityMint(): Promise<Keypair> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await supabaseService().rpc("take_vanity_mint").then((r) => r, () => ({ data: null }));
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.seed) {
      const kp = Keypair.fromSeed(Buffer.from(row.seed, "base64"));
      if (kp.publicKey.toBase58() === row.pubkey) return kp;
    }
  }
  const found = grind(Number(process.env.LAUNCH_SOLANA_VANITY_GRIND_MS || 120_000));
  if (!found || !found.publicKey.toBase58().endsWith(VANITY_SUFFIX)) {
    throw new Error('Could not generate a Solana mint ending in "tik". Please retry; no token was created.');
  }
  return found;
}
