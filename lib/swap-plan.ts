/**
 * Swap by message: "convert 1 SOL to USDT", "swap half my BNB to USDC on Base", "move $20 of ETH to Solana".
 * Reads what the member asked, finds the coins and the networks, checks what their wallet holds, asks LI.FI for the
 * cheapest route on every network that could do it, and returns the routes cheapest first, ready for the member's own
 * wallet to sign. Like the rest of the Wallet, nothing here holds keys or moves money. Server only.
 */
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { anthropic, FAST_MODEL } from "@/lib/ai";
import { MAX_SLIPPAGE_BPS, WCHAINS, WSOL, type WChain, type WChainKey } from "@/lib/wallet-chains";
import { CHAT_FEE_BPS, balances, market, quote as engineQuote, riskOf, type Quote } from "@/lib/wallet-server";
import { relayFeeOn, relayQuote, type RelayQuote } from "@/lib/relay";
import { XCHAINS, XCHAIN_BY_KEY, isXAddress, isXNative, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";
import { xDetect, xQuote, xTokens } from "@/lib/bridge-server";
import { chainKey, clean, readSwap, type SwapAsk } from "@/lib/swap-read";
export type { SwapAsk };

/**
 * One way to do the swap. "lifi": LI.FI (any network, or across networks). "engine": the Wallet's own swap engine
 * (KyberSwap / the DEX / Jupiter) on one network, which also handles coins with a tax such as AUTISTIK.
 */
export type SwapOption = {
  via: "lifi" | "engine" | "relay";
  fromChain: number; toChain: number; fromToken: XToken; toToken: XToken;
  amount: string;                  // amount in coins, as typed into a swap form
  amountIn: string;                // raw
  toAmount: string; toAmountMin: string | null;
  fromUsd: number | null; toUsd: number | null; gasUsd: number | null; feeUsd: number | null;
  tool: string; seconds: number | null; slipBps: number;
  costUsd: number | null;          // network fee + bridge fee
  netUsd: number | null;           // what arrives, minus the network fee
  quote: XQuote | null;            // via lifi
  engine: { chain: WChainKey; q: Quote } | null; // via engine
  relay: RelayQuote | null;        // via relay
  feeBps: number;                  // AUTISTIK chat fee on this route (0 when the route can't carry it)
  topupUsd: number | null;         // gas coin added on arrival
  at: number;
};

/** The marketing wallet: chat swap fees go here (EVM; Relay pays its fees out as USDC to this address). */
const FEE_WALLET = (() => {
  const a = (process.env.CHAT_SWAP_FEE_WALLET || process.env.NEXT_PUBLIC_TREASURY_WALLET || "0x531A5ccB712B2bB997Ce0dF018707948c49Da5ba").trim();
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null;
})();
export type SwapPlan = { ask: SwapAsk; options: SwapOption[]; skipped: string[]; note: string | null };

/** Networks looked at when the member doesn't say which: the busiest, cheapest ones. */
const SCAN = ["solana", "bsc", "base", "arbitrum", "ethereum", "polygon", "optimism", "avalanche"];
/** Where a coin lives when it can only be in one place. */
const HOME: Record<string, string> = { SOL: "solana", BNB: "bsc", POL: "polygon", MATIC: "polygon", AVAX: "avalanche", S: "sonic", HYPE: "hyperevm", MNT: "mantle", CRO: "cronos", CELO: "celo", XDAI: "gnosis", APE: "apechain", RON: "ronin", FLR: "flare", BERA: "berachain", MON: "monad", AUTISTIK: "bsc" };
const GAS_KEEP: Record<string, number> = { solana: 0.01, bsc: 0.002, ethereum: 0.003, polygon: 0.5, avalanche: 0.02 };

async function askClaude(text: string): Promise<SwapAsk | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const r = await anthropic().messages.create({
    model: FAST_MODEL, max_tokens: 200,
    system: `You turn a crypto swap request into JSON. Reply with JSON only: {"amount":number|null,"unit":"coin"|"usd"|"pct"|"all","from":"SYMBOL","fromChain":string|null,"to":"SYMBOL","toChain":string|null}.
unit "usd" when they give a dollar value of the coin they pay with, "pct" for a share of their balance (half = 50), "all" for everything.
Chains: ${SCAN.join(", ")}, or another network's lowercase name. "cheapest" when they want whichever network is cheapest. null when not said.
"usdt on sol" means to "USDT", toChain "solana". "sell X" with nothing to receive named: "to":"" and toChain null. Ignore words like "approved". If the request is not a swap or conversion, reply {"none":true}.`,
    messages: [{ role: "user", content: text.slice(0, 400) }],
  });
  const raw = r.content.map((c: any) => (c.type === "text" ? c.text : "")).join("");
  const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!j || j.none || !j.from) return null;
  const unit = ["coin", "usd", "pct", "all"].includes(j.unit) ? j.unit : "coin";
  const amount = j.amount == null ? null : Number(j.amount);
  return { amount: amount != null && isFinite(amount) && amount > 0 ? amount : null, unit, from: clean(j.from), fromChain: chainKey(j.fromChain), to: clean(j.to), toChain: chainKey(j.toChain) };
}

/** The coin with exactly this symbol on a network (the chain's own coin first), or null. */
async function findToken(c: XChain, symbol: string): Promise<XToken | null> {
  if (!symbol) return null;
  if (symbol === c.native.symbol || (symbol === "ETH" && c.native.symbol === "ETH")) {
    const list = await xTokens(c, "").catch(() => [] as XToken[]);
    return list.find((t) => isXNative(c, t.address)) || null;
  }
  const list = await xTokens(c, symbol.toLowerCase()).catch(() => [] as XToken[]);
  const hit = list.filter((t) => t.symbol.toUpperCase() === symbol);
  // Several coins can share a symbol: the one with a price (a real, traded coin) wins.
  return hit.find((t) => t.priceUsd) || hit[0] || null;
}

async function balanceOf(c: XChain, owner: string, t: XToken): Promise<bigint> {
  if (c.kind === "solana") {
    const list = await balances(WCHAINS.solana, owner, []);
    const mint = isXNative(c, t.address) ? WSOL : t.address;
    return BigInt(list.find((h) => h.address === mint)?.raw || "0");
  }
  const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc, { timeout: 6000 }) });
  const who = getAddress(owner);
  if (isXNative(c, t.address)) return pc.getBalance({ address: who });
  return pc.readContract({ address: t.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [who] });
}

/** The Wallet's own network for this one, if it is one (BNB Chain, Base, Ethereum, Arbitrum, Solana). */
const wchainOf = (c: XChain): WChain | null => (c.wchain ? WCHAINS[c.wchain as WChainKey] ?? null : null);
/** A coin's address as the Wallet engine writes it (its own coin is 0xEeee… / wSOL). */
const toEngine = (c: XChain, wc: WChain, a: string) => (isXNative(c, a) ? wc.native.address : a);

const units = (n: number, d: number) => {
  const s = n.toFixed(Math.min(d, 12));
  const [i, f = ""] = s.split(".");
  return BigInt(i + (f + "0".repeat(d)).slice(0, d));
};
const human = (raw: bigint, d: number) => {
  const s = raw.toString().padStart(d + 1, "0");
  if (!d) return s;
  return `${s.slice(0, -d)}.${s.slice(-d)}`.replace(/\.?0+$/, "") || "0";
};

/**
 * Every way to do what the member asked, cheapest first. `evm` / `sol` are the member's own addresses: coins are only
 * ever paid out to them.
 */
export async function planSwap(input: string | SwapAsk, who: { evm: string | null; sol: string | null }): Promise<SwapPlan> {
  const ask = typeof input !== "string" ? input : readSwap(input) ?? (await askClaude(input).catch(() => null));
  if (!ask) throw new Error("I couldn't tell what to swap. Try: convert 1 SOL to USDT");
  if (ask.unit !== "all" && !(ask.amount && ask.amount > 0)) throw new Error(`How much ${ask.from} should I swap? Try: convert 1 ${ask.from} to ${ask.to || "USDT"}`);
  if (ask.unit === "pct" && ask.amount! > 100) throw new Error("That's more than 100% of your balance.");
  const addr = (c: XChain) => (c.kind === "solana" ? who.sol : who.evm);
  const skipped: string[] = [];
  // Buying a coin by its address: find it (and its network) first.
  const target = ask.toAddress ? await xDetect(ask.toAddress) : null;
  if (ask.toAddress && !target) throw new Error("I couldn't find that coin on any network. Check the address.");
  if (target) { ask.toChain = XCHAINS[target.chain].key; ask.to = target.token.symbol.toUpperCase(); }

  // Where the member pays from: the network they named, the coin's only home, or every network they hold it on.
  const fromKeys = ask.fromChain && ask.fromChain !== "cheapest" ? [ask.fromChain] : HOME[ask.from] ? [HOME[ask.from]] : SCAN;
  const sources = (await Promise.all(fromKeys.map(async (k) => {
    const c = XCHAIN_BY_KEY[k]; const owner = c && addr(c);
    if (!c || !owner || !isXAddress(c, owner)) { if (c && fromKeys.length === 1) skipped.push(`Connect a ${c.name} wallet to swap from ${c.name}.`); return null; }
    const t = await findToken(c, ask.from);
    if (!t) return null;
    const bal = await balanceOf(c, owner, t).catch(() => null);
    return bal == null ? null : { c, t, owner, bal };
  }))).filter(Boolean) as { c: XChain; t: XToken; owner: string; bal: bigint }[];
  if (!sources.length) throw new Error(skipped[0] || `I couldn't find ${ask.from} ${ask.fromChain ? `on ${XCHAIN_BY_KEY[ask.fromChain]?.name || ask.fromChain}` : "in your wallet"}.`);

  // A price for "$1 worth": LI.FI's, or the coin's market (DexScreener) on the Wallet's own networks.
  const withPrice = await Promise.all(sources.map(async (s) => {
    let price = s.t.priceUsd ?? null;
    const wc = wchainOf(s.c);
    if (!price && ask.unit === "usd" && wc) price = (await market(wc, toEngine(s.c, wc, s.t.address)).catch(() => null))?.priceUsd ?? null;
    return { ...s, price };
  }));
  // How much, in coins, on each source network.
  const priced = withPrice.map((s) => {
    const native = isXNative(s.c, s.t.address);
    const keep = native ? units(GAS_KEEP[s.c.key] ?? 0.0003, s.t.decimals) : 0n;
    const spendable = s.bal > keep ? s.bal - keep : 0n;
    let raw: bigint | null = null;
    if (ask.unit === "all") raw = spendable;
    else if (ask.unit === "pct") raw = ask.amount! >= 100 ? spendable : (s.bal * BigInt(Math.round(ask.amount! * 100))) / 10_000n;
    else if (ask.unit === "usd") raw = s.price ? units(ask.amount! / s.price, s.t.decimals) : null;
    else raw = units(ask.amount!, s.t.decimals);
    return { ...s, raw };
  });
  const enough = priced.filter((s) => s.raw != null && s.raw > 0n && s.raw <= s.bal);
  if (!enough.length) {
    const p = priced.find((s) => s.raw == null);
    if (p) throw new Error(`I couldn't price ${ask.from} right now. Give the amount in ${ask.from} instead.`);
    const have = priced.map((s) => `${human(s.bal, s.t.decimals)} ${s.t.symbol} on ${s.c.name}`).join(", ");
    throw new Error(`Not enough ${ask.from}. You have ${have || "none"}${ask.unit === "all" ? " (a little is kept to pay the network fee)" : ""}.`);
  }

  // Where it arrives: the network they named, the same one, or (asked for "cheapest", or the coin isn't there) the cheapest.
  const pairs: { s: (typeof enough)[number]; to: XChain; tt: XToken }[] = [];
  await Promise.all(enough.slice(0, 4).map(async (s) => {
    // A coin with one home (SOL, BNB…) is received there, not as a wrapped copy on another network.
    const want = ask.toChain ?? (HOME[ask.to] || null);
    // ETH with no network named: the same ETH on Base and Arbitrum costs cents to use; Ethereum itself is offered too.
    const ethKeys = [...new Set([...(s.c.native.symbol === "ETH" ? [s.c.key] : []), "base", "arbitrum", "ethereum"])];
    const toKeys = want && want !== "cheapest" ? [want] : want === "cheapest" ? [s.c.key, ...SCAN.filter((k) => k !== s.c.key)].slice(0, 5)
      : ask.to === "ETH" ? ethKeys : [s.c.key];
    for (const k of toKeys) {
      const to = XCHAIN_BY_KEY[k]; if (!to) continue;
      const owner = addr(to);
      if (!owner || !isXAddress(to, owner)) { skipped.push(`Connect a ${to.name} wallet to receive on ${to.name}.`); continue; }
      // "move 1 SOL to base" (no coin named): the same coin there, or the chain's own coin.
      // "move 1 SOL to base" (no coin named): a chain's own coin becomes the other chain's own coin; others stay the same coin.
      // "sell $1 of AUTISTIK" (nothing named, same network): the network's own coin.
      const tt = target && target.chain === to.id ? target.token
        : !ask.to && !ask.toChain ? await findToken(to, to.native.symbol)
        : ask.to ? await findToken(to, ask.to)
        : isXNative(s.c, s.t.address) ? await findToken(to, to.native.symbol)
        : (await findToken(to, s.t.symbol)) ?? (await findToken(to, to.native.symbol));
      if (!tt) { if (toKeys.length === 1 && ask.toChain) skipped.push(`${ask.to} isn't on ${to.name}.`); continue; }
      if (!ask.to && !ask.toChain && isXNative(s.c, s.t.address)) throw new Error(`What should I swap your ${s.t.symbol} to? Try: sell 1 ${s.t.symbol} to USDT`);
      if (to.id === s.c.id && tt.address.toLowerCase() === s.t.address.toLowerCase()) continue;
      pairs.push({ s, to, tt });
    }
  }));
  // The coin isn't on the source network (e.g. a Base-only coin asked for from Solana): try the cheapest networks.
  if (!pairs.length && !ask.toChain && !HOME[ask.to]) {
    await Promise.all(enough.slice(0, 2).flatMap((s) => SCAN.filter((k) => k !== s.c.key).slice(0, 4).map(async (k) => {
      const to = XCHAIN_BY_KEY[k]; const owner = to && addr(to);
      if (!to || !owner || !isXAddress(to, owner)) return;
      const tt = await findToken(to, ask.to);
      if (tt) pairs.push({ s, to, tt });
    })));
  }
  if (!pairs.length) throw new Error(skipped[0] || `I couldn't find ${ask.to || "that coin"} on ${ask.toChain ? XCHAIN_BY_KEY[ask.toChain]?.name || ask.toChain : "a network you can receive on"}.`);

  const stable = (a: string, b: string) => /USD/.test(a) && /USD/.test(b);
  // Gas top-up: arriving on a network where the wallet has none of its own coin, add a little (if the swap is worth it).
  const usdOf = (s: (typeof enough)[number]) => (s.price ? (Number(s.raw) / 10 ** s.t.decimals) * s.price : null);
  const topupFor = async (s: (typeof enough)[number], to: XChain): Promise<number | undefined> => {
    if (to.id === s.c.id || (usdOf(s) ?? 0) < 5) return undefined;
    const native = await findToken(to, to.native.symbol).catch(() => null);
    const bal = native ? await balanceOf(to, addr(to)!, native).catch(() => null) : null;
    return bal === 0n ? (to.key === "ethereum" ? 1.5 : 0.3) : undefined;
  };
  const results = await Promise.allSettled(pairs.slice(0, 5).flatMap(({ s, to, tt }) => {
    const base = { fromChain: s.c.id, toChain: to.id, fromToken: s.t, toToken: tt, amount: human(s.raw!, s.t.decimals), amountIn: s.raw!.toString(), at: Date.now() };
    const none = { quote: null, engine: null, relay: null, topupUsd: null };
    const viaLifi = async (): Promise<SwapOption> => {
      const slipBps = stable(s.t.symbol, tt.symbol) ? 50 : 100;
      const q = await xQuote({ from: s.c, to, fromToken: s.t.address, toToken: tt.address, amount: s.raw!, fromAddress: s.owner, toAddress: addr(to)!, slippageBps: slipBps, order: "CHEAPEST", feeBps: CHAT_FEE_BPS, route: "best" });
      return { ...base, ...none, via: "lifi", toAmount: q.toAmount, toAmountMin: q.toAmountMin, fromUsd: q.fromUsd, toUsd: q.toUsd, gasUsd: q.gasUsd, feeUsd: q.feeUsd,
        tool: q.toolName, seconds: q.seconds, slipBps, feeBps: q.feeBps, costUsd: (q.gasUsd ?? 0) + (q.feeUsd ?? 0) || null, netUsd: q.toUsd != null ? q.toUsd - (q.gasUsd ?? 0) : null, quote: q };
    };
    const viaRelay = async (): Promise<SwapOption> => {
      const slipBps = stable(s.t.symbol, tt.symbol) ? 50 : 100;
      const topupUsd = await topupFor(s, to);
      const q = await relayQuote({ from: s.c, to, fromToken: s.t.address, toToken: tt.address, amount: s.raw!, user: s.owner, recipient: addr(to)!, slippageBps: slipBps,
        feeBps: CHAT_FEE_BPS, feeWallet: FEE_WALLET, topupUsd });
      const feeUsd = (q.relayerUsd ?? 0) > 0 ? q.relayerUsd : null;
      return { ...base, ...none, via: "relay", toAmount: q.toAmount, toAmountMin: q.toAmountMin, fromUsd: q.fromUsd, toUsd: q.toUsd, gasUsd: q.gasUsd, feeUsd,
        tool: "Relay", seconds: q.seconds, slipBps, feeBps: relayFeeOn && FEE_WALLET ? CHAT_FEE_BPS : 0, costUsd: (q.gasUsd ?? 0) + (feeUsd ?? 0) || null,
        // The top-up arrives as gas coin, so it counts as value received.
        netUsd: q.toUsd != null ? q.toUsd + (q.topupUsd ?? 0) - (q.gasUsd ?? 0) : null, relay: q, topupUsd: q.topupUsd };
    };
    // Same network on one of the Wallet's own networks: its own engine too (handles taxed coins like AUTISTIK).
    const wc = s.c.id === to.id ? wchainOf(s.c) : null;
    const viaEngine = async (): Promise<SwapOption> => {
      const tin = toEngine(s.c, wc!, s.t.address), tout = toEngine(s.c, wc!, tt.address);
      const [q, rin, rout] = await Promise.all([engineQuote(wc!, tin, tout, s.raw!, CHAT_FEE_BPS), riskOf(wc!, tin).catch(() => null), riskOf(wc!, tout).catch(() => null)]);
      if (rout?.honeypot) throw new Error(`${tt.symbol} looks like a honeypot (you couldn't sell it again). Stopped for your safety.`);
      const tax = (rin?.sellTax ?? 0) + (rout?.buyTax ?? 0);
      const slipBps = Math.min(MAX_SLIPPAGE_BPS, tax > 0 ? Math.ceil((tax + 3) * 100) : stable(s.t.symbol, tt.symbol) ? 50 : 300);
      return { ...base, ...none, via: "engine", toAmount: q.amountOut, toAmountMin: null, fromUsd: q.inUsd, toUsd: q.outUsd, gasUsd: q.gasUsd, feeUsd: null,
        tool: q.kind === "jupiter" ? "Jupiter" : q.kind === "v2" ? "DEX" : "KyberSwap", seconds: null, slipBps, feeBps: q.feeBps,
        costUsd: q.gasUsd, netUsd: q.outUsd != null ? q.outUsd - (q.gasUsd ?? 0) : null, engine: { chain: wc!.key, q } };
    };
    return [...(wc ? [viaEngine()] : []), viaLifi(), ...(s.c.kind === "evm" ? [viaRelay()] : [])];
  }));
  let options = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!options.length) {
    const why = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(String(why?.reason?.message || "No route found for this swap. Try a bigger amount."));
  }
  // Most value in hand after every fee first; then the lowest fees. One route per pair of networks (the better one).
  // Relay first (lowest fees); KyberSwap first only when they ask for it ("swap … with kyber"). Then most value after fees.
  const wantsKyber = typeof input === "string" && /\bkyber(swap)?\b/i.test(input);
  const first = (o: SwapOption) => (wantsKyber ? (o.tool === "KyberSwap" ? 0 : 1) : (o.via === "relay" ? 0 : 1));
  options.sort((a, b) => first(a) - first(b) || (b.netUsd ?? -1) - (a.netUsd ?? -1) || (a.costUsd ?? 1e9) - (b.costUsd ?? 1e9));
  const seen = new Set<string>();
  options = options.filter((o) => { const k = `${o.fromChain}-${o.toChain}-${o.toToken.address}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const tried = new Set(results.flatMap((r) => (r.status === "fulfilled" ? [r.value.via] : []))).size;
  const note = options.length > 1 || tried > 1 ? `Compared ${results.length} quotes from ${[...new Set(results.flatMap((r) => (r.status === "fulfilled" ? [r.value.tool] : [])))].slice(0, 4).join(", ")}; the first leaves you the most after fees.` : null;
  return { ask, options, skipped: [...new Set(skipped)].slice(0, 3), note };
}

/** One way to pay for a buy: a coin the member holds, on one network, worth enough. */
export type Funding = { symbol: string; chain: string; chainName: string; valueUsd: number; amount: number; same: boolean };

/**
 * "buy $5 of <address>": what the member could pay with, from their wallet on every network, enough for the buy plus
 * gas. The coin's own network first (no bridge, cheapest), then the cheap networks, Ethereum last.
 */
export async function fundingChoices(ca: string, usd: number, who: { evm: string | null; sol: string | null }) {
  const target = await xDetect(ca);
  if (!target) throw new Error("I couldn't find that coin on any network. Check the address.");
  const home = XCHAINS[target.chain];
  const addr = (c: XChain) => (c.kind === "solana" ? who.sol : who.evm);
  const keys = [...new Set([home.key, ...SCAN])].filter((k) => { const c = XCHAIN_BY_KEY[k]; return c && addr(c); });
  const rows = (await Promise.all(keys.flatMap((k) => {
    const c = XCHAIN_BY_KEY[k];
    return [c.native.symbol, "USDT", "USDC"].map(async (sym): Promise<Funding | null> => {
      const t = await findToken(c, sym).catch(() => null);
      if (!t || (c.id === home.id && t.address.toLowerCase() === target.token.address.toLowerCase())) return null;
      const bal = await balanceOf(c, addr(c)!, t).catch(() => null);
      if (!bal) return null;
      const amount = Number(bal) / 10 ** t.decimals;
      const price = t.priceUsd ?? (/USD/.test(sym) ? 1 : null);
      if (!price) return null;
      // Room for gas when paying with the network's own coin.
      const gasUsd = isXNative(c, t.address) ? (c.key === "ethereum" ? 3 : 0.1) : 0;
      const valueUsd = amount * price;
      if (valueUsd - gasUsd < usd * 1.02) return null;
      return { symbol: t.symbol, chain: c.key, chainName: c.name, valueUsd, amount, same: c.id === home.id };
    });
  }))).filter(Boolean) as Funding[];
  const rank = (f: Funding) => (f.same ? 0 : f.chain === "ethereum" ? 2 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || b.valueUsd - a.valueUsd);
  return { token: target.token, chain: home.key, chainName: home.name, choices: rows.slice(0, 6) };
}
