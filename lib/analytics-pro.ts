/**
 * AUTISTIK Pro analysis: the same zone reading on three chart timeframes, whale activity, and the track record of
 * past signals (each checked 24 hours later). Server only.
 */
import { supabaseService } from "@/lib/supabase/server";
import { getCandles, type Frame } from "@/lib/market";
import { zones, type ZoneInput, type ZoneKind, type Zones } from "@/lib/analytics-zones";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const dir = (k: ZoneKind) => (k === "buy" || k === "breakout" ? 1 : k === "sell" || k === "falling" || k === "avoid" ? -1 : 0);

export type FrameRead = { frame: Frame; label: string; kind: ZoneKind; title: string };
export type Confluence = { frames: FrameRead[]; agree: number; verdict: string };

/** Reads the 15-minute and 4-hour charts the same way as the 1-hour one, and says how many agree. */
export async function confluence(chain: string, pair: string | null | undefined, base: Omit<ZoneInput, "candles">, hourly: Zones): Promise<Confluence> {
  const [m15, h4] = await Promise.all([getCandles(chain, pair, "15m"), getCandles(chain, pair, "4h")]);
  const frames: FrameRead[] = [
    { frame: "15m", label: "15 min", ...pick(m15.length >= 12 ? zones({ ...base, candles: m15 }) : null) },
    { frame: "1h", label: "1 hour", kind: hourly.kind, title: hourly.title },
    { frame: "4h", label: "4 hours", ...pick(h4.length >= 12 ? zones({ ...base, candles: h4 }) : null) },
  ];
  const d = dir(hourly.kind);
  const agree = frames.filter((f) => d !== 0 && dir(f.kind) === d).length;
  const verdict = d === 0 ? "No clear direction on the 1-hour chart, so wait for the timeframes to line up."
    : agree === 3 ? `All 3 timeframes agree: a high-confidence ${d > 0 ? "buy" : "sell"} signal.`
    : agree === 2 ? `2 of 3 timeframes agree: a decent ${d > 0 ? "buy" : "sell"} signal.`
    : `Only the 1-hour chart says ${d > 0 ? "buy" : "sell"}: a weak signal, so be careful.`;
  return { frames, agree, verdict };
}
function pick(z: Zones | null): { kind: ZoneKind; title: string } {
  return z ? { kind: z.kind, title: z.title } : { kind: "middle", title: "⏳ Not enough history yet" };
}

export type Whale = { wallet: string; net: number; pct: number };
/** Big wallets that bought or sold in the last 24 hours (0.25% of the supply or more, net). */
export function whales(trades: { wallet: string; side: "buy" | "sell"; amount: any; at: string }[], supply: number) {
  const since = Date.now() - 86_400_000, by = new Map<string, number>();
  for (const t of trades) if (Date.parse(t.at) > since) by.set(t.wallet, (by.get(t.wallet) || 0) + (t.side === "buy" ? 1 : -1) * n(t.amount));
  const list: Whale[] = [...by].map(([wallet, net]) => ({ wallet, net, pct: supply ? (net / supply) * 100 : 0 })).filter((w) => Math.abs(w.pct) >= 0.25);
  const buyers = list.filter((w) => w.net > 0).sort((a, b) => b.pct - a.pct), sellers = list.filter((w) => w.net < 0).sort((a, b) => a.pct - b.pct);
  const bought = buyers.reduce((a, w) => a + w.pct, 0), sold = -sellers.reduce((a, w) => a + w.pct, 0);
  const verdict = !list.length ? "No whale moves in the last 24 hours."
    : bought > sold * 1.5 ? `Whales are accumulating: ${buyers.length} bought ${bought.toFixed(2)}% of the supply, ${sellers.length} sold ${sold.toFixed(2)}%.`
    : sold > bought * 1.5 ? `Whales are taking profit: ${sellers.length} sold ${sold.toFixed(2)}% of the supply, ${buyers.length} bought ${bought.toFixed(2)}%.`
    : `Whales are split: ${bought.toFixed(2)}% bought vs ${sold.toFixed(2)}% sold.`;
  return { buyers: buyers.slice(0, 5), sellers: sellers.slice(0, 5), bought, sold, verdict, mood: bought > sold * 1.5 ? 1 : sold > bought * 1.5 ? -1 : 0 };
}

export type TrackRecord = { token: { right: number; total: number }; all: { right: number; total: number } };
/** How often buy and sell signals were right 24 hours later, for this token and across the whole site. */
export async function trackRecord(chain: string, token: string): Promise<TrackRecord> {
  const sb = supabaseService();
  const [{ data: mine }, { data: all }] = await Promise.all([
    sb.from("signal_history").select("kind,price,outcome_price").eq("chain", chain).eq("token", token).not("outcome_price", "is", null).limit(500),
    sb.from("signal_history").select("kind,price,outcome_price").not("outcome_price", "is", null).order("at", { ascending: false }).limit(2000),
  ]);
  const score = (rows: any[] | null) => {
    const graded = (rows || []).filter((r) => dir(r.kind) !== 0);
    return { right: graded.filter((r) => (dir(r.kind) > 0 ? n(r.outcome_price) > n(r.price) : n(r.outcome_price) < n(r.price))).length, total: graded.length };
  };
  return { token: score(mine), all: score(all) };
}
