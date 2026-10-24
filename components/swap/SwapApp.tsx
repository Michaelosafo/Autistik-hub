"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WCHAINS, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "@/components/wallet/types";
import MarketForm from "@/components/wallet/MarketForm";
import { api, store, type Holding } from "@/components/wallet/util";
import { XCHAINS, XCHAIN_BY_KEY, XCHAIN_LIST, isXNative, xNative, type XChain, type XToken } from "@/lib/bridge-chains";
import BridgeForm from "./BridgeForm";
import { SwapPanels, type CardIO, type Side } from "./SwapCard";

/** What each network's swap opens with: the chain's coin -> AUTISTIK (BNB Chain) or USDC. */
const DEFAULT_TO: Record<WChainKey, string> = {
  bsc: "AUTISTIK", base: "USDC", ethereum: "USDC", arbitrum: "USDC", solana: "USDC",
};

const nativeOf = (c: XChain): XToken => ({ address: xNative(c), symbol: c.native.symbol, name: c.native.symbol, decimals: c.native.decimals, logo: null });

/** A network's opening "get" coin: AUTISTIK or USDC on the Wallet's networks. */
const defaultTo = (net: XChain): XToken | null => {
  if (!net.wchain) return null;
  const c = WCHAINS[net.wchain];
  return c.tokens.find((t) => t.symbol === DEFAULT_TO[net.wchain!]) || c.tokens[0] || null;
};

/**
 * The App's Swap card: the coin you pay with and the coin you get, each picked (with its network) from the token
 * sheet. On one of the Wallet's own networks it is the Wallet engine (KyberSwap / Jupiter); anywhere else, or across
 * networks, LI.FI finds the route.
 */
export default function SwapApp({ signer, start }: { signer: Signer; start: { chain?: string; buy?: string } }) {
  const first = (start.chain && XCHAIN_BY_KEY[start.chain]) || XCHAIN_BY_KEY.bsc;
  const [fromNet, setFromNet] = useState<XChain>(first);
  const [toNet, setToNet] = useState<XChain>(first);
  const [logos, setLogos] = useState<Record<number, string>>({});
  useEffect(() => { api<{ logos: Record<number, string> }>("x-chains", {}).then((d) => setLogos(d.logos)).catch(() => {}); }, []);
  const local = fromNet.id === toNet.id && fromNet.wchain ? fromNet.wchain : null;
  const solFromOk = (c: XChain) => (c.kind === "solana" && signer.mode === "browser" ? "Solana needs the AUTISTIK wallet" : null);

  const [xFrom, setXFrom] = useState<XToken | null>(nativeOf(first));
  const [xTo, setXTo] = useState<XToken | null>(defaultTo(first));
  // A coin to get on a network: its own coin when crossing, else AUTISTIK / USDC or the first popular coin there.
  const pickTo = useCallback((net: XChain, from: XChain, avoid?: XToken | null) => {
    if (net.id !== from.id) { setXTo(nativeOf(net)); return; }
    const d = defaultTo(net);
    if (d) { setXTo(avoid && d.address.toLowerCase() === avoid.address.toLowerCase() ? nativeOf(net) : d); return; }
    setXTo(null);
    api<{ tokens: XToken[] }>("x-tokens", { chain: net.id, q: "" }).then((r) => setXTo(r.tokens.find((t) => t.address !== xNative(net)) || null)).catch(() => {});
  }, []);
  useEffect(() => { if (!xTo) pickTo(first, first); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A link with a coin (?buy=0x…): get that coin, paying with its network's own coin.
  useEffect(() => {
    if (!start.buy) return;
    api<{ chain: number; token: XToken }>("x-detect", { address: start.buy }).then((d) => {
      const net = XCHAINS[d.chain];
      setFromNet(net); setXFrom(nativeOf(net)); setToNet(net); setXTo(d.token);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the member picks where to receive, changing the pay coin's network no longer moves it.
  const [toPicked, setToPicked] = useState(false);
  const isSame = (a: XToken | null, b: XToken | null) => !!a && !!b && a.address.toLowerCase() === b.address.toLowerCase();
  function flip() {
    if (solFromOk(toNet)) return;
    setFromNet(toNet); setToNet(fromNet); setXFrom(xTo || nativeOf(toNet)); setXTo(xFrom);
  }
  function pick(side: Side, net: XChain, t: XToken) {
    if (side === "from") {
      if (net.id === toNet.id && isSame(t, xTo)) return flip();
      // While both sides are on one network, moving "pay" moves both.
      const follow = toNet.id === fromNet.id && net.id !== fromNet.id && !toPicked;
      setFromNet(net); setXFrom(t);
      if (follow) { setToNet(net); pickTo(net, net, t); }
    } else {
      if (net.id === fromNet.id && isSame(t, xFrom)) return flip();
      setToPicked(true); setToNet(net); setXTo(t);
    }
  }

  // The Wallet engine, for a swap on one of its own networks.
  const chainKey: WChainKey = local || "bsc";
  const c = WCHAINS[chainKey];
  const owner = (c.kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? null;
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const load = useCallback(async () => {
    setHoldings(null);
    if (!owner || !local) return;
    const d = await api<{ holdings: Holding[] }>("balances", { chain: chainKey, owner, extra: store.get<WToken[]>(`aw-tokens-${chainKey}`, []).map((t) => t.address) }).catch(() => ({ holdings: [] as Holding[] }));
    setHoldings(d.holdings);
  }, [chainKey, owner, local]);
  useEffect(() => { load(); }, [load]);
  const toW = (t: XToken | null): WToken | null => (!t ? null : isXNative(fromNet, t.address) ? c.native : { address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo });
  const from = local ? toW(xFrom) : null, to = local ? toW(xTo) : null;
  const tokens = useMemo(() => {
    const m = new Map<string, WToken>();
    for (const t of [c.native, ...(holdings || []), ...c.tokens]) if (!m.has(t.address.toLowerCase())) m.set(t.address.toLowerCase(), t);
    return [...m.values()];
  }, [c, holdings]);
  const balanceOf = (a: string) => holdings?.find((h) => h.address.toLowerCase() === a.toLowerCase());

  const owners = { evm: signer.evm?.address, sol: signer.sol?.address };
  const card = (io: CardIO) => (
    <SwapPanels io={io} from={{ net: fromNet, token: xFrom }} to={{ net: toNet, token: xTo }} logos={logos} owners={owners} allow={solFromOk} onPick={pick} onFlip={flip} />
  );
  // Before a wallet is connected the card still works: pick coins and type an amount.
  const [preAmount, setPreAmount] = useState("");
  const cross = fromNet.id !== toNet.id;

  return (
    <div className="sw">
      <div className="sw-card sc-card">
        <div className="sc-head">
          <h1>Swap</h1>
          <Link href="/wallet" className="sc-tab">Limit</Link>
          <span className={"sc-mode" + (cross ? " x" : "")}>{cross ? <><i className="sx-arc" aria-hidden="true">∞</i>{fromNet.name} → {toNet.name}</> : `${XCHAIN_LIST.length} networks`}</span>
        </div>

        {!local ? (
          <BridgeForm key={`${fromNet.id}-${toNet.id}`} signer={signer} from={fromNet} to={toNet} fromToken={xFrom} toToken={xTo}
            onFromToken={setXFrom} onToToken={setXTo} logos={logos} card={card} />
        ) : owner && from && to ? (
          <MarketForm key={`${chainKey}-${from.address}-${to.address}`} c={c} signer={signer} owner={owner} from={from} to={to} side="convert" tokens={tokens}
            balanceOf={balanceOf} onAdd={() => {}} onDone={() => { load(); }} card={card} />
        ) : (
          <div className="sw-pre">
            {card({ amount: preAmount, setAmount: setPreAmount, balance: null, onMax: null, inUsd: null, out: <span className="tx-dim">0</span>, outUsd: null })}
            <button type="button" className="sw-connect" onClick={signer.loginExternal ?? signer.login}>Connect Wallet</button>
            {signer.loginEmbedded && <button type="button" className="sw-alt" onClick={signer.loginEmbedded}>or use the AUTISTIK wallet (email, Google, Apple)</button>}
          </div>
        )}
      </div>

      <div className="sw-links">
        {local && to && <Link href={`/analytics/${chainKey}/${to.address}`}>Scan {to.symbol} →</Link>}
        <Link href="/stake">Stake AUTISTIK, earn BNB →</Link>
      </div>
      <p className="sw-note">{local ? "Best price across every DEX (KyberSwap, Jupiter). A 0.5% fee per swap, on every chain, goes to AUTISTIK marketing." : "Routes across bridges and DEXs on every network, found by LI.FI."} Your keys stay in your wallet.</p>
    </div>
  );
}
