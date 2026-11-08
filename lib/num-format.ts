/**
 * Numbers people read: money and token amounts, never in exponent form (no "1.2e-7").
 *  - Big numbers are grouped or shortened: 12,345.67 · 1.25M · 3.4B
 *  - Small amounts are rounded to 4 meaningful digits: 0.001234
 *  - Very small prices (meme coins) show the zeros as a small count, the way crypto sites do: $0.0₆1234 means
 *    $0.0000001234 (six zeros after the point).
 */
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const sub = (n: number) => String(n).split("").map((d) => SUB[+d]).join("");
const trim = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const group = (v: number, dec: number) => v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dec });
const short = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e12 ? `${trim((v / 1e12).toFixed(2))}T` : a >= 1e9 ? `${trim((v / 1e9).toFixed(2))}B` : a >= 1e6 ? `${trim((v / 1e6).toFixed(2))}M` : null;
};

/** A number below 1 with `sig` meaningful digits, in plain decimals (or the small-zero-count form when very small). */
function tiny(v: number, sig = 4, subAt = 6): string {
  const zeros = Math.max(0, Math.floor(-Math.log10(v)) - (Number.isInteger(Math.log10(v)) ? 1 : 0)); // zeros after "0."
  const fixed = v.toFixed(Math.min(100, zeros + sig));
  if (zeros < subAt) return trim(fixed);
  const digits = fixed.slice(2 + zeros).replace(/0+$/, "") || "0";
  return `0.0${sub(zeros)}${digits}`;
}

/** A token amount: 1,234.5678 · 0.0012 · 1.25M. Dust below 0.000001 shows as "<0.000001". */
export function fmtAmount(v: number | null | undefined): string {
  if (v == null || !isFinite(v) || v === 0) return "0";
  if (v < 0) return "-" + fmtAmount(-v);
  const s = short(v);
  if (s) return s;
  if (v >= 10_000) return group(v, 0);
  if (v >= 1000) return group(v, 2);
  if (v >= 1) return group(v, 4);
  if (v < 0.000001) return "<0.000001";
  return tiny(v, 4, 99);
}

/** A price or a dollar amount: $12,345.67 · $1.50 · $0.1234 · $0.0₆1234 · $1.25M. */
export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "–";
  if (v === 0) return "$0";
  if (v < 0) return "-" + fmtUsd(-v);
  const s = short(v);
  if (s) return "$" + s;
  if (v >= 1) return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const t = tiny(v, 4);
  return "$" + (/^0\.\d$/.test(t) ? t + "0" : t); // $0.5 → $0.50
}

/** What something is worth (a balance): like fmtUsd, but tiny values read "<$0.01" instead of long decimals. */
export function fmtValue(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "–";
  if (v === 0) return "$0.00";
  if (v > 0 && v < 0.01) return "<$0.01";
  if (v < 1) return "$" + v.toFixed(2);
  return fmtUsd(v);
}

/** A plain number with no currency (prices in BNB, SOL…): 4 meaningful digits, never an exponent. */
export function fmtNum(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "–";
  if (v === 0) return "0";
  if (v < 0) return "-" + fmtNum(-v);
  const s = short(v);
  if (s) return s;
  if (v >= 1) return group(v, v >= 1000 ? 2 : 4);
  return tiny(v, 4);
}

/** A number to put in an input box (no grouping, no exponent, at most `dec` decimals). */
export function plainNum(v: number, dec = 8): string {
  if (!isFinite(v) || v <= 0) return "0";
  return trim(v.toFixed(Math.min(20, dec)));
}
