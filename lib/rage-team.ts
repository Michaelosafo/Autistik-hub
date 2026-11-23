/**
 * BnbRage team wallets (server only). One set of wallets for the owner and every helper admin: a wallet one of you
 * adds shows for all of you, and any of you can deploy, add liquidity, do the first buy and remove liquidity with it.
 * Keys stay in the Vault (same functions as the sniper wallets, under TEAM_ID) and are only used here.
 *
 * The server signs only BnbRage steps: deploying the Rage token, approving PancakeSwap, adding / removing liquidity,
 * swaps that pay back into the same wallet, and opening trading. Sending coins anywhere else is refused, so a helper
 * can trade with the team wallets but can't move the money out. Revealing a key and removing a wallet are owner only.
 */
import { createPublicClient, createWalletClient, decodeFunctionData, erc20Abi, fallback, formatUnits, getAddress, http, isAddress, parseAbi, type Hex } from "viem";
import { bsc } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { ADMIN_DIRECT_TOKEN_BYTECODE } from "@/lib/admin-direct-token";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { supabaseService } from "@/lib/supabase/server";

/** Vault id for the team's keys (outside every AI desk range). */
export const TEAM_ID = 900001;
export const TEAM_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] as const;

/**
 * Which deploy page's server wallets: "bsc" = BnbRage (shared with helper admins), "ethereum" = EthRise and
 * "robinhood" = WanaRobinhood (owner only). Each has its own wallets, saved CAs and log.
 */
export type Grp = "bsc" | "ethereum" | "robinhood";
export const isGrp = (g: unknown): g is Grp => g === "bsc" || g === "ethereum" || g === "robinhood";
const list = (...x: (string | undefined)[]) => [...new Set(x.filter(Boolean) as string[])];
const G: Record<Grp, { vault: number; chain: any; rpcs: string[]; router: `0x${string}`; stable: `0x${string}`; sd: number }> = {
  bsc: {
    vault: TEAM_ID, chain: bsc, router: getAddress(CHAINS.bsc.router!), stable: getAddress("0x55d398326f99059fF775485246999027B3197955"), sd: 18,
    rpcs: list(process.env.COPY_BSC_RPC, process.env.NEXT_PUBLIC_BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc.drpc.org", "https://bsc-dataseed.bnbchain.org"),
  },
  ethereum: {
    vault: 900002, chain: viemChain(CHAINS.ethereum as any), router: getAddress(CHAINS.ethereum.router!), stable: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"), sd: 6,
    rpcs: list(process.env.SNIPER_ETH_RPC, CHAINS.ethereum.rpc, "https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"),
  },
  robinhood: {
    vault: 900003, chain: viemChain(CHAINS.robinhood as any), router: getAddress(CHAINS.robinhood.router!), stable: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"), sd: 6,
    rpcs: list(process.env.ROBINHOOD_RPC, CHAINS.robinhood.rpc),
  },
};
const transport = (g: Grp) => fallback(G[g].rpcs.map((u) => http(u, { timeout: 10_000, retryCount: 0 })), { retryCount: 1 });
const pub = (g: Grp) => createPublicClient({ chain: G[g].chain, transport: transport(g) }) as any;
const sb = () => supabaseService();

const ROUTER_ABI = parseAbi([
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
const TOKEN_ABI = parseAbi(["function approve(address, uint256) returns (bool)", "function enableTrading()"]);

const okSlot = (slot: unknown): number => {
  const s = Number(slot);
  if (!TEAM_SLOTS.includes(s as any)) throw new Error("Pick a team wallet from 1 to 13.");
  return s;
};

async function keyOf(g: Grp, slot: number): Promise<PrivateKeyAccount | null> {
  const { data } = await sb().rpc("ai_copy_key_get", { p_id: G[g].vault, p_slot: slot });
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data)) return null;
  return privateKeyToAccount(data as Hex);
}

export async function teamLog(g: Grp, who: string, what: string, tx?: string | null) {
  await sb().from("rage_team_log").insert({ grp: g, who, what, tx: tx || null });
}

/** Everything the page shows: the wallets with their BNB / USDT, the saved CAs (current one first) and recent steps. */
export async function teamState(g: Grp = "bsc") {
  const [{ data: ws }, { data: cas }, { data: log }] = await Promise.all([
    sb().from("rage_team_wallets").select("slot,address,label,added_by,created_at").eq("grp", g).order("slot"),
    sb().from("rage_team_cas").select("address,name,symbol,added_by,current,created_at").eq("grp", g).order("current", { ascending: false }).order("created_at", { ascending: false }).limit(50),
    sb().from("rage_team_log").select("who,what,tx,created_at").eq("grp", g).order("id", { ascending: false }).limit(15),
  ]);
  const p = pub(g);
  const wallets = await Promise.all((ws || []).map(async (w: any) => {
    const a = getAddress(w.address);
    const [bnb, usdt] = await Promise.all([
      p.getBalance({ address: a }).catch(() => null),
      p.readContract({ address: G[g].stable, abi: erc20Abi, functionName: "balanceOf", args: [a] }).catch(() => null),
    ]);
    // "bnb" = the chain's own coin (gas), "usdt" = its dollar coin (USDT, or USDG on Robinhood Chain).
    return { ...w, address: a, bnb: bnb == null ? null : formatUnits(bnb, 18), usdt: usdt == null ? null : formatUnits(usdt as bigint, G[g].sd) };
  }));
  return { wallets, cas: cas || [], log: log || [] };
}

async function firstFree(g: Grp): Promise<number> {
  const { data } = await sb().from("rage_team_wallets").select("slot").eq("grp", g);
  const used = new Set((data || []).map((r: any) => Number(r.slot)));
  for (const s of TEAM_SLOTS) if (!used.has(s)) return s;
  throw new Error("All 13 team wallets are in use. The owner can remove one first.");
}

/** Add a wallet: a brand-new one, or an existing one from its private key. */
export async function addWallet(g: Grp, who: string, raw?: string, label?: string) {
  let key: Hex;
  if (raw && raw.trim()) {
    const k = raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error("That isn't a private key (64 letters and numbers, from your wallet's Export private key).");
    key = k as Hex;
  } else key = generatePrivateKey();
  const a = privateKeyToAccount(key);
  const { data: dup } = await sb().from("rage_team_wallets").select("slot").eq("grp", g).ilike("address", a.address).maybeSingle();
  if (dup) throw new Error(`That wallet is already wallet ${dup.slot}.`);
  const slot = await firstFree(g);
  const { error } = await sb().rpc("ai_copy_key_set", { p_id: G[g].vault, p_slot: slot, p_key: key });
  if (error) throw new Error(error.message);
  const { error: e2 } = await sb().from("rage_team_wallets").insert({ grp: g, slot, address: a.address, label: (label || "").trim().slice(0, 30) || null, added_by: who });
  if (e2) { await sb().rpc("ai_copy_key_del", { p_id: G[g].vault, p_slot: slot }); throw new Error(e2.message); }
  await teamLog(g, who, `${raw ? "Imported" : "Made"} wallet ${slot}: ${a.address}`);
  return { slot, address: a.address };
}

export async function removeWallet(g: Grp, who: string, slot: unknown) {
  const s = okSlot(slot);
  const { error } = await sb().rpc("ai_copy_key_del", { p_id: G[g].vault, p_slot: s });
  if (error) throw new Error(error.message);
  await sb().from("rage_team_wallets").delete().eq("grp", g).eq("slot", s);
  await teamLog(g, who, `Removed wallet ${s}`);
}

export async function revealWallet(g: Grp, who: string, slot: unknown): Promise<string> {
  const s = okSlot(slot);
  const { data } = await sb().rpc("ai_copy_key_get", { p_id: G[g].vault, p_slot: s });
  if (typeof data !== "string") throw new Error(`Wallet ${s} doesn't exist.`);
  await teamLog(g, who, `Showed the private key of wallet ${s}`);
  return data;
}

/** Only the BnbRage steps listed at the top of this file get signed. Throws with the reason otherwise. */
function checkTx(g: Grp, from: `0x${string}`, to: string | null, data: Hex, value: bigint) {
  const ROUTER = G[g].router;
  const me = from.toLowerCase();
  const self = (x: unknown) => String(x).toLowerCase() === me;
  if (!to) {
    if (value !== 0n) throw new Error("A deploy sends no BNB.");
    if (!data.toLowerCase().startsWith(ADMIN_DIRECT_TOKEN_BYTECODE.toLowerCase())) throw new Error("Team wallets only deploy the BnbRage token.");
    return "Deploy token";
  }
  if (!isAddress(to)) throw new Error("Bad address.");
  if (getAddress(to) === ROUTER) {
    const d = decodeFunctionData({ abi: ROUTER_ABI, data });
    const args = d.args as readonly unknown[];
    const recipient = d.functionName === "addLiquidityETH" || d.functionName === "removeLiquidityETHSupportingFeeOnTransferTokens" ? args[4] : d.functionName.startsWith("swapExactETH") ? args[2] : args[3];
    if (!self(recipient)) throw new Error("Team wallets only trade back into the same wallet.");
    return d.functionName;
  }
  if (value !== 0n) throw new Error("Only PancakeSwap can be sent BNB from a team wallet.");
  const d = decodeFunctionData({ abi: TOKEN_ABI, data });
  if (d.functionName === "approve" && getAddress(String((d.args as readonly unknown[])[0])) !== ROUTER) throw new Error("Team wallets only approve PancakeSwap.");
  return d.functionName;
}

/** Sign and send one BnbRage step from a team wallet. Returns the tx hash; the page waits for it. */
export async function sendFromTeam(g: Grp, who: string, slot: unknown, tx: { to?: string | null; data?: string; value?: string }) {
  const s = okSlot(slot);
  const acc = await keyOf(g, s);
  if (!acc) throw new Error(`Wallet ${s} doesn't exist.`);
  const data = String(tx.data || "0x") as Hex;
  if (!/^0x[0-9a-fA-F]*$/.test(data)) throw new Error("Bad data.");
  const value = BigInt(tx.value || "0");
  let what: string;
  try { what = checkTx(g, acc.address, tx.to || null, data, value); }
  catch (e) { throw new Error((e as Error).message.split("\n")[0] || "Team wallets only sign BnbRage steps."); }
  const w = createWalletClient({ account: acc, chain: G[g].chain, transport: transport(g) }) as any;
  const hash = await w.sendTransaction({ account: acc, chain: G[g].chain, to: tx.to ? getAddress(tx.to) : undefined, data, value });
  await teamLog(g, who, `Wallet ${s}: ${what}`, hash);
  return hash as string;
}

export async function saveCa(g: Grp, who: string, address: string, name?: string, symbol?: string) {
  if (!isAddress(address)) throw new Error("That isn't a token address.");
  const a = getAddress(address);
  await sb().from("rage_team_cas").update({ current: false }).eq("grp", g).eq("current", true);
  const { error } = await sb().from("rage_team_cas").upsert({ grp: g, address: a, name: (name || "").slice(0, 40) || null, symbol: (symbol || "").slice(0, 15) || null, added_by: who, current: true }, { onConflict: "grp,address" });
  if (error) throw new Error(error.message);
}
export async function clearCurrent(g: Grp) {
  await sb().from("rage_team_cas").update({ current: false }).eq("grp", g).eq("current", true);
}
export async function deleteCa(g: Grp, address: string) {
  if (!isAddress(address)) throw new Error("That isn't a token address.");
  await sb().from("rage_team_cas").delete().eq("grp", g).eq("address", getAddress(address));
}
