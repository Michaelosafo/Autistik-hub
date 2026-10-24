import { PublicKey } from "@solana/web3.js";
import { CREATE_CPMM_POOL_PROGRAM } from "@raydium-io/raydium-sdk-v2";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { json } from "@/lib/ai";
import { logActivity } from "@/lib/activity";
import { CHAINS, isSolana, viemChain, type ChainKey } from "@/lib/launchpad";
import { lookupToken } from "@/lib/market";
import { rateLimit } from "@/lib/ratelimit";
import { SOL_ADDR, connection, findPool, readMetadata } from "@/lib/solana-launch";
import { currentUser, supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CPMM = CREATE_CPMM_POOL_PROGRAM.toBase58();
const ERC20 = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"]);
const ROUTER = parseAbi(["function factory() view returns (address)", "function WETH() view returns (address)"]);
const FACTORY = parseAbi(["function getPair(address, address) view returns (address)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Lists a token on the Hub after liquidity was added (or its pool created) through the Hub's own Add liquidity tool,
 * so every token whose liquidity goes in here shows on Trending and New listings. The transaction is checked on-chain
 * (it succeeded and it touched this token's pool); name, ticker and pool come from the chain, never the request.
 * Shown as "listed": the Hub didn't make the token, so its tax, owner and lock aren't claimed.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "auto-list", 20, 600);
  if (slow) return slow;
  const b = await req.json().catch(() => null);
  const chain = String(b?.chain || "") as ChainKey;
  const c = CHAINS[chain];
  if (!c) return json({ error: "Unknown network." }, 400);
  const tx = String(b?.tx || "");
  const user = await currentUser().catch(() => null);
  const sb = supabaseService();

  try {
    let row: { token: string; pair: string; name: string; symbol: string; supply: string; creator: string } | null = null;

    if (isSolana(c)) {
      const mint = String(b?.token || "");
      if (!SOL_ADDR.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(tx)) return json({ error: "Missing the token or transaction." }, 400);
      const t = await connection().getParsedTransaction(tx, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      if (!t || t.meta?.err) return json({ error: "That transaction didn't go through." }, 400);
      const keys = t.transaction.message.accountKeys.map((k) => k.pubkey.toBase58());
      if (!keys.includes(CPMM) || !keys.includes(mint)) return json({ error: "That isn't a liquidity transaction for this token." }, 400);
      const pool = await findPool(mint, SOL_ADDR.test(String(b?.pool || "")) && keys.includes(String(b.pool)) ? String(b.pool) : undefined).catch(() => null);
      if (!pool || !keys.includes(pool.pool)) return json({ error: "Couldn't find this token's Raydium pool in that transaction." }, 400);
      const meta = await readMetadata(new PublicKey(mint)).catch(() => null);
      const supply = await connection().getTokenSupply(new PublicKey(mint)).catch(() => null);
      row = { token: mint, pair: pool.pool, name: meta?.name || pool.symbol || "Unknown", symbol: meta?.symbol || pool.symbol || "?", supply: supply ? (BigInt(supply.value.amount) / 10n ** BigInt(supply.value.decimals)).toString() : "0", creator: keys[0] };
    } else {
      const token = String(b?.token || "");
      if (!isAddress(token) || !/^0x[0-9a-fA-F]{64}$/.test(tx) || !c.router) return json({ error: "Missing the token or transaction." }, 400);
      const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
      const r = await pub.getTransactionReceipt({ hash: tx as `0x${string}` });
      if (r.status !== "success" || !r.to || getAddress(r.to) !== getAddress(c.router)) return json({ error: "That isn't a liquidity transaction on this network." }, 400);
      const [factory, weth] = await Promise.all([pub.readContract({ address: c.router, abi: ROUTER, functionName: "factory" }), pub.readContract({ address: c.router, abi: ROUTER, functionName: "WETH" })]);
      const pair = (await pub.readContract({ address: factory, abi: FACTORY, functionName: "getPair", args: [getAddress(token), weth] })) as string;
      if (pair === ZERO || !r.logs.some((l: any) => getAddress(l.address) === getAddress(pair))) return json({ error: "That transaction didn't add liquidity to this token's pool." }, 400);
      const [name, symbol, supply] = await Promise.all(["name", "symbol", "totalSupply"].map((fn) => pub.readContract({ address: getAddress(token), abi: ERC20, functionName: fn as any }).catch(() => null)));
      row = { token: getAddress(token), pair, name: String(name || "Unknown"), symbol: String(symbol || "?"), supply: supply ? String(supply) : "0", creator: getAddress(r.from) };
    }

    const { data: known } = await sb.from("launches").select("token").eq("chain", chain).eq("token", row.token).maybeSingle();
    if (known) return json({ listed: true, already: true });
    if (row.name === "Unknown") {
      const d = await lookupToken(chain, row.token).catch(() => null);
      if (d) { row.name = d.name || row.name; row.symbol = d.symbol || row.symbol; }
    }
    const { error } = await sb.from("launches").upsert({
      chain, token: row.token, pair: row.pair, creator: row.creator, name: row.name.slice(0, 64), symbol: row.symbol.slice(0, 24),
      supply: row.supply, tx_hash: `liquidity:${chain}:${row.token}`, source: "listed", user_id: user?.id ?? null,
    }, { onConflict: "tx_hash", ignoreDuplicates: true });
    if (error) return json({ error: "Couldn't add it to the list right now." }, 500);
    logActivity(user?.id ?? null, "listed", `Listed ${row.symbol} on ${c.name} (liquidity added here)`, `/launchpad/${chain}/${row.token}`);
    return json({ listed: true });
  } catch (e: any) {
    console.error("auto-list:", String(e?.message || e).slice(0, 300));
    return json({ error: "Couldn't check that transaction yet. Try again in a minute." }, 502);
  }
}
