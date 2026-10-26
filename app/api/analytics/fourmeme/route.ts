import { createPublicClient, decodeEventLog, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { json } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Indexes four.meme (BNB Chain's biggest launchpad) so the dev wallet scanner knows who created which token and which
 * ones bonded (moved to PancakeSwap). Reads TokenManager2's TokenCreate and LiquidityAdded events from the chain.
 * Runs every 4 minutes (supabase/fourmeme.sql). Free public nodes only keep a few hours of logs, so history builds up
 * from when this started; with an archive node in ANALYTICS_BSC_RPC it also fills in older history.
 */
const TM2 = "0x5c952063c7fc8610FFDB798152D69F0B9550762b" as const;
const ABI = parseAbi([
  "event TokenCreate(address creator, address token, uint256 requestId, string name, string symbol, uint256 totalSupply, uint256 launchTime, uint256 launchFee)",
  "event LiquidityAdded(address base, uint256 offers, address quote, uint256 funds)",
]);
const TOPICS = ["0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20", "0xc18aa71171b358b706fe3dd345299685ba21a5316c66ffa9e319268b033c44b0"] as const;
const STEP = 2000n;

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return json({ skipped: "not set up" });
  const sb = supabaseService();
  const { data: go } = await sb.rpc("fm_lease", { p_seconds: 200 });
  if (go !== true) return json({ skipped: true });
  const c = createPublicClient({ chain: bsc, transport: http(process.env.ANALYTICS_BSC_RPC || "https://bsc-rpc.publicnode.com", { timeout: 20_000 }) });
  const { data: st } = await sb.from("fm_state").select("*").eq("id", 1).single();
  const latest = await c.getBlockNumber();
  // Free nodes keep only a few hours of logs: start (or restart, if we fell too far behind) near the top.
  let head = st?.head && latest - BigInt(st.head) < 8_000n ? BigInt(st.head) : latest - 3_000n;
  let tail = st?.tail && BigInt(st.tail) <= head ? BigInt(st.tail) : head;
  const end = Date.now() + 45_000;
  let created = 0, bonded = 0, note: string | null = st?.note ?? null;

  async function read(from: bigint, to: bigint) {
    const logs = await c.request({ method: "eth_getLogs", params: [{ address: TM2, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [TOPICS as any] }] } as any) as any[];
    const rows: any[] = [], bonds: string[] = [];
    // Each event's time, from the timestamps of the range's first and last blocks (blocks come at a steady pace).
    const [b0, b1] = await Promise.all([c.getBlock({ blockNumber: from }), c.getBlock({ blockNumber: to })]);
    const t0 = Number(b0.timestamp), t1 = Number(b1.timestamp), span = Number(to - from) || 1;
    const timeOf = (bn: bigint) => new Date((t0 + ((t1 - t0) * Number(bn - from)) / span) * 1000).toISOString();
    for (const l of logs) {
      try {
        const e = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics }) as any;
        if (e.eventName === "TokenCreate") rows.push({
          token: String(e.args.token).toLowerCase(), creator: String(e.args.creator).toLowerCase(), name: String(e.args.name).slice(0, 80), symbol: String(e.args.symbol).slice(0, 30),
          created_at: timeOf(BigInt(l.blockNumber)), block: Number(BigInt(l.blockNumber)),
        });
        else bonds.push(String(e.args.base).toLowerCase());
      } catch { /* another event */ }
    }
    if (rows.length) await sb.from("fm_tokens").upsert(rows, { onConflict: "token", ignoreDuplicates: true });
    if (bonds.length) await sb.from("fm_tokens").update({ bonded_at: timeOf(to) }).in("token", bonds).is("bonded_at", null);
    created += rows.length; bonded += bonds.length;
  }

  // New blocks first.
  while (head < latest && Date.now() < end) {
    const to = head + STEP > latest ? latest : head + STEP;
    try { await read(head + 1n, to); head = to; } catch (e) { note = "new blocks: " + (e as Error).message.slice(0, 140); break; }
    await sb.from("fm_state").update({ head: head.toString(), tail: tail.toString() }).eq("id", 1);
  }
  // Then older history, as far as the node allows.
  while (Date.now() < end && tail > 0n && !note?.startsWith("new blocks")) {
    const from = tail - STEP;
    try { await read(from, tail - 1n); tail = from; note = null; } catch (e) { note = "older history: " + (e as Error).message.slice(0, 140); break; }
    await sb.from("fm_state").update({ tail: tail.toString() }).eq("id", 1);
  }
  await sb.from("fm_state").update({ head: head.toString(), tail: tail.toString(), note }).eq("id", 1);
  return json({ head: head.toString(), tail: tail.toString(), created, bonded, note });
}
