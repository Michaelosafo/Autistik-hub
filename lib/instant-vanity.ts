/**
 * Instant coins on EVM chains get an address ending in "AAAA". Server only.
 *
 * The Instant launcher creates each coin with CREATE2:
 *   address = keccak256(0xff ++ launcher ++ keccak256(abi.encode(creator, salt)) ++ keccak256(creationCode ++ args))
 * so the address depends on the creator, the coin's name, ticker (and reward token on v2), and the salt. The salt is
 * part of the launch permit our server signs, so the server searches for one that gives "aaaa" at the end with all
 * four a's in capitals (EIP-55 checksum; about 1 in 16 of the "aaaa" addresses): around a million tries, a second or
 * two with keccak in WebAssembly. Before using it, the launcher's own tokenFor() confirms the address, so a mismatch
 * can never sign a wrong promise; anything unexpected falls back to a plain random salt, so launches never fail.
 */
import { randomBytes } from "crypto";
import { createKeccak } from "hash-wasm";
import { concat, createPublicClient, encodeAbiParameters, getAddress, http, keccak256, parseAbi, toHex, zeroAddress } from "viem";
import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { INSTANT_TOKEN_CODE } from "@/lib/instant-token-code";

export const INSTANT_SUFFIX = "AAAA";
const SUPPLY = 10n ** 27n;
/** Each build, found in the launcher's code by the fingerprint at the end of the coin code it carries. */
const BUILDS = [
  { tag: "v1", code: INSTANT_TOKEN_CODE.v1, hash: "a1bbee78d2b80a39c24d", reward: false },
  { tag: "v2a", code: INSTANT_TOKEN_CODE.v2a, hash: "463c2260013da12e06fa", reward: true },
  { tag: "v2", code: INSTANT_TOKEN_CODE.v2, hash: "9aa7e0a59386bf23d91f", reward: true },
] as const;
const V1_ABI = parseAbi(["function tokenFor(address creator, bytes32 salt, string name, string symbol) view returns (address)"]);
const V2_ABI = parseAbi(["function tokenFor(address creator, bytes32 salt, string name, string symbol, address rewardToken) view returns (address)"]);
const hexBytes = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

const builds = new Map<string, (typeof BUILDS)[number] | null>();
async function buildOf(chain: ChainKey, pad: `0x${string}`) {
  const key = `${chain}:${pad.toLowerCase()}`;
  if (!builds.has(key)) {
    const code = await createPublicClient({ transport: http(CHAINS[chain].rpc, { timeout: 10_000 }) }).getCode({ address: pad });
    builds.set(key, BUILDS.find((b) => code?.includes(b.hash)) ?? null);
  }
  return builds.get(key)!;
}

type Found = { salt: `0x${string}`; token: `0x${string}`; caps: boolean };

/** Searches for up to `ms` ms; returns the first capitals "AAAA", else the first mixed-case "aaaa" seen, else null. */
async function grind(pad: `0x${string}`, creator: `0x${string}`, initHash: `0x${string}`, ms: number): Promise<Found | null> {
  const k1 = await createKeccak(256), k2 = await createKeccak(256);
  // keccak256(abi.encode(creator, salt)): 12 zero bytes, the creator, then the 32-byte salt (we change its last bytes).
  const inner = new Uint8Array(64);
  inner.set(hexBytes(creator), 12);
  inner.set(randomBytes(32), 32);
  const outer = new Uint8Array(85);
  outer[0] = 0xff;
  outer.set(hexBytes(pad), 1);
  outer.set(hexBytes(initHash), 53);
  let mixed: Found | null = null;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (let i = 0; i < 20_000; i++) {
      for (let j = 63; j > 55 && ++inner[j] === 256; j--) inner[j] = 0;
      k1.init(); k1.update(inner);
      outer.set(k1.digest("binary"), 21);
      k2.init(); k2.update(outer);
      const h = k2.digest("binary");
      if (h[31] !== 0xaa || h[30] !== 0xaa) continue;
      const token = getAddress(toHex(h.subarray(12)));
      const found = { salt: toHex(inner.subarray(32)), token, caps: token.endsWith(INSTANT_SUFFIX) };
      if (found.caps) return found;
      mixed ??= found;
    }
  }
  return mixed;
}

/**
 * The salt for an Instant launch: one whose coin address ends in "AAAA" (confirmed by the launcher itself), or a
 * random one if that isn't possible. `rewardToken` is the holder-rewards token on v2 launchers (zero when off).
 */
export async function instantSalt(chain: ChainKey, pad: `0x${string}`, creator: `0x${string}`, name: string, symbol: string, rewardToken?: string | null)
  : Promise<{ salt: `0x${string}`; token: `0x${string}` | null; vanity: boolean }> {
  const random = { salt: toHex(randomBytes(32)), token: null, vanity: false };
  try {
    if (!name || !symbol) return random;
    const b = await buildOf(chain, pad);
    if (!b) return random;
    const reward = b.reward ? getAddress(rewardToken && /^0x[0-9a-fA-F]{40}$/.test(rewardToken) ? rewardToken : zeroAddress) : null;
    const args = reward
      ? encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }], [name, symbol, SUPPLY, reward])
      : encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint256" }], [name, symbol, SUPPLY]);
    const found = await grind(pad, creator, keccak256(concat([b.code, args])), 9_000);
    if (!found) return random;
    // The launcher's own answer must match, or we don't use it.
    const client = createPublicClient({ transport: http(CHAINS[chain].rpc, { timeout: 10_000 }) });
    const onChain = reward
      ? await client.readContract({ address: pad, abi: V2_ABI, functionName: "tokenFor", args: [creator, found.salt, name, symbol, reward] } as any)
      : await client.readContract({ address: pad, abi: V1_ABI, functionName: "tokenFor", args: [creator, found.salt, name, symbol] } as any);
    if (getAddress(onChain as string) !== found.token) { console.error("instant vanity: tokenFor mismatch", chain, pad); return random; }
    return { salt: found.salt, token: found.token, vanity: true };
  } catch (e) {
    console.error("instant vanity:", String((e as Error)?.message || e).slice(0, 200));
    return random;
  }
}
