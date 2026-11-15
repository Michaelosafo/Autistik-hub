/**
 * 👥 Copy (server only): copies wallets you pick on Solana, BNB Chain and Ethereum. When one of them buys a coin, Copy buys it too; when that
 * wallet sells, Copy sells the same share (they sell half, Copy sells half; they sell it all, Copy sells it all).
 *
 * Its own desk (COPY_DESK + the admin's trader id) on the AI Futures tables, trading from the Solana wallet it shares
 * with Sniper and Turbo, with its own budget (moved in like Sniper's). Buys go through Relay first (same-chain swap on
 * Solana), with Jupiter as the fallback, and sells go back into USDT.
 *
 * Speed: the wallets are checked about every second for the whole minute, not once a minute.
 * Low profile: each copy waits a random 0.3–1.8 s and buys a slightly different amount (±12%), so its trades don't
 * line up exactly with the wallet it copies. Everything on a blockchain is public, so this lowers the chance of being
 * noticed but can't promise it.
 *
 * BNB Chain / Ethereum wallets: Copy has its own EVM wallet there. A buy is paid from the shared Solana wallet's USDT /
 * USDC and delivered by Relay straight into the EVM wallet as the coin (or, for coins Relay can't route, such as
 * four.meme launch curves: Relay brings the chain's own coin, then it buys on the chain). Sells go back to USDT on
 * Solana through Relay (or into USDT on that chain if Relay can't). A little BNB / ETH is kept there for gas and
 * topped up from Solana by itself.
 *
 * Safety: a stop-loss (default -50%) watched every few seconds, a budget it never goes past, max open trades, the
 * daily loss limit, and coins flagged as scams by Jupiter (or with almost no liquidity) are skipped.
 * Practice: pretend dollars at real prices (1% slippage and 1% fees each way). Live: real swaps.
 */
import { supabaseService } from "@/lib/supabase/server";
import { T } from "@/lib/ai-trader-ctx";
import { flog, futAccount, futSolAccount, type FPos, type FSettings } from "@/lib/ai-futures";
import { resolve } from "@/lib/ai-signals";
import { profitLocked, trackPeak } from "@/lib/ai-judge";
import { ownShare, snipeCfg, snipeEquity } from "@/lib/ai-sniper";

const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const sb = () => supabaseService();
const pos = () => sb().from("ai_futures_positions");
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag";
const RPC = process.env.COPY_SOLANA_RPC || process.env.WALLET_SOLANA_RPC || process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
/** Money-like coins: moving these is not a "buy" to copy. */
const MONEY = new Set([WSOL, USDC, USDT, "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export type EvmChain = "bsc" | "ethereum";
export const EVM_CHAINS: EvmChain[] = ["bsc", "ethereum"];
export const CHAIN_NAME: Record<string, string> = { solana: "Solana", bsc: "BNB Chain", ethereum: "Ethereum" };
export type CopyWallet = { address: string; chain?: "solana" | EvmChain; label?: string; usd?: number; on?: boolean };
export const isSolAddr = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
export const isEvmAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const chainOf = (w: CopyWallet) => (w.chain && w.chain !== "solana" ? w.chain : "solana");
export const copyWallets = (s: FSettings): CopyWallet[] => (Array.isArray((s as any).copy_wallets) ? (s as any).copy_wallets : [])
  .filter((w: any) => w && (chainOf(w) === "solana" ? isSolAddr(String(w.address || "")) : isEvmAddr(String(w.address || ""))));
/** EVM trades are stored as "bsc:0x…" / "ethereum:0x…"; Solana ones as the plain mint. */
const split = (coin: string): { chain: "solana" | EvmChain; token: string } => {
  const m = /^(bsc|ethereum):(0x[0-9a-fA-F]{40})$/.exec(coin);
  return m ? { chain: m[1] as EvmChain, token: m[2] } : { chain: "solana", token: coin };
};
const EVM_MONEY: Record<EvmChain, Set<string>> = {
  bsc: new Set(["0x55d398326f99059ff775485246999027b3197955", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "0xe9e7cea3dedca5984780bafc599bd69add087d56", "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d"]),
  ethereum: new Set(["0xdac17f958d2ee523a2206206994597c13d831ec7", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "0x6b175474e89094c44da98b954eedeac495271d0f"]),
};

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(6000) });
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.error) throw new Error(`Solana RPC: ${j?.error?.message || r.status}`);
  return j.result;
}
async function get(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** mint: the Solana mint, or "bsc:0x…" / "ethereum:0x…" for EVM coins. */
type Move = { wallet: CopyWallet; sig: string; mint: string; kind: "buy" | "sell"; frac: number };

/** A wallet's coin changes in one transaction: coins up = it bought, coins down = it sold (and what share). */
function movesIn(tx: any, w: CopyWallet, sig: string): Move[] {
  if (!tx?.meta || tx.meta.err) return [];
  const sum = (list: any[]) => {
    const m = new Map<string, number>();
    for (const b of list || []) if (b?.owner === w.address && !MONEY.has(b.mint)) m.set(b.mint, (m.get(b.mint) || 0) + n(b.uiTokenAmount?.uiAmount ?? b.uiTokenAmount?.uiAmountString));
    return m;
  };
  const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
  const out: Move[] = [];
  for (const mint of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(mint) || 0, b = post.get(mint) || 0;
    if (b > a * 1.0001 && b - a > 0) out.push({ wallet: w, sig, mint, kind: "buy", frac: 0 });
    else if (b < a * 0.9999 && a > 0) out.push({ wallet: w, sig, mint, kind: "sell", frac: Math.min(1, (a - b) / a) });
  }
  return out;
}

/**
 * New trades by the copied wallets since last time (oldest first). The first time a wallet is seen, only its newest
 * transaction is remembered: its old trades are never copied.
 */
async function newMoves(s: FSettings): Promise<Move[]> {
  const seen: Record<string, string> = { ...((s as any).copy_seen || {}) };
  const out: Move[] = [];
  let changed = false;
  const live = copyWallets(s).filter((w) => w.on !== false);
  // BNB Chain / Ethereum: coin transfers in and out of the wallets, in transactions the wallet itself sent.
  await Promise.all(EVM_CHAINS.map(async (chain) => {
    const ws = live.filter((w) => chainOf(w) === chain);
    if (!ws.length) return;
    const r = await evmMoves(chain, ws, Number(seen[`${chain}:block`]) || 0).catch(() => null);
    if (!r) return;
    if (String(r.head) !== String(seen[`${chain}:block`])) { seen[`${chain}:block`] = String(r.head); changed = true; }
    out.push(...r.moves);
  }));
  await Promise.all(live.filter((w) => chainOf(w) === "solana").map(async (w) => {
    const last = seen[w.address];
    const sigs: any[] = await rpc("getSignaturesForAddress", [w.address, { limit: 12, commitment: "confirmed", ...(last ? { until: last } : {}) }]).catch(() => []);
    if (!sigs.length) return;
    seen[w.address] = sigs[0].signature; changed = true;
    if (!last) return;
    for (const it of sigs.slice().reverse()) {
      if (it.err) continue;
      const tx = await rpc("getTransaction", [it.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]).catch(() => null);
      out.push(...movesIn(tx, w, it.signature));
    }
  }));
  if (changed) { await sb().from("ai_futures_settings").update({ copy_seen: seen }).eq("id", T()); (s as any).copy_seen = seen; }
  return out;
}

const TRANSFER = { type: "event", name: "Transfer", inputs: [{ type: "address", name: "from", indexed: true }, { type: "address", name: "to", indexed: true }, { type: "uint256", name: "value", indexed: false }] } as const;
const ERC20_BAL = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address", name: "a" }], outputs: [{ type: "uint256", name: "" }] }] as const;

/** New EVM buys / sells by the copied wallets since block `last` (first time: just remembers the newest block). */
async function evmMoves(chain: EvmChain, ws: CopyWallet[], last: number): Promise<{ head: number; moves: Move[] }> {
  const { evmClient } = await import("@/lib/ai-trader-chains");
  const c = evmClient(chain);
  const head = Number(await c.getBlockNumber());
  if (!last || head - last > 200) return { head, moves: [] }; // first look (or a long gap): never copy old trades
  if (head <= last) return { head: last, moves: [] };
  const from = BigInt(last + 1), to = BigInt(Math.min(head, last + 60));
  const addrs = ws.map((w) => w.address as `0x${string}`);
  const [ins, outs] = await Promise.all([
    c.getLogs({ event: TRANSFER, args: { to: addrs }, fromBlock: from, toBlock: to }),
    c.getLogs({ event: TRANSFER, args: { from: addrs }, fromBlock: from, toBlock: to }),
  ]);
  const senders = new Map<string, string>();
  const sender = async (h: string) => {
    if (!senders.has(h)) senders.set(h, String((await c.getTransaction({ hash: h }).catch(() => null))?.from || "").toLowerCase());
    return senders.get(h)!;
  };
  // Sum per transaction, wallet and coin.
  const agg = new Map<string, { w: CopyWallet; tx: string; token: string; inn: bigint; out: bigint }>();
  const add = (l: any, who: string, dir: "inn" | "out") => {
    const token = String(l.address).toLowerCase();
    if (EVM_MONEY[chain].has(token)) return;
    const w = ws.find((x) => x.address.toLowerCase() === who.toLowerCase());
    if (!w) return;
    const k = `${l.transactionHash}|${w.address}|${token}`;
    const a = agg.get(k) || { w, tx: String(l.transactionHash), token, inn: 0n, out: 0n };
    a[dir] += BigInt(l.args?.value ?? 0);
    agg.set(k, a);
  };
  for (const l of ins as any[]) add(l, String(l.args?.to || ""), "inn");
  for (const l of outs as any[]) add(l, String(l.args?.from || ""), "out");
  const moves: Move[] = [];
  for (const a of agg.values()) {
    // Only trades the wallet made itself (tokens sent to it by others, like airdrop spam, are ignored).
    if ((await sender(a.tx)) !== a.w.address.toLowerCase()) continue;
    const mint = `${chain}:${a.token}`;
    if (a.inn > a.out) moves.push({ wallet: a.w, sig: a.tx, mint, kind: "buy", frac: 0 });
    else if (a.out > a.inn) {
      const left = BigInt(await c.readContract({ address: a.token as `0x${string}`, abi: ERC20_BAL, functionName: "balanceOf", args: [a.w.address as `0x${string}`] }).catch(() => 0n));
      const sold = a.out - a.inn;
      moves.push({ wallet: a.w, sig: a.tx, mint, kind: "sell", frac: Math.min(1, Number(sold) / Number(sold + left || 1n)) });
    }
  }
  return { head: Number(to), moves };
}

async function wallets() {
  const kp = await futSolAccount();
  if (!kp) throw new Error("Create or import the shared Solana wallet first (Copy page).");
  return { sol: kp, evm: null };
}

/** Coin facts from Jupiter: price, symbol, liquidity and its scam flags. */
async function coinInfo(mint: string) {
  const sp = split(mint);
  if (sp.chain !== "solana") {
    const f = await resolve({ chain: sp.chain, token: sp.token }, [sp.chain]).catch(() => null);
    return f ? { symbol: f.symbol || sp.token.slice(0, 6), price: f.price, liq: f.liquidity, sus: false } : null;
  }
  const list = await get(`${JUP}/tokens/v2/search?query=${mint}`).catch(() => []);
  const t = (Array.isArray(list) ? list : []).find((x: any) => x?.id === mint);
  return t ? { symbol: String(t.symbol || mint.slice(0, 4)), price: n(t.usdPrice), liq: n(t.liquidity), sus: t.audit?.isSus === true || t.audit?.freezeAuthorityDisabled === false } : null;
}
async function priceOf(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const sol = [...new Set(mints.filter((m) => split(m).chain === "solana"))];
  const evm = [...new Set(mints.filter((m) => split(m).chain !== "solana"))];
  const [j] = await Promise.all([
    sol.length ? get(`${JUP}/price/v3?ids=${sol.join(",")}`).catch(() => null) : Promise.resolve(null),
    ...evm.map(async (m) => { const sp = split(m); out[m] = n((await resolve({ chain: sp.chain, token: sp.token }, [sp.chain]).catch(() => null))?.price); }),
  ]);
  for (const m of sol) out[m] = n((j as any)?.[m]?.usdPrice);
  return out;
}

/** The Copy desk's EVM wallet (BNB Chain / Ethereum) and its gas. */
export async function copyEvm() {
  const a = await futAccount();
  if (!a) return null;
  const c = await import("@/lib/ai-trader-chains");
  const w = { sol: null, evm: a };
  const [bnb, eth] = await Promise.all([c.chainBalance("bsc", w).catch(() => null), c.chainBalance("ethereum", w).catch(() => null)]);
  return { address: a.address, bnb, eth };
}

/** Keep a little BNB / ETH for gas in the EVM wallet: tops it up from the Solana wallet's stablecoins (Relay). */
async function gasUp(chain: EvmChain) {
  const c = await import("@/lib/ai-trader-chains");
  const a = await futAccount(), kp = await futSolAccount();
  if (!a || !kp) return;
  const bal = await c.chainBalance(chain, { sol: null, evm: a }).catch(() => 0);
  if (bal >= c.GAS_KEEP[chain] * 1.5) return;
  const st = await c.bestStable("solana", { sol: kp, evm: null });
  const usd = chain === "bsc" ? 2 : 8;
  if (!st || st.balance < usd) { await flog("error", `${CHAIN_NAME[chain]} gas is low and the Solana wallet has no $${usd} of USDT / USDC to top it up.`); return; }
  await c.solFundChain(kp, a.address, st, usd, chain, "native");
  await flog("transfer", `⛽ Topped up ${CHAIN_NAME[chain]} gas with $${usd} from the Solana wallet (Relay).`);
}

/** Live EVM buy: Solana USDT / USDC → the coin in the EVM wallet. Returns the coins received. */
async function evmBuy(chain: EvmChain, token: string, usd: number): Promise<{ raw: bigint; decimals: number; tx: string | null; route: string }> {
  const c = await import("@/lib/ai-trader-chains");
  const a = await futAccount(), kp = await futSolAccount();
  if (!a) throw new Error("Create Copy's EVM wallet first (Copy page).");
  if (!kp) throw new Error("Create or import the shared Solana wallet first.");
  const w = { sol: kp, evm: a };
  const st = await c.bestStable("solana", w);
  if (!st || st.balance < usd) throw new Error(`the Solana wallet needs $${usd.toFixed(2)} of USDT / USDC for this (EVM buys are paid from it)`);
  const before = await c.tokenBalanceOn(chain, w, token);
  const arrived = async (tries: number) => {
    for (let i = 0; i < tries; i++) {
      await sleep(2000);
      const b = await c.tokenBalanceOn(chain, w, token).catch(() => before);
      if (b.raw > before.raw) return { raw: b.raw - before.raw, decimals: b.decimals };
    }
    return null;
  };
  let tx: string | null = null, route = "Relay";
  try {
    const r = await c.solRelayToToken(kp, a.address, st, usd, chain, token);
    tx = r.sigs[r.sigs.length - 1] || null;
  } catch (e) {
    // No direct route (launch curves and thin coins): Relay brings the chain's own coin, then it buys on the chain.
    if (/sent|confirm|timeout/i.test((e as Error).message)) { const g = await arrived(15); if (g) return { ...g, tx, route }; }
    const nat0 = await c.chainBalance(chain, w);
    await c.solFundChain(kp, a.address, st, usd, chain, "native");
    let got = 0;
    for (let i = 0; i < 30 && got <= 0; i++) { await sleep(2000); got = (await c.chainBalance(chain, w).catch(() => nat0)) - nat0; }
    if (got <= 0) throw new Error("the money sent to the EVM wallet hasn't arrived yet; it'll be there for the next buy");
    const r = await c.liveBuyOn(chain, w, token, got * 0.97, 10);
    if (!(r.raw > 0n)) throw new Error("the swap went through but no coins arrived");
    gasUp(chain).catch(() => {});
    return { raw: r.raw, decimals: r.decimals, tx: r.hash, route: "Relay + DEX" };
  }
  const g = await arrived(30);
  if (!g) throw new Error("Relay hasn't delivered the coins yet (it may still arrive; check the wallet)");
  gasUp(chain).catch(() => {});
  return { ...g, tx, route };
}

/** Live EVM sell of `raw` coins: back to USDT on Solana (Relay), else into USDT on that chain. Returns dollars. */
async function evmSell(chain: EvmChain, token: string, part: number, all: boolean, panic: boolean): Promise<{ got: number; tx: string | null; note: string }> {
  const c = await import("@/lib/ai-trader-chains");
  const a = await futAccount(), kp = await futSolAccount();
  if (!a) throw new Error("Copy's EVM wallet is missing.");
  const w = { sol: kp, evm: a };
  const bal = await c.tokenBalanceOn(chain, w, token);
  const raw = all ? bal.raw : BigInt(Math.floor(Number(bal.raw) * part));
  if (raw <= 0n) return { got: 0, tx: null, note: " (the wallet held none of it any more)" };
  await gasUp(chain).catch(() => {});
  if (kp) {
    try {
      const r = await c.evmRelayToSol(a, chain, token, raw, kp.publicKey.toBase58(), USDT);
      return { got: n(r.receive), tx: r.hashes[r.hashes.length - 1] || null, note: "" };
    } catch { /* no Relay route: sell on the chain */ }
  }
  const st = c.STABLES[chain]![0];
  const r = await c.liveSellOn(chain, w, token, raw, 10, panic ? 2000 : 0, st);
  return { got: r.receivedNative, tx: r.hash, note: ` (kept as USDT on ${CHAIN_NAME[chain]})` };
}

async function copyBuy(s: FSettings, mv: Move): Promise<string> {
  const cfg = snipeCfg(s);
  const { data: open } = await pos().select("id,coin").eq("fut_id", T()).in("status", ["open", "closing"]);
  if ((open || []).some((p: any) => p.coin === mv.mint)) return "already holding it";
  if ((open?.length || 0) >= s.max_positions) return `holding ${open?.length} of ${s.max_positions} trades`;
  const info = await coinInfo(mv.mint);
  if (!info || !(info.price > 0)) return "no price for it yet";
  if (info.sus) { await flog("skip", `🛡 Skipped ${info.symbol}: Jupiter flags it as a likely scam.`); return "flagged as a scam"; }
  if (info.liq > 0 && info.liq < 2000) return `too little liquidity ($${Math.round(info.liq)})`;
  const eq = await snipeEquity(s);
  const base = Math.max(1, n(mv.wallet.usd) || cfg.usd);
  const usd = +Math.min(base * (0.88 + Math.random() * 0.24), eq.free).toFixed(2); // ±12%: never exactly the same size
  if (usd < 1) return s.mode === "live" ? `budget used up ($${eq.free.toFixed(2)} free): move more money to Copy` : `not enough practice money ($${eq.free.toFixed(2)})`;
  await sleep(300 + Math.random() * 1500); // a short random wait, so it never lands in the same moment as the wallet
  let entry = info.price * 1.01, qty = usd / entry, tx: string | null = null, route = "";
  const sp = split(mv.mint);
  if (s.mode === "live" && sp.chain !== "solana") {
    const r = await evmBuy(sp.chain, sp.token, usd);
    qty = Number(r.raw) / 10 ** r.decimals; entry = usd / qty; tx = r.tx; route = r.route;
  } else if (s.mode === "live") {
    const c = await import("@/lib/ai-trader-chains");
    const w = await wallets();
    const before = await c.tokenBalanceOn("solana", w, mv.mint);
    const st = await c.bestStable("solana", w);
    const solUsd = st && st.balance >= usd ? 0 : await c.nativeUsd("solana");
    if (!(st && st.balance >= usd) && !(solUsd > 0)) return "couldn't price SOL";
    const arrived = async (tries: number, gap: number) => {
      for (let i = 0; i < tries; i++) {
        const b = await c.tokenBalanceOn("solana", w, mv.mint).catch(() => before);
        if (b.raw > before.raw) return { raw: b.raw - before.raw, decimals: b.decimals || before.decimals || 6 };
        await sleep(gap);
      }
      return null;
    };
    let got: { raw: bigint; decimals: number } | null = null, relayErr = "";
    try {
      const sigs = await c.relaySolSwap(w.sol, st && st.balance >= usd ? st.token : c.SOL_NATIVE_RELAY, mv.mint,
        st && st.balance >= usd ? BigInt(Math.floor(usd * 10 ** st.decimals)) : BigInt(Math.floor((usd / solUsd) * 1e9)));
      tx = sigs[sigs.length - 1]; route = "Relay";
      got = await arrived(8, 1500);
    } catch (e) {
      relayErr = (e as Error).message;
      if (/sent|confirm|timeout/i.test(relayErr)) got = await arrived(6, 2000); // sent but slow: never buy twice
    }
    if (!got) {
      const r = st && st.balance >= usd ? await c.liveBuyOn("solana", w, mv.mint, usd, 5, st) : await c.liveBuyOn("solana", w, mv.mint, usd / solUsd, 5, null);
      if (!(r.raw > 0n)) return `the swap went through but no coins arrived${relayErr ? ` (Relay: ${relayErr.slice(0, 60)})` : ""}`;
      got = { raw: r.raw, decimals: r.decimals }; tx = r.hash; route = "Jupiter";
    }
    qty = Number(got.raw) / 10 ** got.decimals;
    entry = usd / qty;
  } else {
    await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd - usd }).eq("id", T());
    s.paper_usd -= usd;
  }
  const who = mv.wallet.label || short(mv.wallet.address);
  await pos().insert({
    fut_id: T(), mode: s.mode, venue: "copy", coin: mv.mint, side: "long", lev: 1, margin_usd: usd, notional_usd: usd,
    entry, stop: entry * (1 - cfg.sl / 100), target: entry * (1 + cfg.tp / 100), liq: null, best: entry, last: entry, size: qty,
    fees_usd: s.mode === "paper" ? usd * 0.01 : 0, why: `${info.symbol}: copied ${who}`, open_tx: tx, risk_usd: usd * cfg.sl / 100,
    equity_at_open: eq.total, copy_from: mv.wallet.address,
  });
  const link = sp.chain === "solana" ? `https://solscan.io/tx/${mv.sig}` : `${sp.chain === "bsc" ? "https://bscscan.com" : "https://etherscan.io"}/tx/${mv.sig}`;
  await flog("open", `👥 Bought ${info.symbol}${sp.chain !== "solana" ? ` on ${CHAIN_NAME[sp.chain]}` : ""} for $${usd.toFixed(2)}${route ? ` via ${route}` : ""}${s.mode === "paper" ? " (practice)" : ""}: ${who} just bought it. ${link}`);
  return `bought ${info.symbol}`;
}

/** Sell `frac` (0–1) of a copy trade. The sold part is recorded as its own closed trade; the rest stays open. */
export async function sellCopy(s: FSettings, p: FPos, frac: number, reason: string, price?: number) {
  const all = frac >= 0.85; // they sold most of it: sell everything (leftover dust is useless)
  const { data: claimed } = await pos().update({ status: "closing" }).eq("id", p.id).eq("status", "open").select("id");
  if (!claimed?.length) return;
  const part = all ? 1 : frac;
  try {
    let px = price || n(p.last) || n(p.entry), got = 0, tx: string | null = null;
    const sp = split(p.coin);
    if (p.mode === "live" && sp.chain !== "solana") {
      const r = await evmSell(sp.chain, sp.token, part, all, /stop/i.test(reason));
      got = r.got; tx = r.tx; reason += r.note;
      if (got > 0 && n(p.size) > 0) px = got / (n(p.size) * part);
    } else if (p.mode === "live") {
      const c = await import("@/lib/ai-trader-chains");
      const w = await wallets();
      const bal0 = await c.tokenBalanceOn("solana", w, p.coin);
      const mine = await ownShare(p, bal0);
      const raw = all ? mine : BigInt(Math.floor(Number(mine) * part));
      if (raw > 0n) {
        const usdt = c.STABLES.solana![0];
        const before = (await c.tokenBalanceOn("solana", w, usdt.token)).raw;
        try {
          const sigs = await c.relaySolSwap(w.sol, p.coin, usdt.token, raw);
          tx = sigs[sigs.length - 1];
          for (let i = 0; i < 8; i++) {
            const after = (await c.tokenBalanceOn("solana", w, usdt.token)).raw;
            if (after > before) { got = Number(after - before) / 10 ** usdt.decimals; break; }
            await sleep(1500);
          }
          if (!got) {
            const left = (await c.tokenBalanceOn("solana", w, p.coin)).raw;
            if (left >= bal0.raw) throw new Error("Relay's sell didn't land");
          }
        } catch {
          const panic = /stop/i.test(reason) ? 2000 : 0;
          const r = await c.liveSellOn("solana", w, p.coin, raw, 5, panic, usdt).catch(async () => {
            const r2 = await c.liveSellOn("solana", w, p.coin, raw, 5, panic, null);
            return { ...r2, receivedNative: r2.receivedNative * (await c.nativeUsd("solana")) };
          });
          got = r.receivedNative; tx = r.hash;
        }
        if (n(p.size) > 0) px = got / (n(p.size) * part);
      } else reason = `${reason} (the wallet held none of it any more)`;
    } else {
      got = n(p.notional_usd) * part * (px / n(p.entry)) * 0.98;
      await sb().from("ai_futures_settings").update({ paper_usd: s.paper_usd + got }).eq("id", T());
      s.paper_usd += got;
    }
    const cost = n(p.notional_usd) * part, fees = p.mode === "paper" ? n(p.fees_usd) * part : 0;
    const pnl = got - cost - fees;
    const now = new Date().toISOString();
    if (part >= 1) await pos().update({ status: "closed", exit: px, pnl_usd: pnl, reason, closed_at: now, close_tx: tx }).eq("id", p.id);
    else {
      const rest: any = { ...p };
      delete rest.id; delete rest.price; delete rest.upnl;
      await pos().insert({ ...rest, status: "closed", size: n(p.size) * part, notional_usd: cost, margin_usd: n(p.margin_usd) * part, fees_usd: n(p.fees_usd) * part, exit: px, pnl_usd: pnl, reason, closed_at: now, close_tx: tx });
      await pos().update({ status: "open", size: n(p.size) * (1 - part), notional_usd: n(p.notional_usd) * (1 - part), margin_usd: n(p.margin_usd) * (1 - part), fees_usd: n(p.fees_usd) * (1 - part), risk_usd: n((p as any).risk_usd) * (1 - part) }).eq("id", p.id);
    }
    const name = p.why?.split(":")[0] || p.coin.slice(0, 6);
    await flog(pnl >= 0 ? "win" : "loss", `${pnl >= 0 ? "✅" : "🔻"} Sold ${part >= 1 ? "all" : `${Math.round(part * 100)}%`} of ${name}: ${reason}. ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} (${((got / cost - 1) * 100).toFixed(0)}%)${p.mode === "paper" ? " (practice)" : ""}.`);
  } catch (e) {
    await pos().update({ status: "open" }).eq("id", p.id);
    await flog("error", `Couldn't sell ${p.coin.slice(0, 6)}…: ${(e as Error).message}`);
  }
}

/** Act on the copied wallets' new trades: buy what they buy (when Copy is on), sell what they sell (always). */
async function follow(s: FSettings): Promise<string[]> {
  const moves = await newMoves(s);
  const notes: string[] = [];
  for (const mv of moves) {
    if (mv.kind === "sell") {
      const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("coin", mv.mint).eq("copy_from", mv.wallet.address);
      for (const p of (data || []) as FPos[]) {
        await sellCopy(s, p, mv.frac, `${mv.wallet.label || short(mv.wallet.address)} sold ${Math.round(mv.frac * 100)}%`);
        notes.push(`sold ${p.why?.split(":")[0]}`);
      }
    } else if (s.enabled) {
      const r = await copyBuy(s, mv).catch((e) => `failed: ${(e as Error).message}`);
      if (/^failed/.test(r)) await flog("error", `Copy buy ${mv.mint.slice(0, 6)}…: ${r}`);
      notes.push(r);
    }
  }
  return notes;
}

/** Stop-loss check for every open copy trade (one Jupiter price call). */
async function stops(s: FSettings) {
  const { data } = await pos().select("*").eq("fut_id", T()).eq("status", "open").eq("venue", "copy");
  const open = (data || []) as FPos[];
  if (!open.length) return;
  const px = await priceOf(open.map((p) => p.coin));
  for (const p of open) {
    const price = px[p.coin];
    if (!price) continue;
    const best = Math.max(n(p.best) || n(p.entry), price);
    if (price <= n(p.stop)) await sellCopy(s, { ...p, last: price, best }, 1, `Stop-loss (${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else if (price >= n(p.target)) await sellCopy(s, { ...p, last: price, best }, 1, `Take profit (+${((price / n(p.entry) - 1) * 100).toFixed(0)}%)`, price);
    else await pos().update({ last: price, best }).eq("id", p.id);
  }
}

/** One minute of Copy: watch the wallets about every second for ~48 s, stop-losses every ~5 s. */
export async function runCopy(s: FSettings): Promise<string> {
  const ws = copyWallets(s).filter((w) => w.on !== false);
  if (!ws.length) { await stops(s).catch(() => {}); return "Add a wallet to copy."; }
  const eq = await snipeEquity(s).catch(() => ({ total: 0, free: 0 }));
  const today = new Date().toISOString().slice(0, 10);
  if (s.day !== today || s.day_start_usd == null) { await sb().from("ai_futures_settings").update({ day: today, day_start_usd: eq.total, day_peak_usd: eq.total }).eq("id", T()); s.day = today; s.day_start_usd = eq.total; (s as any).day_peak_usd = eq.total; }
  const down = eq.total < n(s.day_start_usd) * (1 - s.daily_loss_pct / 100);
  await trackPeak(s as any, eq.total).catch(() => {});
  const locked = profitLocked(s, eq.total);
  const buying = s.enabled && !down && !locked;
  const until = Date.now() + 48_000;
  const notes: string[] = [];
  let lastStop = 0;
  // One shared copy of the settings for the whole minute, so what was already seen (and the practice balance) carries over.
  const run = { ...s, enabled: buying } as FSettings;
  while (Date.now() < until) {
    const t = Date.now();
    notes.push(...(await follow(run).catch((e) => [`watch error: ${(e as Error).message}`])));
    if (t - lastStop > 5000) { lastStop = t; await stops(run).catch(() => {}); }
    await sleep(Math.max(250, 1000 - (Date.now() - t)));
  }
  const head = !s.enabled ? "Off: sells still follow the wallets." : down ? `Paused buying for today (down past ${s.daily_loss_pct}%); sells still follow.` : locked || `Watching ${ws.length} wallet${ws.length === 1 ? "" : "s"}.`;
  const did = notes.filter((x) => /^(bought|sold)/.test(x));
  return did.length ? `${head} ${did.join(" · ")}` : `${head} Account $${eq.total.toFixed(2)}.`;
}
