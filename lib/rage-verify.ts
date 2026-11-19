import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { checkVerify, isVerified, submitSource, waitVerify } from "@/lib/launch-verify";
import input from "@/contracts/AdminDirectToken.input.json";
import { encodeAbiParameters, getAddress, isAddress, zeroAddress } from "viem";

/**
 * Explorer verification for the Rage admin token.
 *
 * The posted source is contracts/AdminDirectToken.input.json: solc v0.8.38+commit.1835d247,
 * optimizer on, 200 runs, paris, source path AdminDirectToken.sol. That compile is the bytecode
 * this page deploys. Submission and polling go through lib/launch-verify.ts, which already talks
 * to Etherscan (ETHERSCAN_API_KEY) and to Blockscout for Robinhood Chain.
 */

export const RAGE_COMPILER = "v0.8.38+commit.1835d247";
const CONTRACT_NAME = "AdminDirectToken.sol:AdminDirectToken";

export type RageCtorArgs = {
  name: string;
  symbol: string;
  supply: string;
  buyBps: number;
  sellBps: number;
  taxWallet: string;
  router: string;
};

export type VerifyStatus = "verifying" | "verified" | "failed" | "unsupported";

export type VerifyResult = {
  status: VerifyStatus;
  message: string;
  guid?: string;
  url?: string;
};

const KEY_MESSAGE = "Automatic verify needs an Etherscan API key in Vercel (ETHERSCAN_API_KEY).";
const ROBINHOOD_UNSUPPORTED = "Robinhood Chain's explorer has no verification API this app can use.";

export function rageExplorerUrl(chain: string, address: string): string {
  const known = (CHAINS as Record<string, { explorer?: string }>)[chain];
  const base = (known?.explorer || "").replace(/\/+$/, "");
  return base ? `${base}/address/${address}#code` : "";
}

/** ABI-encoded constructor args, without a 0x prefix, the way the explorer expects them. */
export function encodeRageConstructor(args: RageCtorArgs): string {
  const encoded = encodeAbiParameters(
    [
      { type: "string" },
      { type: "string" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "address" },
    ],
    [args.name, args.symbol, BigInt(args.supply), BigInt(args.buyBps), BigInt(args.sellBps), getAddress(args.taxWallet), getAddress(args.router)],
  );
  return encoded.slice(2);
}

function cleanArgs(raw: unknown): RageCtorArgs | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const name = String(a.name ?? "").trim();
  const symbol = String(a.symbol ?? "").trim();
  const supply = String(a.supply ?? "").trim();
  const buyBps = Number(a.buyBps);
  const sellBps = Number(a.sellBps);
  const taxWallet = String(a.taxWallet ?? "");
  const router = String(a.router ?? "");
  if (!name || name.length > 32) return null;
  if (!symbol || symbol.length > 12) return null;
  if (!/^\d+$/.test(supply) || supply === "0") return null;
  if (!Number.isInteger(buyBps) || buyBps < 0 || buyBps > 5000) return null;
  if (!Number.isInteger(sellBps) || sellBps < 0 || sellBps > 5000) return null;
  if (!isAddress(taxWallet) || !isAddress(router)) return null;
  if (getAddress(router) === zeroAddress) return null;
  return { name, symbol, supply, buyBps, sellBps, taxWallet: getAddress(taxWallet), router: getAddress(router) };
}

function asChain(chain: string): ChainKey | null {
  return chain in CHAINS ? (chain as ChainKey) : null;
}

function fromMessage(chain: ChainKey, message: string, url: string, guid?: string): VerifyResult {
  if (/already open source|verified/i.test(message) && !/said:/i.test(message)) return { status: "verified", message: "Verified", guid, url };
  if (message === KEY_MESSAGE) return { status: "failed", message, url };
  if (chain === "solana" || /don't need this/i.test(message)) return { status: "unsupported", message: "Solana is not verified through this explorer API.", url };
  if (chain === "robinhood" && /couldn't reach|no verification|unexpected token|not found/i.test(message)) {
    return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  }
  return { status: "failed", message, guid, url };
}

export async function submitRageVerify(chainName: string, address: string, rawArgs: unknown): Promise<VerifyResult> {
  const chain = asChain(chainName);
  if (!chain) return { status: "unsupported", message: "This chain has no explorer verification set up." };
  if (chain === "solana") return { status: "unsupported", message: "Solana is not verified through this explorer API." };
  if (!isAddress(address)) return { status: "failed", message: "That isn't a token address." };
  const at = getAddress(address);
  const args = cleanArgs(rawArgs);
  const url = rageExplorerUrl(chain, at);
  if (!args) return { status: "failed", message: "The constructor values from this deploy are missing or not valid.", url };
  try {
    if (await isVerified(chain, at)) return { status: "verified", message: "Verified", url };
    const sub = await submitSource(chain, {
      address: at,
      sourceCode: JSON.stringify(input),
      contractname: CONTRACT_NAME,
      compilerversion: RAGE_COMPILER,
      constructorArguements: encodeRageConstructor(args),
    });
    if (!("guid" in sub)) return fromMessage(chain, sub.message, url);
    const done = await waitVerify(chain, sub.guid);
    if (done.ok) return { status: "verified", message: "Verified", guid: sub.guid, url };
    if (done.pending) return { status: "verifying", message: "Verifying…", guid: sub.guid, url };
    return fromMessage(chain, done.message, url, sub.guid);
  } catch {
    if (chain === "robinhood") return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
    return { status: "failed", message: `Couldn't reach the ${CHAINS[chain].name} explorer. Try again in a minute.`, url };
  }
}

export async function checkRageVerify(chainName: string, address: string, guid: string): Promise<VerifyResult> {
  const chain = asChain(chainName);
  if (!chain || chain === "solana") return { status: "unsupported", message: chain === "solana" ? "Solana is not verified through this explorer API." : "This chain has no explorer verification set up." };
  if (!isAddress(address)) return { status: "failed", message: "That isn't a token address." };
  const url = rageExplorerUrl(chain, getAddress(address));
  try {
    const done = await checkVerify(chain, guid);
    if (done.ok) return { status: "verified", message: "Verified", guid, url };
    if (done.pending) return { status: "verifying", message: "Verifying…", guid, url };
    return fromMessage(chain, done.message, url, guid);
  } catch {
    if (chain === "robinhood") return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
    return { status: "failed", message: `Couldn't reach the ${CHAINS[chain].name} explorer. Try again in a minute.`, url };
  }
}
