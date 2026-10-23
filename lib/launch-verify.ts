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
import input from "@/contracts/AutistikLaunchpadV2.input.json";
import inputV3 from "@/contracts/AutistikLaunchpadV3.input.json";

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
  const v3 = await isV3Token(chain, token);
  const body = new URLSearchParams({
    module: "contract", action: "verifysourcecode", ...(blockscout(chain) ? {} : { apikey: key(), chainid: String(c.chainId) }), contractaddress: token,
    sourceCode: JSON.stringify(v3 ? inputV3 : input), codeformat: "solidity-standard-json-input",
    contractname: v3 ? "AutistikLaunchpadV3.sol:AutistikToken" : "AutistikLaunchpadV2.sol:AutistikToken",
    compilerversion: PAD_COMPILER, constructorArguements: v3 ? "" : await constructorArgs(chain, token, txHash),
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
