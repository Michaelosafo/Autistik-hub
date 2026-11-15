import { rateLimit } from "@/lib/ratelimit";
import { json } from "@/lib/ai";
import { TREASURY, bnbPriceUsd, weiFor } from "@/lib/trending";
import { BADGE_USD, BADGE_DAYS } from "@/lib/badge-pay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What the sticker badge costs right now in BNB, and where to send it.
export async function GET(req: Request) {
  const slow = await rateLimit(req, "badge-quote", 60, 60);
  if (slow) return slow;
  if (!TREASURY) return json({ error: "Badge payments aren't open yet." }, 503);
  const price = await bnbPriceUsd();
  if (!price) return json({ error: "Couldn't get the BNB price right now. Try again in a minute." }, 502);
  return json({ usd: BADGE_USD, days: BADGE_DAYS, treasury: TREASURY, bnbPrice: price, wei: weiFor(BADGE_USD, price).toString() });
}
