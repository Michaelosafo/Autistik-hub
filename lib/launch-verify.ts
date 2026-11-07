/**
 * Publishes a Launch Pad token's source code on its chain's explorer (BscScan, Etherscan, BaseScan…), so wallets and
 * scanners show it as open source. Every token is the same AutistikToken code. Launch Pad v2 tokens
 * (contracts/AutistikLaunchpadV2.sol) differ only in their constructor settings, rebuilt from the launch transaction
 * and the token itself; Launch Pad v3 tokens (contracts/AutistikLaunchpadV3.sol) have no constructor settings at all.
 * Etherscan-family explorers need ETHERSCAN_API_KEY in Vercel (one key from etherscan.io covers them all); Blockscout
 * explorers (Robinhood Chain) take the same calls on their own /api with no key. Server only.
 */
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress, http, parseAbi, parseEventLogs } from "viem";
import { CHAINS, LAUNCHPAD_ABI, LAUNCHPAD_V3_ABI, type ChainKey } from "@/lib/launchpad";
import { PAD_COMPILER } from "@/lib/launchpad-build";
import { supabaseService } from "@/lib/supabase/server";
import input from "@/contracts/AutistikLaunchpadV2.input.json";
import inputV3 from "@/contracts/AutistikLaunchpadV3.input.json";
import instantV1 from "@/contracts/AutistikInstantLaunch.input.json";
import instantV2 from "@/contracts/AutistikInstantLaunchV2.input.json";
import instantV2a from "@/contracts/AutistikInstantLaunchV2-143938f.input.json";
import { INSTANT_COMPILER } from "@/lib/instant-build";

/**
 * Instant coins: every build of the Instant launcher that's on-chain, matched by the fingerprint (metadata hash) solc
 * puts at the end of the coin's code. The v2 launchers deployed on BNB Chain and Ethereum were built from commit
 * 143938f, so their coins need that exact source; newer deployments use the current file.
 */
const INSTANT_BUILDS = [
  { hash: "a1bbee78d2b80a39c24d", input: instantV1, name: "AutistikInstantLaunch.sol:AutistikInstantToken", reward: false },
  { hash: "463c2260013da12e06fa", input: instantV2a, name: "src/AutistikInstantLaunchV2.sol:AutistikInstantTokenV2", reward: true },
  { hash: "9aa7e0a59386bf23d91f", input: instantV2, name: "src/AutistikInstantLaunchV2.sol:AutistikInstantTokenV2", reward: true },
];
const INSTANT_SUPPLY = 10n ** 27n; // 1,000,000,000 coins with 18 decimals (SUPPLY in both contracts)
const INSTANT_READS = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function rewardToken() view returns (address)"]);

/** If this is an Instant coin, the source, contract name and constructor arguments to publish for it. */
async function instantSource(chain: ChainKey, token: `0x${string}`) {
  const client = createPublicClient({ transport: http(CHAINS[chain].rpc) });
  const code = await client.getCode({ address: token });
  if (!code) return null;
  const i = code.lastIndexOf("a2646970667358221220");
  const b = i >= 0 ? INSTANT_BUILDS.find((x) => code.slice(i + 20, i + 40) === x.hash) : null;
  if (!b) return null;
  const read = (functionName: "name" | "symbol" | "rewardToken") => client.readContract({ address: token, abi: INSTANT_READS, functionName } as any) as Promise<any>;
  const [name, symbol, reward] = await Promise.all([read("name"), read("symbol"), b.reward ? read("rewardToken") : Promise.resolve(null)]);
  const args = b.reward
    ? encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint256" }, { type: "address" }], [name, symbol, INSTANT_SUPPLY, reward])
    : encodeAbiParameters([{ type: "string" }, { type: "string" }, { type: "uint256" }], [name, symbol, INSTANT_SUPPLY]);
  return { input: b.input, name: b.name, args: args.slice(2) };
}

const API = "https://api.etherscan.io/v2/api";
const TOKEN_READS = parseAbi([
  "function pad() view returns (address)", "function router() view returns (address)",
  "function platformFee() view returns (uint256)", "function wlMaxTokens() view returns (uint256)",
]);
const INIT = [{ type: "tuple", components: [
  { name: "pad", type: "address" }, { name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "supply", type: "uint256" },
  { name: "router", type: "address" }, { name: "creator", type: "address" }, { name: "taxWallet", type: "address" },
  { name: "buyTax", type: "uint256" }, { name: "sellTax", type: "uint256" }, { name: "platformFee", type: "uint256" },
  { name: "whitelist", type: "address[]" }, { name: "wlMaxTokens", type: "uint256" },
] }] as const;

const key = () => (process.env.ETHERSCAN_API_KEY || "").trim();
const blockscout = (chain: ChainKey) => CHAINS[chain].explorer.includes("blockscout");
/** The explorer's API address, or null when it can't be used (Etherscan without a key). */
function api(chain: ChainKey) {
  const c = CHAINS[chain];
  if (blockscout(chain)) return { url: `${c.explorer}/api`, q: "" };
  return key() ? { url: API, q: `chainid=${c.chainId}&apikey=${key()}&` } : null;
}
const explorerName = (chain: ChainKey) => `${CHAINS[chain].name} explorer`;

/** The token's constructor arguments (hex, no 0x), rebuilt from the launch transaction and the token's own settings. */
async function constructorArgs(chain: ChainKey, token: `0x${string}`, txHash: `0x${string}`) {
  const c = CHAINS[chain];
  const client = createPublicClient({ transport: http(c.rpc) });
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  const { args } = decodeFunctionData({ abi: LAUNCHPAD_ABI, data: tx.input }) as any;
  const p = args[0];
  const ev = parseEventLogs({ abi: LAUNCHPAD_ABI, logs: receipt.logs, eventName: "Launched" }).find((l) => getAddress(l.args.token) === token);
  if (!ev) throw new Error("That transaction didn't launch this token.");
  const read = (functionName: "pad" | "router" | "platformFee" | "wlMaxTokens") => client.readContract({ address: token, abi: TOKEN_READS, functionName } as any) as Promise<any>;
  const [pad, router, platformFee, wlMaxTokens] = await Promise.all([read("pad"), read("router"), read("platformFee"), read("wlMaxTokens")]);
  return encodeAbiParameters(INIT, [{
    pad, name: p.name, symbol: p.symbol, supply: p.supply, router, creator: ev.args.creator, taxWallet: p.taxWallet,
    buyTax: p.buyTax, sellTax: p.sellTax, platformFee, whitelist: p.whitelist, wlMaxTokens,
  }]).slice(2);
}

/** A Launch Pad v3 token: its launchpad answers tokenFor(), which v2 doesn't have. */
async function isV3Token(chain: ChainKey, token: `0x${string}`) {
  const client = createPublicClient({ transport: http(CHAINS[chain].rpc) });
  const pad = (await client.readContract({ address: token, abi: TOKEN_READS, functionName: "pad" } as any)) as `0x${string}`;
  return client.readContract({ address: pad, abi: LAUNCHPAD_V3_ABI, functionName: "tokenFor", args: [`0x${"00".repeat(32)}`] }).then(() => true, () => false);
}

/** Already open source on the explorer? null when the explorer can't be asked. */
export async function isVerified(chain: ChainKey, token: string): Promise<boolean | null> {
  const a = api(chain);
  if (!a || !CHAINS[chain].chainId) return null;
  const j = await fetch(`${a.url}?${a.q}module=contract&action=getsourcecode&address=${token}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
  const src = j?.result?.[0]?.SourceCode;
  return typeof src === "string" ? src.length > 0 : null;
}

/** Sends the source to the explorer. Returns the explorer's ticket (guid) to check, or a message when it's done or can't be. */
export async function submitVerify(chain: ChainKey, token: `0x${string}`, txHash: `0x${string}`): Promise<{ guid: string } | { message: string; ok?: boolean }> {
  const c = CHAINS[chain];
  if (!c.chainId || c.kind === "solana") return { message: `${c.name} tokens don't need this.` };
  const a = api(chain);
  if (!a) return { message: "Automatic verify needs an Etherscan API key in Vercel (ETHERSCAN_API_KEY)." };
  const inst = await instantSource(chain, token);
  const v3 = inst ? false : await isV3Token(chain, token);
  const body = new URLSearchParams({
    module: "contract", action: "verifysourcecode", ...(blockscout(chain) ? {} : { apikey: key(), chainid: String(c.chainId) }), contractaddress: token,
    sourceCode: JSON.stringify(inst ? inst.input : v3 ? inputV3 : input), codeformat: "solidity-standard-json-input",
    contractname: inst ? inst.name : v3 ? "AutistikLaunchpadV3.sol:AutistikToken" : "AutistikLaunchpadV2.sol:AutistikToken",
    compilerversion: inst ? INSTANT_COMPILER : PAD_COMPILER,
    constructorArguements: inst ? inst.args : v3 ? "" : await constructorArgs(chain, token, txHash),
  });
  const sub = await fetch(`${a.url}?${a.q}module=contract&action=verifysourcecode`, { method: "POST", body, signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  if (sub?.status === "1") return { guid: String(sub.result) };
  const why = String(sub?.result || sub?.message || "");
  if (/already verified/i.test(why)) return { message: `✓ Already open source on the ${explorerName(chain)}.`, ok: true };
  return { message: `The ${explorerName(chain)} said: ${why.slice(0, 200)}` };
}

/** Waits (up to about 40 seconds) for the explorer to finish checking. */
export async function waitVerify(chain: ChainKey, guid: string): Promise<{ message: string; ok?: boolean }> {
  const a = api(chain)!;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`${a.url}?${a.q}module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    const res = String(st?.result || "");
    if (/pass|already verified/i.test(res)) return { message: `✓ Verified: the code is now open source on the ${explorerName(chain)}.`, ok: true };
    if (!/pending|queue/i.test(res)) return { message: `The ${explorerName(chain)} said: ${res.slice(0, 200)}` };
  }
  return { message: "The explorer is still checking. It usually finishes within a few minutes." };
}

/**
 * Makes sure every EVM coin launched here ends up open source on its explorer (so GoPlus, DexScreener and wallets
 * don't flag it): checks the ones not yet marked verified, submits any that aren't, and marks the ones that are.
 * Runs on the keeper schedule; a few coins per run.
 */
export async function verifySweep(deadline: number) {
  const sb = supabaseService();
  const { data } = await sb.from("launches").select("chain,token,tx_hash").eq("source", "launchpad").is("verified_at", null).neq("chain", "solana")
    .gte("created_at", new Date(Date.now() - 90 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(8);
  const out = { checked: 0, verified: 0, submitted: 0, notes: [] as string[] };
  for (const r of data || []) {
    if (Date.now() > deadline) break;
    const chain = r.chain as ChainKey;
    if (!CHAINS[chain]?.chainId || !api(chain)) continue;
    out.checked++;
    try {
      const ok = await isVerified(chain, r.token);
      if (ok) { await sb.from("launches").update({ verified_at: new Date().toISOString() }).eq("chain", chain).eq("token", r.token); out.verified++; continue; }
      const res = await submitVerify(chain, getAddress(r.token), r.tx_hash as `0x${string}`);
      if ("guid" in res) out.submitted++;
      else if (res.ok) { await sb.from("launches").update({ verified_at: new Date().toISOString() }).eq("chain", chain).eq("token", r.token); out.verified++; }
      else if (out.notes.length < 5) out.notes.push(`${chain} ${r.token.slice(0, 10)}: ${res.message.slice(0, 120)}`);
    } catch (e: any) { if (out.notes.length < 5) out.notes.push(`${chain} ${r.token.slice(0, 10)}: ${String(e?.message || e).slice(0, 120)}`); }
  }
  return out;
}
