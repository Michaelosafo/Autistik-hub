import { NextResponse } from "next/server";
import { hotMatches } from "@/lib/arena-server";

// Hyperfocus GP: a few hot tokens to race right now (the same safety-checked momentum picks the old arena used).
export const dynamic = "force-dynamic";

export async function GET() {
  const hot = await hotMatches(6).catch(() => []);
  return NextResponse.json(
    hot.map((p: any) => ({ chain: p.chain, token: p.token, symbol: p.symbol || null, image: p.image || null, score: p.score ?? null, h1: p.change?.h1 ?? null })),
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
