import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "@/lib/launchpad";
import { encodeAbiParameters, getAddress, isAddress, zeroAddress } from "viem";

/**
 * Explorer verification for the Rage admin token.
 *
 * The bytecode in lib/admin-direct-token.ts matches one compile only:
 * solc v0.8.38+commit.1835d247, optimizer on, 200 runs, evmVersion paris,
 * and the source path AdminDirectToken.sol (that path is part of the metadata hash).
 * The standard JSON submitted here is that compile. A different path or a different
 * solc build changes the metadata at the end of the bytecode and the explorer rejects it.
 */

export const RAGE_COMPILER = "v0.8.38+commit.1835d247";
const SOURCE_PATH = "AdminDirectToken.sol";
/** sha256 of contracts/AdminDirectToken.sol at the compile that produced the deployed bytecode. */
const SOURCE_SHA256 = "ce1099820e282096814638f741d2696755d14cc67bbe76d255afe01b159f277d";

const ETHERSCAN = "https://api.etherscan.io/v2/api";

/** Etherscan API V2 chain ids. One key covers every chain in this map. */
const ETHERSCAN_CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  optimism: 10,
  bsc: 56,
  polygon: 137,
  base: 8453,
  arbitrum: 42161,
  avalanche: 43114,
};

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

export function rageExplorerUrl(chain: string, address: string): string {
  const known = (CHAINS as Record<string, { explorer?: string }>)[chain];
  const base = (known?.explorer || "").replace(/\/+$/, "");
  return base ? `${base}/address/${address}#code` : "";
}

/** ABI-encoded constructor args, without a 0x prefix, the way Etherscan expects them. */
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

function standardJson(): string {
  const content = readFileSync(join(process.cwd(), "contracts/AdminDirectToken.sol"), "utf8");
  const hash = createHash("sha256").update(content).digest("hex");
  if (hash !== SOURCE_SHA256) {
    throw new Error("The token source on the server no longer matches the bytecode this page deploys, so nothing was submitted.");
  }
  return JSON.stringify({
    language: "Solidity",
    sources: { [SOURCE_PATH]: { content } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      outputSelection: { "*": { "*": ["evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
    },
  });
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

/** Explorer status phrases only. A guid from verifysourcecode must stay unclassified so it can be polled. */
function classify(result: string): VerifyStatus | null {
  const r = result.toLowerCase();
  if (!r) return null;
  if (r.includes("pass -") || r.startsWith("pass") || r.includes("already verified") || r.includes("successfully verified")) return "verified";
  if (r.includes("pending") || r.includes("in queue") || r.includes("in progress") || r.includes("processing")) return "verifying";
  if (r.includes("fail") || r.includes("unable to") || r.includes("error") || r.includes("not match") || r.includes("does not match") || r.includes("invalid") || r.includes("missing")) return "failed";
  return null;
}

type ExplorerBody = { status: string; message: string; result: string };

async function postForm(url: string, params: Record<string, string>): Promise<{ ok: boolean; body: ExplorerBody | null; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (text.trim().startsWith("<")) return { ok: false, body: null, text };
  try {
    const j = JSON.parse(text) as { status?: unknown; message?: unknown; result?: unknown };
    return {
      ok: res.ok,
      body: {
        status: String(j?.status ?? ""),
        message: String(j?.message ?? ""),
        result: typeof j?.result === "string" ? j.result : j?.result == null ? "" : JSON.stringify(j.result),
      },
      text,
    };
  } catch {
    return { ok: false, body: null, text };
  }
}

function fromExplorer(body: ExplorerBody, url: string, guid?: string): VerifyResult {
  const result = body.result || "";
  const status = classify(result);
  if (status === "verified") return { status: "verified", message: "Verified", guid, url };
  if (status === "verifying") return { status: "verifying", message: "Verifying…", guid, url };
  if (status === "failed") return { status: "failed", message: result.slice(0, 500), guid, url };
  if (body.status === "0") return { status: "failed", message: (result || body.message || "The explorer rejected the submission.").slice(0, 500), url };
  return { status: "verifying", message: "Verifying…", guid: guid || result, url };
}

async function pollEtherscan(chainId: number, guid: string, url: string, tries: number): Promise<VerifyResult> {
  const key = process.env.ETHERSCAN_API_KEY || "";
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const got = await postForm(`${ETHERSCAN}?chainid=${chainId}`, {
      module: "contract",
      action: "checkverifystatus",
      guid,
      apikey: key,
    });
    if (!got.body) return { status: "failed", message: "The explorer didn't return a verification status.", guid, url };
    const next = fromExplorer(got.body, url, guid);
    if (next.status !== "verifying") return next;
  }
  return { status: "verifying", message: "Verifying…", guid, url };
}

async function submitEtherscan(chain: string, address: string, args: RageCtorArgs): Promise<VerifyResult> {
  const chainId = ETHERSCAN_CHAIN_ID[chain];
  const url = rageExplorerUrl(chain, address);
  const key = process.env.ETHERSCAN_API_KEY || "";
  if (!key) return { status: "failed", message: "ETHERSCAN_API_KEY is not set on the server.", url };
  const source = standardJson();
  const ctor = encodeRageConstructor(args);
  const got = await postForm(`${ETHERSCAN}?chainid=${chainId}`, {
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: source,
    codeformat: "solidity-standard-json-input",
    contractname: `${SOURCE_PATH}:AdminDirectToken`,
    compilerversion: RAGE_COMPILER,
    constructorArguements: ctor,
    optimizationUsed: "1",
    runs: "200",
    evmversion: "paris",
    licenseType: "3",
    apikey: key,
  });
  if (!got.body) return { status: "failed", message: "The explorer didn't accept the verification request.", url };
  const early = classify(got.body.result);
  if (early === "verified") return { status: "verified", message: "Verified", url };
  if (early === "failed" || got.body.status !== "1") {
    return { status: "failed", message: (got.body.result || got.body.message || "The explorer rejected the submission.").slice(0, 500), url };
  }
  return pollEtherscan(chainId, got.body.result, url, 8);
}

const ROBINHOOD_UNSUPPORTED = "Robinhood Chain's explorer has no verification API this app can use.";

async function pollBlockscout(base: string, address: string, url: string, tries: number): Promise<VerifyResult> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${base}/api/v2/smart-contracts/${address}`, { headers: { accept: "application/json" } });
    const text = await res.text();
    if (text.trim().startsWith("<") || res.status === 404) {
      return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
    }
    let j: { is_verified?: boolean; verification_status?: string; status?: string; message?: string } | null = null;
    try { j = JSON.parse(text); } catch { return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url }; }
    if (j?.is_verified) return { status: "verified", message: "Verified", guid: `bs:${address}`, url };
    const note = String(j?.verification_status || j?.status || "");
    if (/fail|error/i.test(note) && !/pending|queue/i.test(note)) {
      return { status: "failed", message: (j?.message || note).slice(0, 500), guid: `bs:${address}`, url };
    }
  }
  return { status: "verifying", message: "Verifying…", guid: `bs:${address}`, url };
}

async function submitRobinhood(address: string, args: RageCtorArgs): Promise<VerifyResult> {
  const base = (CHAINS.robinhood.explorer || "https://robinhoodchain.blockscout.com").replace(/\/+$/, "");
  const url = rageExplorerUrl("robinhood", address);
  const source = standardJson();
  const ctor = encodeRageConstructor(args);
  const compatible = await postForm(`${base}/api`, {
    module: "contract",
    action: "verifysourcecode",
    contractaddress: address,
    sourceCode: source,
    codeformat: "solidity-standard-json-input",
    contractname: `${SOURCE_PATH}:AdminDirectToken`,
    compilerversion: RAGE_COMPILER,
    constructorArguements: ctor,
    constructorArguments: ctor,
    optimizationUsed: "1",
    runs: "200",
    evmversion: "paris",
    licenseType: "3",
  }).catch(() => null);

  if (compatible?.body) {
    const early = classify(compatible.body.result);
    if (early === "verified") return { status: "verified", message: "Verified", url };
    const missing = /unknown module|invalid action|not found|not implemented|api key|invalid key/i.test(compatible.body.result + compatible.body.message);
    if (!missing && compatible.body.status === "1" && compatible.body.result) {
      for (let i = 0; i < 8; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 3000));
        const polled = await postForm(`${base}/api?module=contract&action=checkverifystatus&guid=${encodeURIComponent(compatible.body.result)}`, {
          module: "contract",
          action: "checkverifystatus",
          guid: compatible.body.result,
        }).catch(() => null);
        if (!polled?.body) break;
        const next = fromExplorer(polled.body, url, compatible.body.result);
        if (next.status !== "verifying") return next;
      }
      return { status: "verifying", message: "Verifying…", guid: compatible.body.result, url };
    }
    if (!missing && early === "failed") return { status: "failed", message: compatible.body.result.slice(0, 500), url };
  }

  const fd = new FormData();
  fd.set("compiler_version", RAGE_COMPILER);
  fd.set("contract_name", `${SOURCE_PATH}:AdminDirectToken`);
  fd.set("autodetect_constructor_args", "false");
  fd.set("constructor_args", `0x${ctor}`);
  fd.set("files", new Blob([source], { type: "application/json" }), "AdminDirectToken.json");
  let res: Response;
  try {
    res = await fetch(`${base}/api/v2/smart-contracts/${address}/verification/via/standard-input`, {
      method: "POST",
      body: fd,
      headers: { accept: "application/json" },
    });
  } catch {
    return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  }
  const text = await res.text();
  if (res.ok && !text.trim().startsWith("<")) return pollBlockscout(base, address, url, 8);
  if (text.trim().startsWith("<") || res.status === 404 || res.status === 501) {
    return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  }
  const asJson = await fetch(`${base}/api/v2/smart-contracts/${address}/verification/via/standard-input`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      compiler_version: RAGE_COMPILER,
      contract_name: `${SOURCE_PATH}:AdminDirectToken`,
      autodetect_constructor_args: false,
      constructor_args: `0x${ctor}`,
      files: [{ file_path: "AdminDirectToken.json", content: source }],
    }),
  }).catch(() => null);
  if (!asJson) return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  const jsonText = await asJson.text();
  if (asJson.ok && !jsonText.trim().startsWith("<")) return pollBlockscout(base, address, url, 8);
  if (jsonText.trim().startsWith("<") || asJson.status === 404 || asJson.status === 501) {
    return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  }
  let reason = jsonText.slice(0, 300);
  try {
    const j = JSON.parse(jsonText) as { message?: string };
    if (j?.message) reason = j.message;
  } catch { /* keep the text */ }
  if (/not found|cannot post|unknown/i.test(reason)) return { status: "unsupported", message: ROBINHOOD_UNSUPPORTED, url };
  return { status: "failed", message: reason.slice(0, 500), url };
}

export async function submitRageVerify(chain: string, address: string, rawArgs: unknown): Promise<VerifyResult> {
  if (chain === "solana") return { status: "unsupported", message: "Solana is not verified through this explorer API." };
  if (!isAddress(address)) return { status: "failed", message: "That isn't a token address." };
  const at = getAddress(address);
  const args = cleanArgs(rawArgs);
  if (!args) return { status: "failed", message: "The constructor values from this deploy are missing or not valid." };
  if (chain === "robinhood") return submitRobinhood(at, args);
  if (!ETHERSCAN_CHAIN_ID[chain]) return { status: "unsupported", message: "This chain has no explorer verification set up." };
  return submitEtherscan(chain, at, args);
}

export async function checkRageVerify(chain: string, address: string, guid: string): Promise<VerifyResult> {
  if (chain === "solana") return { status: "unsupported", message: "Solana is not verified through this explorer API." };
  if (!isAddress(address)) return { status: "failed", message: "That isn't a token address." };
  const at = getAddress(address);
  const url = rageExplorerUrl(chain, at);
  if (chain === "robinhood") {
    const base = (CHAINS.robinhood.explorer || "https://robinhoodchain.blockscout.com").replace(/\/+$/, "");
    if (guid.startsWith("bs:")) return pollBlockscout(base, at, url, 1);
    const polled = await postForm(`${base}/api?module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}`, {
      module: "contract",
      action: "checkverifystatus",
      guid,
    }).catch(() => null);
    if (!polled?.body) return pollBlockscout(base, at, url, 1);
    return fromExplorer(polled.body, url, guid);
  }
  const chainId = ETHERSCAN_CHAIN_ID[chain];
  if (!chainId) return { status: "unsupported", message: "This chain has no explorer verification set up.", url };
  if (!process.env.ETHERSCAN_API_KEY) return { status: "failed", message: "ETHERSCAN_API_KEY is not set on the server.", url };
  return pollEtherscan(chainId, guid, url, 1);
}
