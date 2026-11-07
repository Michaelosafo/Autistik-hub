import { CHAINS, type ChainKey } from "@/lib/launchpad";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const revalidate = 300;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/$/, "");

/**
 * Every EVM coin launched on AUTISTIK with its logo, as a standard token list (tokenlists.org, the format Uniswap,
 * PancakeSwap and many wallets import). Add https://autistik.io/tokenlist.json to a DEX or wallet and our coins show
 * with their pictures.
 */
export async function GET() {
  const sb = supabaseService();
  const { data: rows } = await sb.from("launches").select("chain,token,name,symbol,created_at").eq("source", "launchpad").neq("chain", "solana").order("created_at", { ascending: true }).limit(2000);
  const { data: logos } = rows?.length ? await sb.from("token_logos").select("chain,token,url").in("token", rows.map((r) => r.token)) : { data: [] as any[] };
  const L = new Map((logos || []).map((l: any) => [`${l.chain}:${l.token.toLowerCase()}`, l.url]));
  const tokens = (rows || []).flatMap((r) => {
    const c = CHAINS[r.chain as ChainKey];
    if (!c?.chainId) return [];
    const has = L.get(`${r.chain}:${r.token.toLowerCase()}`);
    const symbol = String(r.symbol || "").replace(/[^\w.$+-]/g, "").slice(0, 20) || "TOKEN";
    return [{
      chainId: c.chainId, address: r.token, name: String(r.name || symbol).slice(0, 40), symbol, decimals: 18,
      ...(has ? { logoURI: `${SITE}/api/launchpad/logo/${r.chain}/${r.token}` } : {}),
      tags: ["autistik"],
    }];
  });
  const last = rows?.length ? new Date(rows[rows.length - 1].created_at) : new Date();
  const body = {
    name: "AUTISTIK Launches",
    timestamp: last.toISOString(),
    version: { major: 1, minor: tokens.length, patch: 0 },
    logoURI: `${SITE}/icons/icon-512.png`,
    keywords: ["autistik", "launchpad"],
    tags: { autistik: { name: "AUTISTIK", description: "Launched on the AUTISTIK Launch Pad" } },
    tokens,
  };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
}
