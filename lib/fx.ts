/**
 * Forex helpers shared by the server and the page. Hyperliquid's currency markets are named "xyz:EUR", "xyz:JPY", …
 * and are quoted either as the currency in dollars (EUR ≈ 1.14) or as dollars in that currency (JPY ≈ 150). The price
 * tells which, so these work out the usual pair name and which way the price goes when the dollar gets stronger.
 */
export const isFx = (coin: string) => coin.startsWith("xyz:");
export const fxCode = (coin: string) => coin.replace(/^[^:]+:/, "");

/** +1 if this market's price rises when the US dollar strengthens, -1 if it falls. */
export function usdSign(coin: string, price: number): 1 | -1 {
  const c = fxCode(coin);
  if (c === "DXY") return 1;
  if (["EUR", "GBP", "AUD", "NZD"].includes(c)) return -1;
  if (c === "CHF") return price > 1 ? -1 : 1;
  // CAD, JPY, KRW, CNH, MXN, …: above 1 it's dollars in that currency (USD/JPY ≈ 150), below 1 it's that currency in dollars.
  return price > 1 ? 1 : -1;
}

/** "EUR/USD", "USD/JPY", "DXY (dollar index)"; crypto coins come back as they are. */
export function fxLabel(coin: string, price?: number | null) {
  if (!isFx(coin)) return coin;
  const c = fxCode(coin);
  if (c === "DXY") return "DXY (dollar index)";
  return usdSign(coin, Number(price) || (["EUR", "GBP", "AUD", "NZD", "CHF"].includes(c) ? 1.1 : 100)) < 0 ? `${c}/USD` : `USD/${c}`;
}

/** Forex is closed from Friday 21:00 to Sunday 21:00 (UTC): prices freeze or gap, so no new trades then. */
export function fxOpen(now = new Date()) {
  const d = now.getUTCDay(), h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (d === 6) return false;
  if (d === 5 && h >= 20.5) return false; // last half hour before the close too: thin and gappy
  if (d === 0 && h < 21.5) return false; // and the first half hour after the open
  return true;
}
/** Friday evening: forex trades are closed before the weekend gap. */
export const fxWeekendSoon = (now = new Date()) => now.getUTCDay() === 5 && now.getUTCHours() + now.getUTCMinutes() / 60 >= 20.25;
