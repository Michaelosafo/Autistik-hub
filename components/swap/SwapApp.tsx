"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WCHAINS, WCHAIN_LIST, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "@/components/wallet/types";
import MarketForm from "@/components/wallet/MarketForm";
import { api, store, TokenPicker, type Holding, type TokenInfo } from "@/components/wallet/util";

/** What each network's swap opens with: the chain's coin -> AUTISTIK (BNB Chain) or USDC. */
const DEFAULT_TO: Record<WChainKey, string> = {
  bsc: "AUTISTIK", base: "USDC", ethereum: "USDC", arbitrum: "USDC", solana: "USDC",
};

/** The App's Swap card: pick two tokens, see the best price, swap. Same engine as the Wallet (KyberSwap / Jupiter). */
export default function SwapApp({ signer, start }: { signer: Signer; start: { chain?: string; buy?: string } }) {
  const [chainKey, setChainKey] = useState<WChainKey>(start.chain && start.chain in WCHAINS ? (start.chain as WChainKey) : "bsc");
  const c = WCHAINS[chainKey];
  const owner = (c.kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? null;
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [custom, setCustom] = useState<WToken[]>([]);
  const [fromAddr, setFromAddr] = useState(c.native.address);
  const [toAddr, setToAddr] = useState<string>(start.buy || c.tokens.find((t) => t.symbol === DEFAULT_TO[chainKey])?.address || c.tokens[0].address);
  const chains = WCHAIN_LIST.filter((x) => x.kind !== "solana" || signer.sol);

  useEffect(() => { setCustom(store.get(`aw-tokens-${chainKey}`, [])); }, [chainKey]);
  const addCustom = useCallback((t: WToken) => setCustom((list) => {
    if ([...list, ...c.tokens].some((x) => x.address.toLowerCase() === t.address.toLowerCase())) return list;
    const next = [...list, { address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo }].slice(-25);
    store.set(`aw-tokens-${chainKey}`, next);
    return next;
  }), [c, chainKey]);

  const load = useCallback(async () => {
    if (!owner) { setHoldings(null); return; }
    const d = await api<{ holdings: Holding[] }>("balances", { chain: chainKey, owner, extra: store.get<WToken[]>(`aw-tokens-${chainKey}`, []).map((t) => t.address) }).catch(() => ({ holdings: [] as Holding[] }));
    setHoldings(d.holdings);
  }, [chainKey, owner]);
  useEffect(() => { load(); }, [load]);

  const tokens = useMemo(() => {
    const m = new Map<string, WToken>();
    for (const t of [c.native, ...(holdings || []), ...c.tokens, ...custom]) if (!m.has(t.address.toLowerCase())) m.set(t.address.toLowerCase(), t);
    return [...m.values()];
  }, [c, holdings, custom]);
  const find = (a: string) => tokens.find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? null;
  const balanceOf = (a: string) => holdings?.find((h) => h.address.toLowerCase() === a.toLowerCase());
  const from = find(fromAddr), to = find(toAddr);

  // A coin from a link (?buy=0x…) that isn't in the list yet.
  useEffect(() => {
    if (!to && toAddr) api<{ token: TokenInfo }>("token", { chain: chainKey, address: toAddr }).then((d) => addCustom(d.token)).catch(() => {});
  }, [to, toAddr, chainKey, addCustom]);

  function switchChain(k: WChainKey) {
    const n = WCHAINS[k];
    setChainKey(k); setHoldings(null);
    setFromAddr(n.native.address);
    setToAddr(n.tokens.find((t) => t.symbol === DEFAULT_TO[k])?.address || n.tokens[0].address);
  }
  const flip = () => { const f = fromAddr; setFromAddr(toAddr); setToAddr(f); };

  return (
    <div className="sw">
      <div className="sw-card">
        <div className="sw-head">
          <div><h1>Swap</h1><small>Trade tokens in an instant</small></div>
          <select className="sw-net" value={chainKey} onChange={(e) => switchChain(e.target.value as WChainKey)} aria-label="Network">
            {chains.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </div>

        {owner && from && to ? (
          <>
            <MarketForm key={`${chainKey}-${fromAddr}-${toAddr}`} c={c} signer={signer} owner={owner} from={from} to={to} side="convert" tokens={tokens}
              balanceOf={balanceOf} onAdd={addCustom} onFrom={(t) => setFromAddr(t.address)} onTo={(t) => setToAddr(t.address)} onDone={load} />
            <button type="button" className="sw-flip" onClick={flip} aria-label="Switch the two tokens">⇅ Switch</button>
          </>
        ) : (
          <div className="sw-pre">
            <div className="sw-field"><span>From</span><TokenPicker c={c} tokens={tokens} value={from} onPick={(t) => setFromAddr(t.address)} onAdd={addCustom} label="From" balanceOf={balanceOf} /></div>
            <button type="button" className="sw-flip" onClick={flip} aria-label="Switch the two tokens">⇅</button>
            <div className="sw-field"><span>To</span><TokenPicker c={c} tokens={tokens} value={to} onPick={(t) => setToAddr(t.address)} onAdd={addCustom} label="To" balanceOf={balanceOf} /></div>
            <button type="button" className="sw-connect" onClick={signer.loginExternal ?? signer.login}>Connect Wallet</button>
            {signer.loginEmbedded && <button type="button" className="sw-alt" onClick={signer.loginEmbedded}>or use the AUTISTIK wallet (email, Google, Apple)</button>}
          </div>
        )}
      </div>

      <div className="sw-links">
        <Link href="/wallet">Limit &amp; stop-loss orders →</Link>
        {to && <Link href={`/analytics/${chainKey}/${to.address}`}>Scan {to.symbol} →</Link>}
        <Link href="/stake">Stake AUTISTIK, earn BNB →</Link>
      </div>
      <p className="sw-note">Best price across every DEX (KyberSwap, Jupiter). 0.5% fee per swap supports AUTISTIK. Your keys stay in your wallet.</p>
    </div>
  );
}
