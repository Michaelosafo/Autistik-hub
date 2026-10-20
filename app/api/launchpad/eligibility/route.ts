import { rateLimit } from "@/lib/ratelimit";
import { createPublicClient, encodeAbiParameters, formatUnits, getAddress, http, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { json } from "@/lib/ai";
import { CHAINS, MIN_HOLD_USD, type ChainKey } from "@/lib/launchpad";
import { padOn } from "@/lib/launchpad-server";
import { getMarkets } from "@/lib/market";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9") as `0x${string}`;
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]);
/** How long a permit is valid. Short, so the AUTISTIK has to still be in the wallet when the launch happens. */
const PERMIT_SECONDS = 5 * 60;

// Checks the wallet holds at least $20 of AUTISTIK on BNB Chain and, if so, signs a short-lived permit
// that the AutistikLaunchpad contract checks before it creates the token.
export async function POST(req: Request) {
  const slow = await rateLimit(req, "eligibility", 20, 600);
  if (slow) return slow;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return json({ error: "Please sign in first." }, 401);
  // Per account too, so one AUTISTIK bag can't be passed around to get permits for many wallets quickly.
  const perUser = await rateLimit(null, "eligibility-user", 10, 3600, user.id);
  if (perUser) return perUser;

  const body = await req.json().catch(() => null);
  const chain = CHAINS[body?.chain as ChainKey];
  const wallet = String(body?.wallet || "");
  const pad = chain ? await padOn(chain.key) : null;
  if (!chain || !pad) return json({ error: "That chain isn't open for launches." }, 400);
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "That isn't a wallet address." }, 400);
  const creator = getAddress(wallet);

  const key = process.env.ELIGIBILITY_SIGNER_KEY;
  // Not set up yet: the contract's eligibilitySigner should also be the zero address, so no check happens.
  if (!key) return json({ checked: false, deadline: "0", signature: "0x" });

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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + PERMIT_SECONDS);
  // Must match AutistikLaunchpad.permitHash: keccak256(abi.encode(launchpad, chainId, creator, deadline)).
  const hash = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [pad, BigInt(chain.chainId), creator, deadline],
  ));
  const signature = await privateKeyToAccount(key as `0x${string}`).signMessage({ message: { raw: hash } });
  return json({ checked: true, deadline: deadline.toString(), signature, holdUsd, needTokens });
}
