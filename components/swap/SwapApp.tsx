"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WCHAINS, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "@/components/wallet/types";
import MarketForm from "@/components/wallet/MarketForm";
import { api, store, TokenPicker, type Holding, type TokenInfo } from "@/components/wallet/util";
import { XCHAIN_BY_KEY, XCHAIN_LIST, xNative, type XChain, type XToken } from "@/lib/bridge-chains";
import BridgeForm from "./BridgeForm";
import { NetPicker } from "./parts";

/** What each network's swap opens with: the chain's coin -> AUTISTIK (BNB Chain) or USDC. */
const DEFAULT_TO: Record<WChainKey, string> = {
  bsc: "AUTISTIK", base: "USDC", ethereum: "USDC", arbitrum: "USDC", solana: "USDC",
};

const nativeOf = (c: XChain): XToken => ({ address: xNative(c), symbol: c.native.symbol, name: c.native.symbol, decimals: c.native.decimals, logo: null });

/**
 * The App's Swap card: pick a network and a coin to pay with, and a network and a coin to get. On one of the Wallet's
 * own networks it is the Wallet engine (KyberSwap / Jupiter); anywhere else, or across networks, LI.FI finds the route.
 */
export default function SwapApp({ signer, start }: { signer: Signer; start: { chain?: string; buy?: string } }) {
  const first = (start.chain && XCHAIN_BY_KEY[start.chain]) || XCHAIN_BY_KEY.bsc;
  const [fromNet, setFromNet] = useState<XChain>(first);
  const [toNet, setToNet] = useState<XChain>(first);
  const [logos, setLogos] = useState<Record<number, string>>({});
  useEffect(() => { api<{ logos: Record<number, string> }>("x-chains", {}).then((d) => setLogos(d.logos)).catch(() => {}); }, []);
  const local = fromNet.id === toNet.id && fromNet.wchain ? fromNet.wchain : null;

  const [xFrom, setXFrom] = useState<XToken | null>(nativeOf(first));
  const [xTo, setXTo] = useState<XToken | null>(null);
  // A coin to get on a network: its own coin when crossing, else the first popular coin there (USDC, USDT…).
  const pickTo = useCallback((net: XChain, from: XChain) => {
    if (net.id !== from.id) { setXTo(nativeOf(net)); return; }
    setXTo(null);
    api<{ tokens: XToken[] }>("x-tokens", { chain: net.id, q: "" }).then((d) => setXTo(d.tokens.find((t) => t.address !== xNative(net)) || null)).catch(() => {});
  }, []);
  function chooseFrom(n: XChain) {
    // While both sides are on one network, moving "From" moves both.
    const to = toNet.id === fromNet.id ? n : toNet;
    setFromNet(n); setToNet(to); setXFrom(nativeOf(n)); pickTo(to, n);
    if (to.id === n.id && n.wchain) switchChain(n.wchain);
  }
  function chooseTo(n: XChain) {
    setToNet(n); pickTo(n, fromNet);
    if (n.id === fromNet.id && n.wchain) switchChain(n.wchain);
  }
  const flipNets = () => { const f = fromNet, t = toNet, a = xFrom, b = xTo; setFromNet(t); setToNet(f); setXFrom(b); setXTo(a); };
  const solFromOk = (c: XChain) => (c.kind === "solana" && signer.mode === "browser" ? "Solana needs the AUTISTIK wallet" : null);

  const [chainKey, setChainKey] = useState<WChainKey>(first.wchain || "bsc");
  const c = WCHAINS[chainKey];
  const owner = (c.kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? null;
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [custom, setCustom] = useState<WToken[]>([]);
  const [fromAddr, setFromAddr] = useState(c.native.address);
  const [toAddr, setToAddr] = useState<string>(start.buy || c.tokens.find((t) => t.symbol === DEFAULT_TO[chainKey])?.address || c.tokens[0].address);

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
          <div><h1>Swap <span>anywhere</span></h1><small>Any coin, any network, in one swap</small>
            <div className="sw-badges"><span className="g">Best price</span><span>Your keys</span><span className="v">{XCHAIN_LIST.length} networks</span></div>
          </div>
        </div>

        <div className={"sx-bar" + (local ? "" : " cross")}>
          <NetPicker label="From" value={fromNet} onPick={chooseFrom} logos={logos} allow={solFromOk} />
          <button type="button" className="sx-swapnets" onClick={flipNets} aria-label="Switch the two networks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <NetPicker label="To" value={toNet} onPick={chooseTo} logos={logos} />
        </div>
        <div className="sx-mode">{local ? <>Same network · best price across every DEX</> : fromNet.id === toNet.id ? <>Best price across every DEX on {fromNet.name}</> : <><i className="sx-arc" aria-hidden="true">∞</i>Cross-chain · bridge and swap in one step</>}</div>

        {!local ? (
          <BridgeForm key={`${fromNet.id}-${toNet.id}`} signer={signer} from={fromNet} to={toNet} fromToken={xFrom} toToken={xTo}
            onFromToken={setXFrom} onToToken={setXTo} logos={logos} />
        ) : owner && from && to ? (
          <>
            <MarketForm key={`${chainKey}-${fromAddr}-${toAddr}`} c={c} signer={signer} owner={owner} from={from} to={to} side="convert" tokens={tokens}
              balanceOf={balanceOf} onAdd={addCustom} onFrom={(t) => setFromAddr(t.address)} onTo={(t) => setToAddr(t.address)} onDone={load} />
            <button type="button" className="sw-flip" onClick={flip} aria-label="Switch the two tokens">⇅ Switch</button>
          </>
        ) : (
          <div className="sw-pre">
            <div className="tx-field"><div className="row tx-field-top"><span>You pay</span></div>
              <div className="row tx-field-mid"><div className="tx-out"><span className="tx-dim">0.00</span></div><TokenPicker c={c} tokens={tokens} value={from} onPick={(t) => setFromAddr(t.address)} onAdd={addCustom} label="From" balanceOf={balanceOf} /></div></div>
            <button type="button" className="sw-flip" onClick={flip} aria-label="Switch the two tokens">⇅</button>
            <div className="tx-field"><div className="row tx-field-top"><span>You get</span></div>
              <div className="row tx-field-mid"><div className="tx-out"><span className="tx-dim">0.00</span></div><TokenPicker c={c} tokens={tokens} value={to} onPick={(t) => setToAddr(t.address)} onAdd={addCustom} label="To" balanceOf={balanceOf} /></div></div>
            <button type="button" className="sw-connect" onClick={signer.loginExternal ?? signer.login}>Connect Wallet</button>
            {signer.loginEmbedded && <button type="button" className="sw-alt" onClick={signer.loginEmbedded}>or use the AUTISTIK wallet (email, Google, Apple)</button>}
          </div>
        )}
      </div>

      <div className="sw-links">
        <Link href="/wallet">Limit &amp; stop-loss orders →</Link>
        {local && to && <Link href={`/analytics/${chainKey}/${to.address}`}>Scan {to.symbol} →</Link>}
        <Link href="/stake">Stake AUTISTIK, earn BNB →</Link>
      </div>
      <p className="sw-note">{local ? "Best price across every DEX (KyberSwap, Jupiter). 0.5% fee per swap supports AUTISTIK." : "Routes across bridges and DEXs on every network, found by LI.FI."} Your keys stay in your wallet.</p>
    </div>
  );
}
