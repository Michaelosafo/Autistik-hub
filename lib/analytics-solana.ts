/**
 * Solana support for Analytics. Solana tokens aren't contracts with balanceOf: each wallet keeps its tokens in a
 * separate "token account". GoPlus (free) gives the top 10 holders with their token accounts, the creator and the
 * safety flags; the Solana node then re-reads those token accounts in one batch to spot sells. All read-only.
 */
const RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isSolAddress = (a: unknown): a is string => typeof a === "string" && RE.test(a);

// Plain reads (one batch for many accounts) and "indexed" reads (find a wallet's token account), which some free
// nodes refuse, so they can use a different node.
const RPC = process.env.ANALYTICS_SOLANA_RPC || "https://solana-rpc.publicnode.com";
const INDEXED_RPC = process.env.ANALYTICS_SOLANA_RPC || "https://api.mainnet-beta.solana.com";
const SYSTEM = "11111111111111111111111111111111";
// Not people: burn address, and the pool authorities of Raydium's main pools (they hold the pooled tokens).
export const SOL_SKIP = new Set([SYSTEM, "1nc1nerator11111111111111111111111111111111"]);
const POOL_AUTHORITIES: Record<string, string> = {
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": "Raydium pool",
  "GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL": "Raydium pool",
};

const num = (v: unknown) => { const n = Number(v); return isFinite(n) ? n : 0; };

async function rpc(method: string, params: unknown[], url = RPC): Promise<any> {
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error(`Solana ${method}: ${j?.error?.message || r.status}`);
  return j.result;
}

/**
 * Accounts read in batches, parsed. Missing accounts come back as null. The free node now takes at most 10 per call
 * (and sometimes refuses), so batches are 10 and a refused batch is read again from the other free node.
 */
async function accounts(keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += 10) {
    const params = [keys.slice(i, i + 10), { encoding: "jsonParsed" }];
    const r = await rpc("getMultipleAccounts", params).catch(() => rpc("getMultipleAccounts", params, INDEXED_RPC));
    out.push(...(r?.value || []));
  }
  return out;
}

export type SolMeta = { name: string; symbol: string; decimals: number; supply: number; owner: string | null };

/** Decimals and supply from the mint account itself. Name and symbol come from GoPlus. */
export async function solMeta(mint: string): Promise<SolMeta | null> {
  const [a] = await accounts([mint]);
  const info = a?.data?.parsed?.type === "mint" ? a.data.parsed.info : null;
  if (!info) return null;
  const decimals = Number(info.decimals);
  return { name: "", symbol: "", decimals, supply: num(info.supply) / 10 ** decimals, owner: null };
}

export type SolHolder = { wallet: string; balance: string; isContract?: boolean; label?: string | null; tokenAccount?: string };

/** Creator, top 10 holders (with their token accounts) and safety flags from GoPlus. */
export async function solGoplus(mint: string) {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    const x = j?.result?.[mint];
    if (!x) return null;
    const on = (v: any) => (v?.status === "1" ? true : v?.status === "0" ? false : null);
    const raw: SolHolder[] = (Array.isArray(x.holders) ? x.holders : [])
      .filter((h: any) => isSolAddress(h.account) && !SOL_SKIP.has(h.account))
      .map((h: any) => ({ wallet: h.account, balance: String(h.balance ?? "0"), label: h.tag ? String(h.tag).slice(0, 40) : null, tokenAccount: isSolAddress(h.token_account) ? h.token_account : undefined }));
    // A wallet run by a program (a pool or vault) isn't a person: its account is owned by that program.
    const owners = await accounts(raw.map((h) => h.wallet)).catch(() => [] as any[]);
    const holders = raw.map((h, i) => {
      const pool = POOL_AUTHORITIES[h.wallet];
      const prog = owners[i]?.owner;
      return { ...h, isContract: !!pool || (!!prog && prog !== SYSTEM), label: h.label || pool || null };
    });
    const creator = (Array.isArray(x.creators) ? x.creators : []).map((c: any) => c?.address).find(isSolAddress) || null;
    return {
      creator, owner: null as string | null, holders,
      name: String(x.metadata?.name || "").slice(0, 64), symbol: String(x.metadata?.symbol || "").slice(0, 24),
      security: {
        honeypot: null, buyTax: null, sellTax: null, openSource: null, canTakeBack: null,
        mintable: on(x.mintable), freezable: on(x.freezable), metadataMutable: on(x.metadata_mutable),
        holderCount: x.holder_count ? num(x.holder_count) : null,
      },
    };
  } catch { return null; }
}

/**
 * Current balances for wallets. Uses each wallet's known token account (one batch read); for wallets without one
 * (often the dev) it looks the account up once. A closed or emptied account counts as 0: they sold everything.
 * Returns the balances and any token accounts found, so they can be saved.
 */
export async function solBalances(mint: string, wallets: string[], known: Map<string, string>) {
  const balances = new Map<string, string>(), found = new Map<string, string>();
  const missing = wallets.filter((w) => !known.get(w));
  await Promise.all(missing.slice(0, 5).map(async (w) => {
    try {
      const r = await rpc("getTokenAccountsByOwner", [w, { mint }, { encoding: "jsonParsed" }], INDEXED_RPC);
      const list = r?.value || [];
      if (!list.length) { balances.set(w, "0"); return; }
      const best = list.sort((a: any, b: any) => num(b.account.data.parsed.info.tokenAmount.uiAmountString) - num(a.account.data.parsed.info.tokenAmount.uiAmountString))[0];
      found.set(w, best.pubkey);
      balances.set(w, String(best.account.data.parsed.info.tokenAmount.uiAmountString ?? "0"));
    } catch {}
  }));
  const withAcc = wallets.filter((w) => known.get(w));
  const accs = await accounts(withAcc.map((w) => known.get(w)!));
  withAcc.forEach((w, i) => {
    const info = accs[i]?.data?.parsed?.info;
    // Only trust the account if it still belongs to this wallet and this token.
    balances.set(w, info && info.owner === w && info.mint === mint ? String(info.tokenAmount?.uiAmountString ?? "0") : "0");
  });
  return { balances, found };
}
