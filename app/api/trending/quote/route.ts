import { json } from "@/lib/ai";
import { TREASURY, TRENDING_HOURS, TRENDING_USD, bnbPriceUsd, weiFor } from "@/lib/trending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// How much BNB a trending slot costs right now, and where to send it.
export async function GET() {
  if (!TREASURY) return json({ error: "Trending payments aren't open yet." }, 503);
  const price = await bnbPriceUsd();
  if (!price) return json({ error: "Couldn't get the BNB price right now. Try again in a minute." }, 502);
  return json({ usd: TRENDING_USD, hours: TRENDING_HOURS, treasury: TREASURY, bnbPrice: price, wei: weiFor(TRENDING_USD, price).toString() });
}
