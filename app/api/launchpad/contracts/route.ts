import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { adminState } from "@/lib/admin";
import { json } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { CHAINS, LAUNCHPAD_ABI, LAUNCHPAD_V3_ABI, deployable, viemChain, type ChainKey } from "@/lib/launchpad";
import { padInfo } from "@/lib/launchpad-server";
import { lockerOn } from "@/lib/locker-server";
import { getMarkets } from "@/lib/market";
import { TREASURY } from "@/lib/trending";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const AUTISTIK = (process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9") as `0x${string}`;
/** Each chain's wrapped coin, for its USD price. */
const WRAPPED: Partial<Record<ChainKey, string>> = {
  bsc: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  base: "0x4200000000000000000000000000000000000006",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  polygon: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  avalanche: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  optimism: "0x4200000000000000000000000000000000000006",
};
const BURNER_ABI = parseAbi(["function router() view returns (address)", "function autistik() view returns (address)"]);
const PAD_EXTRA = parseAbi(["function deployer() view returns (address)", "function maxWhitelistNative() view returns (uint256)"]);

/** Admin only: what the deploy buttons need for a chain (prices, wallets, the locker, what's already deployed). */
export async function GET(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const chain = new URL(req.url).searchParams.get("chain") as ChainKey;
  const c = CHAINS[chain];
  if (!c || !deployable(c)) return json({ error: "That chain can't have the launchpad yet." }, 400);
  // Chains without a listed wrapped coin that use ETH (e.g. Robinhood Chain) take Ethereum's ETH price.
  const priced: ChainKey | null = WRAPPED[chain] ? chain : c.coin === "ETH" ? "ethereum" : null;
  const [info, locker, markets] = await Promise.all([padInfo(true), lockerOn(chain as any), priced ? getMarkets([{ chain: priced, token: WRAPPED[priced]! }]) : Promise.resolve({} as any)]);
  const price = priced ? markets[String(WRAPPED[priced]).toLowerCase()]?.priceUsd ?? null : null;
  const key = process.env.ELIGIBILITY_SIGNER_KEY;
  return json({
    chain, coin: c.coin, priceUsd: price, router: c.router, stablecoin: c.stablecoin, team: TREASURY ?? null, autistik: AUTISTIK,
    locker: locker?.address ?? null, signer: key ? privateKeyToAccount(key as `0x${string}`).address : "0x0000000000000000000000000000000000000000",
    pad: info.pads[chain] ?? null, padVersion: info.pads[chain] ? info.versions[chain] ?? 2 : null, burner: info.burners[chain] ?? null,
  });
}

/** Admin only: saves a launchpad or burner the admin just deployed, after checking it on-chain. */
export async function POST(req: Request) {
  if (!(await adminState()).admin) return json({ error: "Admins only." }, 403);
  const { chain, kind, address, txHash } = await req.json().catch(() => ({}));
  const c = CHAINS[chain as ChainKey];
  if (!c || !deployable(c)) return json({ error: "Unknown chain." }, 400);
  if (!isAddress(address)) return json({ error: "That isn't an address." }, 400);
  const at = getAddress(address);
  const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc, { timeout: 10_000 }) }) as any;
  const code = await pub.getCode({ address: at }).catch(() => "FAILED");
  if (code === "FAILED") return json({ error: `Couldn't reach ${c.name}. Try again in a minute.` }, 503);
  if (!code || code === "0x") return json({ error: `There's no contract at ${at} on ${c.name} yet. Wait a few seconds and try again.` }, 400);
  const sb = supabaseService();
  try {
    if (kind === "burner") {
      if (chain !== "bsc") return json({ error: "The AUTISTIK burner is only for BNB Chain." }, 400);
      const [router, autistik] = await Promise.all([pub.readContract({ address: at, abi: BURNER_ABI, functionName: "router" }), pub.readContract({ address: at, abi: BURNER_ABI, functionName: "autistik" })]);
      if (getAddress(router) !== getAddress(c.router!) || getAddress(autistik) !== getAddress(AUTISTIK)) return json({ error: "That contract isn't the AUTISTIK burner for PancakeSwap." }, 400);
      const { data: row } = await sb.from("launchpad_contracts").select("chain").eq("chain", chain).maybeSingle();
      // Remember the burner even before the launchpad exists (address is filled in when the launchpad is saved).
      if (row) await sb.from("launchpad_contracts").update({ burner: at }).eq("chain", chain);
      else await sb.from("launchpad_contracts").insert({ chain, address: "0x0000000000000000000000000000000000000000", burner: at });
    } else {
      const [owner, router, locker] = await Promise.all(["owner", "router", "locker"].map((functionName) => pub.readContract({ address: at, abi: LAUNCHPAD_ABI, functionName })));
      await pub.readContract({ address: at, abi: PAD_EXTRA, functionName: "deployer" });
      const ourLocker = await lockerOn(chain);
      if (getAddress(router) !== getAddress(c.router!)) return json({ error: "That launchpad uses a different DEX router." }, 400);
      if (!ourLocker || getAddress(locker) !== ourLocker.address) return json({ error: "That launchpad doesn't use the AUTISTIK Locker on this chain." }, 400);
      if (!TREASURY || getAddress(owner) !== getAddress(TREASURY)) return json({ error: "That launchpad isn't owned by the AUTISTIK team wallet." }, 400);
      // v3 answers tokenFor() (token addresses ending in "aaaaa"); v2 doesn't.
      const version = await pub.readContract({ address: at, abi: LAUNCHPAD_V3_ABI, functionName: "tokenFor", args: [`0x${"00".repeat(32)}`] }).then(() => 3, () => 2);
      const { error } = await sb.from("launchpad_contracts").upsert({ chain, address: at, version, tx_hash: typeof txHash === "string" ? txHash : null, deployed_at: new Date().toISOString() }, { onConflict: "chain" });
      if (error) return json({ error: "Couldn't save it. Try again." }, 500);
    }
  } catch (e) {
    console.error("launchpad save", chain, (e as Error).message);
    return json({ error: "That contract doesn't look like the AUTISTIK launchpad. Check the address." }, 400);
  }
  await padInfo(true);
  logActivity((await currentUser())?.id, "launchpad", `${kind === "burner" ? "Burner" : "Launchpad"} deployed on ${c.name}`, "/launchpad/new");
  return json({ ok: true, address: at });
}
