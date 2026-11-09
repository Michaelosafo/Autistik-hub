/**
 * Rug guard for EVERY AI trader buy (signals, chart setups and momentum picks). A coin is bought only if ALL of
 * these pass; if any check can't be done (an API is down, no data yet) the coin is NOT bought:
 *  1. DexScreener: it has a pool and its market cap is between $1K and $60K.
 *  2. The pool is at least 90% locked or burned (what DexScreener's lock bar shows; DexScreener's API doesn't give
 *     the lock, so it's read from GoPlus on EVM chains and RugCheck on Solana).
 *  3. Buy tax and sell tax are each 2% or less. GoPlus, Honeypot.is (BNB Chain / Ethereum) and the wallet's own
 *     check must all agree.
 *  4. It isn't a honeypot and the owner has no dangerous powers (mint, hidden owner, blacklist, pause, tax change…).
 * A honeypot / not-yet-sellable coin comes back with honeypot: true, so the trader puts it on its watch list and
 * re-checks it every minute: it's bought only once it can be sold and passes everything above while under $60K.
 * Server only.
 */

export const SAFETY = {
  MCAP_MIN: 1_000,
  MCAP_MAX: 60_000,
  MAX_TAX: 2, // %, buy and sell each
  LP_LOCKED: 0.9, // share of the pool that must be locked or burned
  MAX_HOLDER: 0.15, // creator / owner may hold at most 15%
  WATCH_HOURS: 6, // a watched honeypot is dropped after this long
};

export type RiskIn = { honeypot?: boolean; level?: string; buyTax?: number; sellTax?: number } | null | undefined;
export type Gate =
  | { ok: true; mcap: number; buyTax: number; sellTax: number }
  | { ok: false; reason: string; honeypot: boolean; mcap: number | null };
type Fail = { reason: string; honeypot: boolean } | null;
type Taxes = { buy: number; sell: number };

const num = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const get = (url: string): Promise<any> =>
  fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
const fail = (reason: string, honeypot = false): Fail => ({ reason, honeypot });
const pct = (x: number) => `${x.toFixed(1).replace(/\.0$/, "")}%`;
const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

const GOPLUS_ID: Record<string, number> = { bsc: 56, ethereum: 1, robinhood: 4663 };
const HONEYPOT_IS_ID: Record<string, number> = { bsc: 56, ethereum: 1 };
const DEAD = /^0x0{40}$|^0x0{36}dead$/i;

/** Market cap of the coin's deepest DexScreener pool (null if it has no pool yet). */
export async function dexMcap(chain: string, token: string): Promise<number | null> {
  const pairs = await get(`https://api.dexscreener.com/tokens/v1/${chain}/${token}`);
  const best = (Array.isArray(pairs) ? pairs : [])
    .filter((p: any) => String(p?.baseToken?.address || "").toLowerCase() === token.toLowerCase())
    .sort((a: any, b: any) => num(b?.liquidity?.usd) - num(a?.liquidity?.usd))[0];
  if (!best) return null;
  return num(best.marketCap) || num(best.fdv) || null;
}

/** GoPlus (BNB Chain, Ethereum, Robinhood Chain): honeypot, owner powers, taxes, pool lock, creator share. */
async function goplus(chain: string, token: string, maxTax: number, tax: Taxes): Promise<Fail> {
  const j = await get(`https://api.gopluslabs.io/api/v1/token_security/${GOPLUS_ID[chain]}?contract_addresses=${token}`);
  const r = j?.result?.[token.toLowerCase()];
  if (!r) return fail("no GoPlus safety data yet");
  const on = (k: string) => String(r[k]) === "1";
  if (on("is_honeypot") || on("cannot_sell_all") || on("cannot_buy") || on("transfer_pausable")) return fail("honeypot: buying or selling is blocked (GoPlus)", true);
  if (on("hidden_owner") || on("can_take_back_ownership") || on("owner_change_balance") || on("selfdestruct")) return fail("the owner keeps dangerous powers");
  if (on("is_mintable")) return fail("the owner can mint more coins");
  if (on("slippage_modifiable") || on("personal_slippage_modifiable")) return fail("the owner can raise the tax later");
  if (on("is_blacklisted") || on("trading_cooldown") || on("external_call")) return fail("the contract can block wallets or trades");
  if (String(r.is_open_source) !== "1") return fail("the contract code isn't verified");
  if (r.buy_tax == null || r.buy_tax === "" || r.sell_tax == null || r.sell_tax === "") return fail("can't be traded yet (no tax reading)", true);
  const bt = num(r.buy_tax) * 100, st = num(r.sell_tax) * 100;
  tax.buy = Math.max(tax.buy, bt); tax.sell = Math.max(tax.sell, st);
  if (bt > maxTax || st > maxTax) return fail(`tax too high (buy ${pct(bt)}, sell ${pct(st)}; max ${pct(maxTax)})`);
  const lp: any[] = Array.isArray(r.lp_holders) ? r.lp_holders : [];
  if (!lp.length) return fail("can't see who owns the pool");
  const locked = lp.reduce((a, h) => a + (String(h?.is_locked) === "1" || DEAD.test(String(h?.address || "")) ? num(h?.percent) : 0), 0);
  if (locked < SAFETY.LP_LOCKED) return fail(`only ${Math.round(locked * 100)}% of the pool is locked or burned (needs ${SAFETY.LP_LOCKED * 100}%)`);
  const holder = Math.max(num(r.creator_percent), num(r.owner_percent));
  if (holder > SAFETY.MAX_HOLDER) return fail(`the creator still holds ${Math.round(holder * 100)}% of the coins`);
  return null;
}

/** Honeypot.is (BNB Chain, Ethereum): a simulated buy and sell, with the real taxes. */
async function honeypotIs(chain: string, token: string, maxTax: number, tax: Taxes): Promise<Fail> {
  const j = await get(`https://api.honeypot.is/v2/IsHoneypot?address=${token}&chainID=${HONEYPOT_IS_ID[chain]}`);
  if (!j) return fail("Honeypot.is didn't answer");
  if (j.honeypotResult?.isHoneypot) return fail("honeypot (Honeypot.is)", true);
  const sim = j.simulationResult;
  if (j.simulationSuccess === false || !sim) return fail("a test sell failed (Honeypot.is)", true);
  const bt = num(sim.buyTax), st = num(sim.sellTax);
  tax.buy = Math.max(tax.buy, bt); tax.sell = Math.max(tax.sell, st);
  if (bt > maxTax || st > maxTax) return fail(`tax too high on a test trade (buy ${pct(bt)}, sell ${pct(st)}; max ${pct(maxTax)})`);
  return null;
}

/** RugCheck (Solana): mint / freeze authority, transfer fee, danger flags and pool lock. */
async function rugcheck(token: string, maxTax: number, tax: Taxes): Promise<Fail> {
  const j = await get(`https://api.rugcheck.xyz/v1/tokens/${token}/report`);
  if (!j) return fail("no RugCheck data yet");
  if (j.freezeAuthority) return fail("wallets can be frozen (freeze authority not revoked)", true);
  if (j.mintAuthority) return fail("the creator can mint more coins (mint authority not revoked)");
  const fee = num(j.transferFee?.pct);
  tax.buy = Math.max(tax.buy, fee); tax.sell = Math.max(tax.sell, fee);
  if (fee > maxTax) return fail(`transfer fee ${pct(fee)} (max ${pct(maxTax)})`);
  const danger = (Array.isArray(j.risks) ? j.risks : []).find((r: any) => r?.level === "danger");
  if (danger) return fail(`RugCheck: ${String(danger.name || "danger flag").slice(0, 80)}`);
  const markets: any[] = Array.isArray(j.markets) ? j.markets : [];
  const locked = markets.reduce((a, m) => Math.max(a, num(m?.lp?.lpLockedPct)), 0) / 100;
  if (locked < SAFETY.LP_LOCKED) return fail(`only ${Math.round(locked * 100)}% of the pool is locked or burned (needs ${SAFETY.LP_LOCKED * 100}%)`);
  return null;
}

/**
 * The whole rug guard. `risk` is the wallet's own honeypot / tax check (riskOf), `maxTax` the trader's tax setting
 * (never above 2%).
 */
export async function safetyGate(chain: string, token: string, risk: RiskIn, maxTax: number): Promise<Gate> {
  const limit = maxTax > 0 ? Math.min(maxTax, SAFETY.MAX_TAX) : SAFETY.MAX_TAX;
  const mcap = await dexMcap(chain, token);
  const no = (f: NonNullable<Fail>): Gate => ({ ok: false, reason: f.reason, honeypot: f.honeypot, mcap });
  if (mcap == null) return no({ reason: "no DexScreener pool or market cap yet", honeypot: false });
  if (mcap < SAFETY.MCAP_MIN || mcap > SAFETY.MCAP_MAX) return no({ reason: `market cap ${usd(mcap)} is outside ${usd(SAFETY.MCAP_MIN)}–${usd(SAFETY.MCAP_MAX)}`, honeypot: false });
  if (!risk) return no({ reason: "the safety check didn't answer", honeypot: false });
  if (risk.honeypot) return no({ reason: "honeypot (wallet check)", honeypot: true });
  if (risk.level === "danger") return no({ reason: "flagged as dangerous", honeypot: false });
  const tax: Taxes = { buy: num(risk.buyTax), sell: num(risk.sellTax) };
  if (tax.buy > limit || tax.sell > limit) return no({ reason: `tax too high (buy ${pct(tax.buy)}, sell ${pct(tax.sell)}; max ${pct(limit)})`, honeypot: false });

  let checks: Promise<Fail>[];
  if (chain === "solana") checks = [rugcheck(token, limit, tax)];
  else if (GOPLUS_ID[chain]) checks = [goplus(chain, token, limit, tax), ...(HONEYPOT_IS_ID[chain] ? [honeypotIs(chain, token, limit, tax)] : [])];
  else return no({ reason: `no rug check for ${chain}`, honeypot: false });

  const fails = (await Promise.all(checks)).filter(Boolean) as NonNullable<Fail>[];
  // A honeypot result wins, so the coin is watched rather than forgotten.
  const f = fails.find((x) => x.honeypot) || fails[0];
  if (f) return no(f);
  return { ok: true, mcap, buyTax: +tax.buy.toFixed(2), sellTax: +tax.sell.toFixed(2) };
}
