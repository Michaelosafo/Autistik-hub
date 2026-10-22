"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WCHAINS, WCHAIN_LIST, type WChainKey, type WToken } from "@/lib/wallet-chains";
import { TOKEN_ADDRESS } from "@/lib/groups";
import type { Member, Signer } from "./types";
import MarketForm from "./MarketForm";
import OrderForm, { OpenOrders } from "./OrderForm";
import SimpleMode from "./SimpleMode";
import { Assets, History, Receive, Security, Send, Welcome } from "./panels";
import { api, pct, short, store, TokenPicker, usd, type Holding, type Market, type TokenInfo } from "./util";

/** The token each network opens on. */
const FEATURED: Record<WChainKey, string> = {
  bsc: TOKEN_ADDRESS, base: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", ethereum: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
  arbitrum: "0x912CE59144191C1204E64559FE8253a0e49E6548", solana: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};
type OType = "market" | "limit" | "stop";
type BTab = "assets" | "orders" | "history" | "convert" | "send" | "receive" | "security";

/** AUTISTIK Trade: an exchange-style screen on top of the member's own wallet. */
export default function WalletApp({ signer, start, member }: { signer: Signer; start: { chain?: string; buy?: string; quick?: boolean }; member?: Member | null }) {
  const [chainKey, setChainKey] = useState<WChainKey>(start.chain && start.chain in WCHAINS ? (start.chain as WChainKey) : "bsc");
  const c = WCHAINS[chainKey];
  const owner = c.kind === "solana" ? signer.sol?.address : signer.evm?.address;
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [custom, setCustom] = useState<WToken[]>([]);
  const [baseAddr, setBaseAddr] = useState<string>(start.buy || FEATURED[chainKey]);
  const [quoteAddr, setQuoteAddr] = useState<string>(c.native.address);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [otype, setOtype] = useState<OType>("market");
  const [btab, setBtab] = useState<BTab>("assets");
  const [mkt, setMkt] = useState<Market | null>(null);
  const [chart, setChart] = useState(true);
  const [convFrom, setConvFrom] = useState<WToken | null>(null);
  const [convTo, setConvTo] = useState<WToken | null>(null);
  // Simple (beginners: discover and buy in one tap) or Pro (exchange screen with charts and orders). Remembered per device.
  const [mode, setModeState] = useState<"simple" | "pro">("simple");
  useEffect(() => { setModeState(start.quick ? "simple" : store.get("aw-mode", start.buy ? "pro" : "simple")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setMode = (m: "simple" | "pro") => { setModeState(m); store.set("aw-mode", m); };

  useEffect(() => { setCustom(store.get(`aw-tokens-${chainKey}`, [])); }, [chainKey]);
  const addCustom = useCallback((t: WToken) => setCustom((list) => {
    if (list.some((x) => x.address.toLowerCase() === t.address.toLowerCase()) || c.tokens.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) return list;
    const next = [...list, { address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo }].slice(-25);
    store.set(`aw-tokens-${chainKey}`, next);
    return next;
  }), [c, chainKey]);

  const load = useCallback(async () => {
    if (!owner) { setHoldings(null); return; }
    setLoadErr("");
    try {
      const d = await api<{ holdings: Holding[] }>("balances", { chain: chainKey, owner, extra: store.get<WToken[]>(`aw-tokens-${chainKey}`, []).map((t) => t.address) });
      setHoldings(d.holdings);
    } catch (e: any) { setLoadErr(e.message); setHoldings((h) => h ?? []); }
  }, [chainKey, owner]);
  useEffect(() => { setHoldings(null); load(); }, [load]);

  const tokens: WToken[] = useMemo(() => {
    const m = new Map<string, WToken>();
    for (const t of [c.native, ...(holdings || []), ...c.tokens, ...custom]) if (!m.has(t.address.toLowerCase())) m.set(t.address.toLowerCase(), t);
    return [...m.values()];
  }, [c, holdings, custom]);
  const find = (a: string) => tokens.find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? null;
  const balanceOf = (a: string) => holdings?.find((h) => h.address.toLowerCase() === a.toLowerCase());
  const base = find(baseAddr);
  const quote = find(quoteAddr) ?? c.native;
  const quotes = [c.native, ...c.tokens.filter((t) => /^USD/.test(t.symbol))];

  // A token from a link, or picked by address, that isn't in the list yet.
  useEffect(() => {
    if (!base && baseAddr) api<{ token: TokenInfo }>("token", { chain: chainKey, address: baseAddr }).then((d) => addCustom(d.token)).catch(() => setBaseAddr(FEATURED[chainKey]));
  }, [baseAddr, base, chainKey, addCustom]);
  // Live market numbers for the selected token.
  useEffect(() => {
    setMkt(null);
    if (!baseAddr) return;
    let live = true;
    const get = () => api<{ market: Market }>("market", { chain: chainKey, token: baseAddr }).then((d) => live && setMkt(d.market)).catch(() => {});
    get(); const t = setInterval(get, 30_000);
    return () => { live = false; clearInterval(t); };
  }, [chainKey, baseAddr]);

  function switchChain(k: WChainKey) { setChainKey(k); setBaseAddr(FEATURED[k]); setQuoteAddr(WCHAINS[k].native.address); setConvFrom(null); setConvTo(null); }

  if (!signer.ready) return <div className="tx-panel tx-dim" style={{ padding: 16 }}>Loading…</div>;
  if (!signer.active) return <Welcome signer={signer} member={member} />;

  const total = (holdings || []).reduce((s, h) => s + (h.valueUsd || 0), 0);
  const missing = !owner ? (c.kind === "solana" ? "Solana needs the AUTISTIK wallet or a Solana wallet like Phantom." : "Connect an EVM wallet to trade on this network.") : "";
  const up = (mkt?.change24 ?? 0) >= 0;

  const toggle = (
    <div className="tx-mode" role="tablist" aria-label="Screen">
      <button type="button" role="tab" aria-selected={mode === "simple"} className={mode === "simple" ? "on" : ""} onClick={() => setMode("simple")}>Simple</button>
      <button type="button" role="tab" aria-selected={mode === "pro"} className={mode === "pro" ? "on" : ""} onClick={() => setMode("pro")}>Pro</button>
    </div>
  );
  if (mode === "simple") return (
    <div className="tx">
      {toggle}
      {missing && <div className="notice warn">{missing}</div>}
      {owner && <SimpleMode c={c} onChain={switchChain} signer={signer} owner={owner} holdings={holdings} balanceOf={balanceOf} onAdd={addCustom} onDone={load} startBuy={start.quick && start.buy && start.chain === chainKey ? start.buy : undefined} />}
    </div>
  );

  return (
    <div className="tx">
      {toggle}
      <div className="tx-panel tx-bar">
        <select className="tx-net" value={chainKey} onChange={(e) => switchChain(e.target.value as WChainKey)} aria-label="Network">
          {WCHAIN_LIST.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
        <div className="tx-pair">
          <TokenPicker big c={c} tokens={tokens.filter((t) => t.address.toLowerCase() !== quote.address.toLowerCase())} value={base} onPick={(t) => setBaseAddr(t.address)} onAdd={addCustom} label="Choose a market" balanceOf={balanceOf} />
          <select className="tx-quote" value={quote.address} onChange={(e) => setQuoteAddr(e.target.value)} aria-label="Quote currency">
            {quotes.map((t) => <option key={t.address} value={t.address}>/ {t.symbol}</option>)}
          </select>
        </div>
        <div className={"tx-price " + (up ? "up" : "down")}>{usd(mkt?.priceUsd)}</div>
        <dl className="tx-stats">
          <div><dt>24h change</dt><dd className={up ? "up" : "down"}>{pct(mkt?.change24)}</dd></div>
          <div><dt>1h</dt><dd className={(mkt?.change1h ?? 0) >= 0 ? "up" : "down"}>{pct(mkt?.change1h)}</dd></div>
          <div><dt>24h volume</dt><dd>{usd(mkt?.volume24)}</dd></div>
          <div className="hide-sm"><dt>Liquidity</dt><dd>{usd(mkt?.liquidity)}</dd></div>
          <div className="hide-sm"><dt>Market cap</dt><dd>{usd(mkt?.mcap)}</dd></div>
          <div className="hide-sm"><dt>24h buys / sells</dt><dd><span className="up">{mkt?.buys24 ?? "–"}</span> / <span className="down">{mkt?.sells24 ?? "–"}</span></dd></div>
        </dl>
        <div className="tx-acct">
          <span className="tx-acct-bal">{holdings ? usd(total) : "…"}</span>
          <span className="tx-dim">{signer.using === "external" ? "Your wallet" : signer.mode === "privy" ? "AUTISTIK wallet" : "Wallet"}{owner ? ` · ${short(owner)}` : ""}</span>
          {signer.canSwitch && signer.switchTo && <button type="button" className="aw-link" onClick={() => signer.switchTo!(signer.using === "external" ? "embedded" : "external")}>Use {signer.using === "external" ? "AUTISTIK wallet" : "my wallet"}</button>}
        </div>
      </div>

      {missing && <div className="notice warn">{missing}</div>}
      {loadErr && <div className="notice warn">Couldn&apos;t load balances: {loadErr} <button className="btn small" type="button" onClick={load}>Retry</button></div>}

      <div className="tx-grid">
        <div className="tx-panel tx-chart">
          <div className="tx-chart-head"><b>Chart</b><button type="button" className="aw-link show-sm" onClick={() => setChart(!chart)}>{chart ? "Hide" : "Show"}</button></div>
          {chart && (mkt?.pair
            ? <iframe key={mkt.pair} title={`${base?.symbol || ""} price chart`} src={`https://dexscreener.com/${c.key}/${mkt.pair}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=15`} loading="lazy" referrerPolicy="no-referrer" />
            : <div className="tx-nochart tx-dim">{mkt ? "No chart for this token yet." : "Loading chart…"}</div>)}
        </div>

        <div className="tx-panel tx-order">
          <div className="tx-seg" role="tablist" aria-label="Buy or sell">
            <button type="button" role="tab" aria-selected={side === "buy"} className={"buy" + (side === "buy" ? " on" : "")} onClick={() => setSide("buy")}>Buy</button>
            <button type="button" role="tab" aria-selected={side === "sell"} className={"sell" + (side === "sell" ? " on" : "")} onClick={() => setSide("sell")}>Sell</button>
          </div>
          <div className="tx-types" role="tablist" aria-label="Order type">
            {(["market", "limit", "stop"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={otype === t} className={otype === t ? "on" : ""} onClick={() => setOtype(t)}>{t === "market" ? "Market" : t === "limit" ? "Limit" : "Stop-loss"}</button>)}
          </div>
          {owner && base && (otype === "market"
            ? <MarketForm key={`${chainKey}-${side}-${base.address}-${quote.address}`} c={c} signer={signer} owner={owner} side={side}
                from={side === "buy" ? quote : base} to={side === "buy" ? base : quote} tokens={tokens} balanceOf={balanceOf} onAdd={addCustom} onDone={load} />
            : <OrderForm key={`${chainKey}-${side}-${otype}-${base.address}-${quote.address}`} c={c} signer={signer} owner={owner} side={side} kind={otype}
                base={base} quote={quote} market={mkt} balanceOf={balanceOf} onDone={() => { load(); setBtab("orders"); }} />)}
        </div>
      </div>

      <div className="tx-panel tx-bottom">
        <div className="tx-tabs" role="tablist" aria-label="Account">
          {([["assets", "Assets"], ["orders", "Open orders"], ["history", "History"], ["convert", "Convert"], ["send", "Send"], ["receive", "Deposit"], ["security", "Security"]] as const).map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={btab === k} className={btab === k ? "on" : ""} onClick={() => setBtab(k)}>{name}</button>
          ))}
        </div>
        <div className="tx-tabbody">
          {btab === "assets" && <Assets c={c} holdings={holdings} onPick={(t) => { if (t.address.toLowerCase() !== quote.address.toLowerCase()) { setBaseAddr(t.address); setSide("sell"); } }} onAdd={async (a) => {
            const d = await api<{ token: TokenInfo }>("token", { chain: chainKey, address: a }); addCustom(d.token); setTimeout(load, 50); return d.token;
          }} />}
          {btab === "orders" && owner && <OpenOrders c={c} signer={signer} owner={owner} />}
          {btab === "history" && <History />}
          {btab === "convert" && owner && <div style={{ maxWidth: 520 }}><MarketForm key={chainKey} c={c} signer={signer} owner={owner} side="convert" from={convFrom ?? c.native} to={convTo ?? c.tokens[0] ?? null}
            tokens={tokens} balanceOf={balanceOf} onAdd={addCustom} onFrom={setConvFrom} onTo={setConvTo} onDone={load} /></div>}
          {btab === "send" && owner && <Send key={chainKey} c={c} signer={signer} owner={owner} holdings={holdings || []} onDone={load} />}
          {btab === "receive" && owner && <Receive c={c} address={owner} />}
          {btab === "security" && <Security signer={signer} />}
        </div>
      </div>
    </div>
  );
}
