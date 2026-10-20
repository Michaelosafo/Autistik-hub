"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WCHAINS, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "@/components/wallet/types";
import MarketForm from "@/components/wallet/MarketForm";
import { api, store, TokenPicker, type Holding, type TokenInfo } from "@/components/wallet/util";
import { XCHAINS, XCHAIN_BY_KEY, XCHAIN_LIST, xNative, type XChain, type XToken } from "@/lib/bridge-chains";
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
    setAuto(false);
    // While both sides are on one network, moving "From" moves both.
    const to = toNet.id === fromNet.id ? n : toNet;
    setFromNet(n); setToNet(to); setXFrom(nativeOf(n)); pickTo(to, n);
    if (to.id === n.id && n.wchain) switchChain(n.wchain);
  }
  // Once the member picks where to receive, a pasted address no longer moves it.
  const [toPicked, setToPicked] = useState(false);
  function chooseTo(n: XChain) {
    setToPicked(true);
    setToNet(n); pickTo(n, fromNet);
    // Back on the pay network: keep the coin they pay with.
    if (n.id === fromNet.id && n.wchain) { switchChain(n.wchain); if (xFrom) setFromAddr(xFrom.address); }
  }
  const flipNets = () => { const f = fromNet, t = toNet, a = xFrom, b = xTo; setFromNet(t); setToNet(f); setXFrom(b); setXTo(a); setAuto(false); setToPicked(true); };
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

  // Paste the contract address of the coin to pay with: the swap finds its network and fills in the "pay" side.
  // The member picks where to receive (until then it is the same network, getting its own coin).
  const [ca, setCa] = useState(""); const [finding, setFinding] = useState(false); const [found, setFound] = useState<{ ok: boolean; text: string } | null>(null);
  const [auto, setAuto] = useState(false);
  const caSeq = useRef(0);
  const toPickedRef = useRef(toPicked); toPickedRef.current = toPicked;
  const toNetRef = useRef(toNet); toNetRef.current = toNet;
  const detect = useCallback(async (raw: string) => {
    const a = raw.trim();
    setFound(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(a) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) { setFinding(false); return; }
    const id = ++caSeq.current; setFinding(true);
    try {
      const d = await api<{ chain: number; token: XToken }>("x-detect", { address: a });
      if (id !== caSeq.current) return;
      const net = XCHAINS[d.chain];
      const to = toPickedRef.current ? toNetRef.current : net;
      setFromNet(net); setXFrom(d.token); setAuto(true);
      setToNet(to); setXTo(nativeOf(to));
      if (to.id === net.id && net.wchain) { switchChain(net.wchain); setFromAddr(d.token.address); setToAddr(WCHAINS[net.wchain].native.address); }
      setFound({ ok: true, text: `Paying with ${d.token.symbol} on ${net.name}` });
    } catch (e: any) { if (id === caSeq.current) setFound({ ok: false, text: e.message }); }
    if (id === caSeq.current) setFinding(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A link with a coin but no network (?buy=0x…): find the network too.
  useEffect(() => { if (start.buy && !start.chain) detect(start.buy); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="sw">
      <div className="sw-card">
        <div className="sw-head">
          <div><h1>Swap <span>anywhere</span></h1><small>Any coin, any network, in one swap</small>
            <div className="sw-badges"><span className="g">Best price</span><span>Your keys</span><span className="v">{XCHAIN_LIST.length} networks</span></div>
          </div>
        </div>

        <label className={"sx-ca" + (found ? (found.ok ? " ok" : " bad") : "")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1zm0 2v1h6V6z" fill="currentColor" /></svg>
          <input value={ca} onChange={(e) => { setCa(e.target.value); detect(e.target.value); }} placeholder="Paste the contract address (CA) you pay with" spellCheck={false} autoComplete="off" aria-label="Paste the contract address of the coin you pay with" />
          {finding ? <span className="sx-ca-note"><span className="aw-spin" /> Finding…</span> : found ? <span className="sx-ca-note">{found.ok ? "✓ " : ""}{found.text}</span> : null}
        </label>

        <div className={"sx-bar" + (local ? "" : " cross")}>
          <NetPicker label="Pay on" value={fromNet} onPick={chooseFrom} logos={logos} allow={solFromOk} tag={auto ? "auto" : undefined} />
          <button type="button" className="sx-swapnets" onClick={flipNets} aria-label="Switch the two networks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <NetPicker label="Receive on" value={toNet} onPick={chooseTo} logos={logos} hint={auto && !toPicked ? "choose" : undefined} />
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
