/**
 * Launch Pad v3 token addresses that end in "aaaaa" (BNB Chain, Ethereum, Robinhood Chain…). Server only.
 * A token's address is CREATE2(deployer, salt, TOKEN_INIT_HASH), so it depends only on the salt. The server finds
 * salts ahead of time (app/api/launchpad/grind-evm keeps a pool, supabase/evm-vanity.sql) and each launch takes one.
 * With an empty pool a launch searches for a few seconds itself, then uses an ordinary address, so it never fails.
 */
import { randomBytes } from "crypto";
import { keccak_256 } from "@noble/hashes/sha3";
import { createPublicClient, getAddress, http, toHex } from "viem";
import { CHAINS, EVM_VANITY_SUFFIX, LAUNCHPAD_V3_ABI, type ChainKey } from "@/lib/launchpad";
import { TOKEN_INIT_HASH } from "@/lib/launchpad-build";
import { supabaseService } from "@/lib/supabase/server";

const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));
// "aaaaa" is 5 hex characters: the last 2.5 bytes of the address (and so of the hash).
const want = hexBytes(EVM_VANITY_SUFFIX.padStart(6, "0"));

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

/** Searches for up to `ms` milliseconds for a salt whose token address ends in "aaaaa". */
export function grindSalt(deployer: string, ms: number): { salt: `0x${string}`; token: `0x${string}` } | null {
  // keccak256(0xff ++ deployer ++ salt ++ initCodeHash): only the salt's last bytes change between tries.
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(hexBytes(deployer), 1);
  buf.set(randomBytes(32), 21);
  buf.set(hexBytes(TOKEN_INIT_HASH), 53);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < 5000; i++) {
      for (let j = 52; j > 44 && ++buf[j] === 256; j--) buf[j] = 0;
      const h = keccak_256(buf);
      if (h[31] !== want[2] || h[30] !== want[1] || (h[29] & 0x0f) !== want[0]) continue;
      const token = getAddress(toHex(h.subarray(12)));
      if (token.toLowerCase().endsWith(EVM_VANITY_SUFFIX)) return { salt: toHex(buf.subarray(21, 53)), token };
    }
  }
  return null;
}

/** A salt for a new launch on a v3 Launch Pad: one giving an address ending in "aaaaa" whenever possible. */
export async function vanitySalt(chain: ChainKey, pad: string): Promise<{ salt: `0x${string}`; token: string | null; vanity: boolean }> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await supabaseService().rpc("take_vanity_salt", { p_chain: chain, p_pad: getAddress(pad) }).then((r) => r, () => ({ data: null }));
    const row = Array.isArray(data) ? data[0] : null;
    if (row?.salt && /^0x[0-9a-f]{64}$/i.test(row.salt)) return { salt: row.salt, token: row.token, vanity: true };
  }
  const deployer = await deployerOf(chain, pad).catch(() => null);
  const found = deployer ? grindSalt(deployer, 20_000) : null;
  return found ? { ...found, vanity: true } : { salt: toHex(randomBytes(32)), token: null, vanity: false };
}
