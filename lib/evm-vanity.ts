/**
 * Launch Pad v3 token addresses that end in "AAA" (BNB Chain, Ethereum, Robinhood Chain…). Server only.
 * A token's address is CREATE2(deployer, salt, TOKEN_INIT_HASH), so it depends only on the salt. The server finds
 * salts ahead of time (app/api/launchpad/grind-evm keeps a pool, supabase/evm-vanity.sql) and each launch takes one.
 * Suffix matching is case-insensitive. If the vanity pool is empty, the server searches and fails closed if no match is found.
 */
import { randomBytes } from "crypto";
import { createKeccak } from "hash-wasm";
import { createPublicClient, getAddress, http, toHex } from "viem";
import { CHAINS, EVM_VANITY_SUFFIX, LAUNCHPAD_V3_ABI, type ChainKey } from "@/lib/launchpad";
import { TOKEN_INIT_HASH } from "@/lib/launchpad-build";
import { supabaseService } from "@/lib/supabase/server";

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
// "aaa" is 3 hex nibbles: 0xaa in the last byte and 0xa in the low nibble before it.

const deployers = new Map<string, `0x${string}`>();
/** The token deployer behind a v3 Launch Pad (read once from the chain). */
export async function deployerOf(chain: ChainKey, pad: string) {
  const key = `${chain}:${pad.toLowerCase()}`;
  if (!deployers.has(key)) {
    const client = createPublicClient({ transport: http(CHAINS[chain].rpc, { timeout: 10_000 }) });
    deployers.set(key, getAddress(await client.readContract({ address: pad as `0x${string}`, abi: LAUNCHPAD_V3_ABI, functionName: "deployer" })));
  }
  return deployers.get(key)!;
}

type Found = { salt: `0x${string}`; token: `0x${string}`; caps: boolean };

/**
 * Searches for up to `ms` milliseconds for a salt whose token address ends in "aaa" (case-insensitive). Returns null if none is found.
 */
export async function grindSalt(deployer: string, ms: number): Promise<Found | null> {
  const keccak = await createKeccak(256);
  // keccak256(0xff ++ deployer ++ salt ++ initCodeHash): only the salt's last bytes change between tries.
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(hexBytes(deployer), 1);
  buf.set(randomBytes(32), 21);
  buf.set(hexBytes(TOKEN_INIT_HASH), 53);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < 20_000; i++) {
      for (let j = 52; j > 44 && ++buf[j] === 256; j--) buf[j] = 0;
      keccak.init();
      keccak.update(buf);
      const h = keccak.digest("binary");
      if (h[31] !== 0xaa || (h[30] & 0x0f) !== 0x0a) continue;
      const token = getAddress(toHex(h.subarray(12)));
      if (!token.toLowerCase().endsWith(EVM_VANITY_SUFFIX)) continue;
      return { salt: toHex(buf.subarray(21, 53)), token, caps: true };
    }
  }
  return null;
}

/** A salt for a new launch on a v3 Launch Pad. Never returns a salt without the required "aaa" suffix. */
export async function vanitySalt(chain: ChainKey, pad: string): Promise<{ salt: `0x${string}`; token: string | null; vanity: boolean }> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await supabaseService().rpc("take_vanity_salt", { p_chain: chain, p_pad: getAddress(pad) }).then((r) => r, () => ({ data: null }));
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.salt && /^0x[0-9a-f]{64}$/i.test(row.salt) && typeof row.token === "string" && row.token.toLowerCase().endsWith(EVM_VANITY_SUFFIX)) return { salt: row.salt, token: row.token, vanity: true };
  }
  const deployer = await deployerOf(chain, pad).catch(() => null);
  const found = deployer ? await grindSalt(deployer, Number(process.env.LAUNCH_EVM_VANITY_GRIND_MS || 120_000)) : null;
  if (!found) throw new Error('Could not generate an EVM token address ending in "AAA". Please retry; no token was created.');
  return { salt: found.salt, token: found.token, vanity: true };
}
