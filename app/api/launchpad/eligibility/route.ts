import { rateLimit } from "@/lib/ratelimit";
import { namesTaken, takenError } from "@/lib/launch-names";
import { createPublicClient, encodeAbiParameters, formatUnits, getAddress, http, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { json } from "@/lib/ai";
import { CHAINS, MIN_HOLD_USD, type ChainKey } from "@/lib/launchpad";
import { padOn, padVersion } from "@/lib/launchpad-server";
import { vanitySalt } from "@/lib/evm-vanity";
import { getMarkets } from "@/lib/market";
import { supabaseServer, currentUser } from "@/lib/supabase/server";
import { adminState, launchAccess } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9") as `0x${string}`;
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
/** How long a permit is valid. Short, so the AUTISTIK has to still be in the wallet when the launch happens. */
const PERMIT_SECONDS = 5 * 60;

// Checks the wallet holds at least $20 of AUTISTIK on BNB Chain and, if so, signs a short-lived permit
// that the AutistikLaunchpad contract checks before it creates the token. The admin (owner with the 2-step code)
// gets a permit without holding any AUTISTIK, for as many launches as they like.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "eligibility", 20, 600);
  if (slow) return slow;
  if (!(await launchAccess()).allowed) return json({ error: "The Launch Pad is coming soon." }, 403);
  const user = await currentUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  const { admin } = await adminState();
  // Per account too, so one AUTISTIK bag can't be passed around to get permits for many wallets quickly.
  if (!admin) {
    const perUser = await rateLimit(null, "eligibility-user", 10, 3600, user.id);
    if (perUser) return perUser;
  }

  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const wallet = String(body?.wallet || "");
  const pad = chain ? await padOn(chain.key) : null;
  if (!chain || !pad) return json({ error: "That chain isn't open for launches." }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "That isn't a wallet address." }, 400);
  const creator = getAddress(wallet);
  // Each name and ticker launches only once here.
  if (body?.name || body?.symbol) {
    const t = takenError(await namesTaken(String(body.name || ""), String(body.symbol || "")));
    if (t) return json({ error: t }, 409);
  }

  const key = process.env.ELIGIBILITY_SIGNER_KEY;
  // Launch Pad v3: the salt that gives this launch a token address ending in "aaaaa" (taken only when it's needed).
  const version = await padVersion(chain.key);
  const salt = async () => (version >= 3 ? await vanitySalt(chain.key, pad, version) : null);
  // Not set up yet: the contract's eligibilitySigner should also be the zero address, so no check happens.
  if (!key) {
    const s = await salt();
    return json({ checked: false, deadline: "0", signature: "0x", padVersion: version, ...(s && { salt: s.salt, token: s.token }) });
  }
  if (admin) return json({ checked: true, admin: true, padVersion: version, ...(await permit(key, pad, chain.chainId, creator, await salt())) });

  const bsc = createPublicClient({ transport: http(CHAINS.bsc.rpc) });
  let balance: bigint, decimals: number;
  try {
    [balance, decimals] = await Promise.all([
      bsc.readContract({ address: TOKEN, abi: ERC20, functionName: "balanceOf", args: [creator] } as any) as Promise<bigint>,
      bsc.readContract({ address: TOKEN, abi: ERC20, functionName: "decimals" } as any) as Promise<number>,
    ]);
  } catch {
    return json({ error: "Couldn't read your AUTISTIK balance right now. Try again in a minute." }, 502);
  }

  const price = (await getMarkets([{ chain: "bsc", token: TOKEN }]))[TOKEN.toLowerCase()]?.priceUsd ?? null;
  if (!price) return json({ error: "Couldn't get the AUTISTIK price right now. Try again in a minute." }, 502);

  const tokens = Number(formatUnits(balance, Number(decimals)));
  const holdUsd = tokens * price;
  const needTokens = Math.ceil(MIN_HOLD_USD / price);
  if (holdUsd < MIN_HOLD_USD) {
    return json({
      error: `This wallet holds $${holdUsd.toFixed(2)} of AUTISTIK on BNB Chain. You need at least $${MIN_HOLD_USD} (about ${needTokens.toLocaleString("en-US")} AUTISTIK) in this same wallet to launch.`,
      holdUsd, needTokens,
    }, 403);
  }

  return json({ checked: true, padVersion: version, ...(await permit(key, pad, chain.chainId, creator, await salt())), holdUsd, needTokens });
}

/**
 * A one-use permit for `creator` to launch on `pad`, valid for PERMIT_SECONDS. On a v3 Launch Pad it also covers the
 * salt, so the address ending in "aaaaa" that the salt gives can only be used by this creator.
 */
async function permit(key: string, pad: `0x${string}`, chainId: number, creator: `0x${string}`, s: { salt: `0x${string}`; token: string | null } | null) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_SECONDS);
  // Must match permitHash: v2 keccak256(abi.encode(launchpad, chainId, creator, deadline)),
  // v3 keccak256(abi.encode(launchpad, chainId, creator, salt, deadline)).
  const hash = s
    ? keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "uint256" }],
      [pad, BigInt(chainId), creator, s.salt, deadline],
    ))
    : keccak256(encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
      [pad, BigInt(chainId), creator, deadline],
    ));
  const signature = await privateKeyToAccount(key as `0x${string}`).signMessage({ message: { raw: hash } });
  return { deadline: deadline.toString(), signature, ...(s && { salt: s.salt, token: s.token }) };
}
