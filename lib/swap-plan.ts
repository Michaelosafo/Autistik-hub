/**
 * Swap by message: "convert 1 SOL to USDT", "swap half my BNB to USDC on Base", "move $20 of ETH to Solana".
 * Reads what the member asked, finds the coins and the networks, checks what their wallet holds, asks LI.FI for the
 * cheapest route on every network that could do it, and returns the routes cheapest first, ready for the member's own
 * wallet to sign. Like the rest of the Wallet, nothing here holds keys or moves money. Server only.
 */
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { anthropic, FAST_MODEL } from "@/lib/ai";
import { WCHAINS, WSOL } from "@/lib/wallet-chains";
import { balances } from "@/lib/wallet-server";
import { XCHAIN_BY_KEY, isXAddress, isXNative, type XChain, type XQuote, type XToken } from "@/lib/bridge-chains";
import { xQuote, xTokens } from "@/lib/bridge-server";
import { chainKey, clean, readSwap, type SwapAsk } from "@/lib/swap-read";
export type { SwapAsk };

export type SwapOption = {
  quote: XQuote; fromToken: XToken; toToken: XToken; amount: string; // amount in coins, as typed into a swap form
  costUsd: number | null;          // network fee + bridge fee
  netUsd: number | null;           // what arrives, minus the network fee
};
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
"usdt on sol" means to "USDT", toChain "solana". If the request is not a swap or conversion, reply {"none":true}.`,
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
export async function planSwap(text: string, who: { evm: string | null; sol: string | null }): Promise<SwapPlan> {
  const ask = readSwap(text) ?? (await askClaude(text).catch(() => null));
  if (!ask) throw new Error("I couldn't tell what to swap. Try: convert 1 SOL to USDT");
  if (ask.unit !== "all" && !(ask.amount && ask.amount > 0)) throw new Error(`How much ${ask.from} should I swap? Try: convert 1 ${ask.from} to ${ask.to || "USDT"}`);
  if (ask.unit === "pct" && ask.amount! > 100) throw new Error("That's more than 100% of your balance.");
  const addr = (c: XChain) => (c.kind === "solana" ? who.sol : who.evm);
  const skipped: string[] = [];

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

  // How much, in coins, on each source network.
  const priced = sources.map((s) => {
    const native = isXNative(s.c, s.t.address);
    const keep = native ? units(GAS_KEEP[s.c.key] ?? 0.0003, s.t.decimals) : 0n;
    const spendable = s.bal > keep ? s.bal - keep : 0n;
    let raw: bigint | null = null;
    if (ask.unit === "all") raw = spendable;
    else if (ask.unit === "pct") raw = ask.amount! >= 100 ? spendable : (s.bal * BigInt(Math.round(ask.amount! * 100))) / 10_000n;
    else if (ask.unit === "usd") raw = s.t.priceUsd ? units(ask.amount! / s.t.priceUsd, s.t.decimals) : null;
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
    const toKeys = want && want !== "cheapest" ? [want] : want === "cheapest" ? [s.c.key, ...SCAN.filter((k) => k !== s.c.key)].slice(0, 5) : [s.c.key];
    for (const k of toKeys) {
      const to = XCHAIN_BY_KEY[k]; if (!to) continue;
      const owner = addr(to);
      if (!owner || !isXAddress(to, owner)) { skipped.push(`Connect a ${to.name} wallet to receive on ${to.name}.`); continue; }
      // "move 1 SOL to base" (no coin named): the same coin there, or the chain's own coin.
      // "move 1 SOL to base" (no coin named): a chain's own coin becomes the other chain's own coin; others stay the same coin.
      const tt = ask.to ? await findToken(to, ask.to)
        : isXNative(s.c, s.t.address) ? await findToken(to, to.native.symbol)
        : (await findToken(to, s.t.symbol)) ?? (await findToken(to, to.native.symbol));
      if (!tt) { if (toKeys.length === 1 && ask.toChain) skipped.push(`${ask.to} isn't on ${to.name}.`); continue; }
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
  const results = await Promise.allSettled(pairs.slice(0, 8).map(async ({ s, to, tt }) => {
    const quote = await xQuote({ from: s.c, to, fromToken: s.t.address, toToken: tt.address, amount: s.raw!, fromAddress: s.owner, toAddress: addr(to)!,
      slippageBps: stable(s.t.symbol, tt.symbol) ? 50 : 100, order: "CHEAPEST" });
    const costUsd = (quote.gasUsd ?? 0) + (quote.feeUsd ?? 0) || null;
    const netUsd = quote.toUsd != null ? quote.toUsd - (quote.gasUsd ?? 0) : null;
    return { quote, fromToken: s.t, toToken: tt, amount: human(s.raw!, s.t.decimals), costUsd, netUsd } as SwapOption;
  }));
  const options = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!options.length) {
    const why = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw new Error(String(why?.reason?.message || "No route found for this swap. Try a bigger amount."));
  }
  // Most value in hand after every fee first; then the lowest fees.
  options.sort((a, b) => (b.netUsd ?? -1) - (a.netUsd ?? -1) || (a.costUsd ?? 1e9) - (b.costUsd ?? 1e9));
  const note = options.length > 1 ? `Compared ${options.length} routes; the first one leaves you the most after fees.` : null;
  return { ask, options, skipped: [...new Set(skipped)].slice(0, 3), note };
}
