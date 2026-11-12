/**
 * Fresh signals for the AI trader (server only), checked every minute:
 *  - DexScreener: coins whose team just set up a profile, just paid for a boost, or just had a community takeover
 *    (these usually land at the same moment the project posts on X / Telegram).
 *  - X: new posts from the accounts on the caller list (Elon and the callers you add), read through TwitterAPI.io
 *    (TWITTERAPI_IO_KEY) or the official X API (X_BEARER_TOKEN). Contract addresses and $TICKERS are pulled out.
 *  - Telegram: posts from channels / groups the AUTISTIK bot is in arrive instantly through its webhook.
 * Every coin found is looked up on DexScreener for its price, market cap, pool and buying pressure.
 */
const n = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const DS = "https://api.dexscreener.com";

export type Signal = { source: "dex-profile" | "dex-boost" | "dex-cto" | "x" | "telegram"; who: string; body: string; url: string; chain: string; token: string; at: number };
export type Flow = {
  chain: string; token: string; pool: string; symbol: string; name: string; image: string | null;
  price: number; liquidity: number; mcap: number; ageHours: number;
  ch: { m5: number; h1: number; h6: number; h24: number }; buys5: number; sells5: number; buys1h: number; sells1h: number;
  vol5: number; vol1h: number;
  x: boolean; tg: boolean;
};

async function get(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** One DexScreener pair → what the trader needs. */
export function toFlow(p: any): Flow {
  const soc: any[] = p?.info?.socials || [];
  return {
    chain: String(p.chainId), token: String(p.baseToken?.address || ""), pool: String(p.pairAddress || ""), symbol: String(p.baseToken?.symbol || "?"), name: String(p.baseToken?.name || ""),
    image: p.info?.imageUrl || null, price: n(p.priceUsd), liquidity: n(p.liquidity?.usd), mcap: n(p.marketCap) || n(p.fdv),
    ageHours: p.pairCreatedAt ? (Date.now() - Number(p.pairCreatedAt)) / 36e5 : 999,
    ch: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24) },
    buys5: n(p.txns?.m5?.buys), sells5: n(p.txns?.m5?.sells), buys1h: n(p.txns?.h1?.buys), sells1h: n(p.txns?.h1?.sells),
    vol5: n(p.volume?.m5), vol1h: n(p.volume?.h1),
    x: soc.some((s) => /twitter|^x$/i.test(String(s?.type)) || /x\.com|twitter\.com/i.test(String(s?.url))),
    tg: soc.some((s) => /telegram/i.test(String(s?.type)) || /t\.me\//i.test(String(s?.url))),
  };
}

/** The deepest pool for a token on one of the chains (by address), or for a $TICKER (by search). */
export async function resolve(ref: { chain?: string; token?: string; ticker?: string }, chains: string[]): Promise<Flow | null> {
  let pairs: any[] = [];
  if (ref.token && ref.chain) pairs = await get(`${DS}/tokens/v1/${ref.chain}/${ref.token}`).catch(() => []);
  else if (ref.token) pairs = (await get(`${DS}/latest/dex/tokens/${ref.token}`).catch(() => null))?.pairs || [];
  else if (ref.ticker) {
    const t = ref.ticker.replace(/^\$/, "");
    pairs = ((await get(`${DS}/latest/dex/search?q=${encodeURIComponent(t)}`).catch(() => null))?.pairs || [])
      .filter((p: any) => String(p?.baseToken?.symbol || "").toLowerCase() === t.toLowerCase() && n(p?.liquidity?.usd) >= 10_000);
  }
  const ok = (pairs || []).filter((p: any) => chains.includes(String(p?.chainId)) && (!ref.token || String(p?.baseToken?.address || "").toLowerCase() === ref.token.toLowerCase()));
  ok.sort((a: any, b: any) => (ref.ticker ? n(b?.volume?.h24) - n(a?.volume?.h24) : n(b?.liquidity?.usd) - n(a?.liquidity?.usd)));
  return ok[0] ? toFlow(ok[0]) : null;
}

/** Contract addresses and $TICKERS in a post. */
export function extract(text: string): { evm: string[]; sol: string[]; tickers: string[] } {
  const evm = [...new Set((text.match(/0x[a-fA-F0-9]{40}/g) || []).map((a) => a.toLowerCase()))];
  const sol = [...new Set((text.replace(/https?:\/\/\S+/g, " ").match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g) || []).filter((a) => /\d/.test(a) && /[a-z]/.test(a) && /[A-Z]/.test(a)))];
  const tickers = [...new Set((text.match(/\$[A-Za-z][A-Za-z0-9]{1,9}\b/g) || []).map((t) => t.toUpperCase()))].filter((t) => !/^\$(USD|USDT|USDC|BTC|ETH|BNB|SOL)$/.test(t));
  return { evm, sol, tickers };
}

/** New DexScreener profiles, boosts and community takeovers on the chosen chains. */
export async function dexSignals(chains: string[]): Promise<Signal[]> {
  const src: [Signal["source"], string][] = [["dex-profile", `${DS}/token-profiles/latest/v1`], ["dex-boost", `${DS}/token-boosts/latest/v1`], ["dex-cto", `${DS}/community-takeovers/latest/v1`]];
  const lists = await Promise.all(src.map(async ([source, url]) => {
    const j = await get(url).catch(() => []);
    return (Array.isArray(j) ? j : []).filter((x: any) => chains.includes(String(x?.chainId)) && x?.tokenAddress).slice(0, 30).map((x: any): Signal => ({
      source, who: "DexScreener", body: String(x.description || "").slice(0, 280), url: String(x.url || ""),
      chain: String(x.chainId), token: x.chainId === "solana" ? String(x.tokenAddress) : String(x.tokenAddress).toLowerCase(), at: Date.now(),
    }));
  }));
  return lists.flat();
}

export const xReady = () => !!(process.env.TWITTERAPI_IO_KEY || process.env.X_BEARER_TOKEN);

/** New posts from the caller accounts (last 10 minutes). */
export async function xPosts(handles: string[]): Promise<{ id: string; text: string; user: string; url: string; at: number }[]> {
  const hs = handles.map((h) => h.replace(/^@/, "").trim()).filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h)).slice(0, 20);
  if (!hs.length) return [];
  const q = hs.map((h) => `from:${h}`).join(" OR ");
  let out: { id: string; text: string; user: string; url: string; at: number }[] = [];
  if (process.env.TWITTERAPI_IO_KEY) {
    const j = await get(`https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(q)}`, { "X-API-Key": process.env.TWITTERAPI_IO_KEY }).catch(() => null);
    const tw: any[] = j?.tweets || j?.data?.tweets || [];
    out = tw.map((t) => ({ id: String(t.id), text: String(t.text || ""), user: String(t.author?.userName || ""), url: String(t.url || `https://x.com/${t.author?.userName}/status/${t.id}`), at: Date.parse(t.createdAt) || Date.now() }));
  } else if (process.env.X_BEARER_TOKEN) {
    const j = await get(`https://api.x.com/2/tweets/search/recent?max_results=25&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username&query=${encodeURIComponent(`(${q}) -is:retweet`)}`, { authorization: `Bearer ${process.env.X_BEARER_TOKEN}` }).catch(() => null);
    const users = new Map<string, string>((j?.includes?.users || []).map((u: any) => [u.id, u.username]));
    out = (j?.data || []).map((t: any) => ({ id: String(t.id), text: String(t.text || ""), user: users.get(t.author_id) || "", url: `https://x.com/${users.get(t.author_id) || "i"}/status/${t.id}`, at: Date.parse(t.created_at) || Date.now() }));
  }
  return out.filter((t) => Date.now() - t.at < 10 * 60_000);
}

/** Turns a post (X or Telegram) into signals: each contract address or $TICKER it mentions, on the chosen chains. */
export async function postSignals(post: { text: string; user: string; url: string; at: number }, source: "x" | "telegram", chains: string[]): Promise<{ sig: Signal; flow: Flow }[]> {
  const { evm, sol, tickers } = extract(post.text);
  const refs = [...evm.map((token) => ({ token })), ...(chains.includes("solana") ? sol.map((token) => ({ token, chain: "solana" })) : []), ...(evm.length || sol.length ? [] : tickers.slice(0, 2).map((ticker) => ({ ticker })))].slice(0, 3);
  const found = await Promise.all(refs.map((r) => resolve(r, chains).catch(() => null)));
  return found.filter(Boolean).map((f) => ({
    flow: f!, sig: { source, who: post.user, body: post.text.slice(0, 280), url: post.url, chain: f!.chain, token: f!.chain === "solana" ? f!.token : f!.token.toLowerCase(), at: post.at },
  }));
}
