import { PublicKey } from "@solana/web3.js";
import { SOL_ADDR, readMetadata } from "@/lib/solana-launch";
import { supabaseService } from "@/lib/supabase/server";

export const runtime = "nodejs";

// The token details wallets and explorers read for a Solana Launch Pad token (the link saved in its on-chain metadata).
export async function GET(_req: Request, { params }: { params: { mint: string } }) {
  if (!SOL_ADDR.test(params.mint)) return Response.json({ error: "Not found." }, { status: 404 });
  const meta = await readMetadata(new PublicKey(params.mint)).catch(() => null);
  if (!meta) return Response.json({ error: "Not found." }, { status: 404 });
  const sb = supabaseService();
  const [{ data: l }, { data: logo }] = await Promise.all([
    sb.from("launches").select("chain").eq("chain", "solana").eq("token", params.mint).maybeSingle(),
    sb.from("token_logos").select("url").eq("chain", "solana").eq("token", params.mint).maybeSingle(),
  ]);
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io").replace(/\/+$/, "");
  return Response.json({
    name: meta.name, symbol: meta.symbol,
    description: `${meta.name} ($${meta.symbol}), launched on the AUTISTIK Launch Pad with its liquidity burned.`,
    external_url: l ? `${site}/launchpad/solana/${params.mint}` : site,
    ...(logo?.url ? { image: logo.url, properties: { files: [{ uri: logo.url, type: "image/webp" }], category: "image" } } : {}),
  }, { headers: { "cache-control": "public, max-age=300" } });
}
