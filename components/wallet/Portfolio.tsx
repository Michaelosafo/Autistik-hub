"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { WCHAINS, WCHAIN_LIST, isNative, type WChainKey, type WToken } from "@/lib/wallet-chains";
import { XCHAIN_LIST } from "@/lib/bridge-chains";
import { ChainBadge } from "@/components/swap/parts";
import type { Signer } from "./types";
import { History, Receive, Send } from "./panels";
import { amt, api, Logo, short, store, usd, type Holding } from "./util";

/** Each network's own color, for its card and badges. */
export const CHAIN_COLOR: Record<WChainKey, string> = { bsc: "#F0B90B", base: "#0052FF", ethereum: "#627EEA", arbitrum: "#28A0F0", solana: "#9945FF" };
const xOf = (k: WChainKey) => XCHAIN_LIST.find((x) => x.wchain === k)!;

type Row = Holding & { chain: WChainKey };
type SheetKind = { kind: "receive" | "send"; chain: WChainKey; token?: string } | { kind: "history" } | { kind: "asset"; row: Row } | null;

/**
 * The wallet's home: everything the member owns on every network in one place, with Receive, Send, Buy, Swap and
 * History one tap away. Balances are read live from each network; nothing here holds or moves money by itself.
 */
export default function Portfolio({ signer, onTrade }: { signer: Signer; onTrade: (chain: WChainKey, mode: "simple" | "pro", token?: string) => void }) {
  const ownerOf = useCallback((k: WChainKey) => (WCHAINS[k].kind === "solana" ? signer.sol?.address : signer.evm?.address) ?? null, [signer.sol?.address, signer.evm?.address]);
  const chains = WCHAIN_LIST.filter((c) => ownerOf(c.key));
  const [bal, setBal] = useState<Partial<Record<WChainKey, Holding[] | "error">>>({});
  const [logos, setLogos] = useState<Record<number, string>>({});
  const [only, setOnly] = useState<WChainKey | null>(null);
  const [hide, setHide] = useState(false);
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [copied, setCopied] = useState("");

  const load = useCallback(() => {
    for (const c of chains) {
      const owner = ownerOf(c.key)!;
      api<{ holdings: Holding[] }>("balances", { chain: c.key, owner, extra: store.get<WToken[]>(`aw-tokens-${c.key}`, []).map((t) => t.address) })
        .then((d) => setBal((b) => ({ ...b, [c.key]: d.holdings })))
        .catch(() => setBal((b) => ({ ...b, [c.key]: "error" })));
    }
  }, [chains.map((c) => c.key).join(), ownerOf]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api<{ logos: Record<number, string> }>("x-chains", {}).then((d) => setLogos(d.logos)).catch(() => {}); setHide(store.get("aw-hide", false)); }, []);

  const rows: Row[] = useMemo(() => chains.flatMap((c) => {
    const h = bal[c.key];
    return Array.isArray(h) ? h.filter((x) => x.amount > 0).map((x) => ({ ...x, chain: c.key })) : [];
  }).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0)), [bal, chains]);
  const chainTotal = (k: WChainKey) => { const h = bal[k]; return Array.isArray(h) ? h.reduce((s, x) => s + (x.valueUsd || 0), 0) : null; };
  const loaded = chains.every((c) => bal[c.key]);
  const total = chains.reduce((s, c) => s + (chainTotal(c.key) || 0), 0);
  const shown = only ? rows.filter((r) => r.chain === only) : rows;
  const money = (v: number | null | undefined) => (hide ? "••••" : usd(v));
  const copy = (a: string) => { navigator.clipboard?.writeText(a); setCopied(a); setTimeout(() => setCopied(""), 1500); };
  const defaultChain: WChainKey = only ?? rows[0]?.chain ?? (chains[0]?.key || "bsc");

  return (
    <div className="pf">
      <section className="pf-hero">
        <div className="pf-hero-top">
          <small>{signer.using === "external" ? "Your wallet" : "AUTISTIK wallet"} · total balance</small>
          <button type="button" className="pf-eye" onClick={() => { setHide(!hide); store.set("aw-hide", !hide); }} aria-pressed={hide} aria-label={hide ? "Show balances" : "Hide balances"}>{hide ? "Show" : "Hide"}</button>
        </div>
        <div className="pf-total">{loaded ? money(total) : <span className="pf-skel" />}</div>
        <div className="pf-addrs">
          {signer.evm && <button type="button" className="pf-addr" onClick={() => copy(signer.evm!.address)} title="Copy your EVM address"><span className="pf-dot evm" />EVM {short(signer.evm.address)}<b>{copied === signer.evm.address ? "Copied" : "Copy"}</b></button>}
          {signer.sol && <button type="button" className="pf-addr" onClick={() => copy(signer.sol!.address)} title="Copy your Solana address"><span className="pf-dot sol" />Solana {short(signer.sol.address)}<b>{copied === signer.sol.address ? "Copied" : "Copy"}</b></button>}
        </div>
        <div className="pf-acts">
          <Act icon="↓" label="Receive" onClick={() => setSheet({ kind: "receive", chain: defaultChain })} />
          <Act icon="↑" label="Send" onClick={() => setSheet({ kind: "send", chain: defaultChain })} />
          <Act icon="+" label="Buy" onClick={() => onTrade(only ?? "bsc", "simple")} />
          <Link href="/swap" className="pf-act"><span>⇄</span>Swap</Link>
          <Act icon="◷" label="History" onClick={() => setSheet({ kind: "history" })} />
        </div>
      </section>

      <section className="pf-nets" aria-label="Networks">
        <button type="button" className={"pf-net all" + (!only ? " on" : "")} onClick={() => setOnly(null)}>
          <span className="pf-net-name">All networks</span><b>{loaded ? money(total) : "…"}</b><small>{chains.length} networks</small>
        </button>
        {chains.map((c) => {
          const h = bal[c.key]; const nat = Array.isArray(h) ? h.find((x) => isNative(c, x.address)) : null;
          return (
            <button key={c.key} type="button" className={"pf-net" + (only === c.key ? " on" : "")} style={{ ["--net" as any]: CHAIN_COLOR[c.key] }} onClick={() => setOnly(only === c.key ? null : c.key)}>
              <span className="pf-net-name"><ChainBadge c={xOf(c.key)} logo={logos[xOf(c.key).id]} size={22} />{c.name}</span>
              <b>{h === "error" ? "–" : h ? money(chainTotal(c.key)) : "…"}</b>
              <small>{h === "error" ? "Couldn't load" : nat ? `${hide ? "••" : amt(nat.amount)} ${c.native.symbol}` : `0 ${c.native.symbol}`}</small>
            </button>
          );
        })}
      </section>

      <section className="pf-assets">
        <div className="pf-assets-head"><b>{only ? `Assets on ${WCHAINS[only].name}` : "Your assets"}</b><button type="button" className="aw-link" onClick={load}>Refresh</button></div>
        {!loaded && !rows.length && [0, 1, 2].map((i) => <div key={i} className="pf-row skel"><span className="pf-skel round" /><span className="pf-skel" /></div>)}
        {loaded && !shown.length && (
          <div className="pf-empty">
            <b>{only ? `Nothing on ${WCHAINS[only].name} yet` : "Your wallet is empty"}</b>
            <p>Add money to start: buy {only ? WCHAINS[only].native.symbol : "BNB, ETH or SOL"} on an exchange like Binance and withdraw it to your address, then buy any coin here.</p>
            <button type="button" className="tx-cta" onClick={() => setSheet({ kind: "receive", chain: defaultChain })}>Add money</button>
          </div>
        )}
        {shown.map((r) => (
          <button key={r.chain + r.address} type="button" className="pf-row" onClick={() => setSheet({ kind: "asset", row: r })}>
            <span className="pf-logo"><Logo t={r} size={38} /><ChainBadge c={xOf(r.chain)} logo={logos[xOf(r.chain).id]} size={16} /></span>
            <span className="grow"><b>{r.symbol}</b><small>{WCHAINS[r.chain].name}{r.priceUsd ? ` · ${usd(r.priceUsd)}` : ""}</small></span>
            <span className="pf-num"><b>{money(r.valueUsd)}</b><small>{hide ? "••" : amt(r.amount)} {r.symbol}</small></span>
          </button>
        ))}
      </section>

      {sheet && (
        <div className="aw-sheet" role="dialog" aria-label="Wallet" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="aw-sheet-in pf-sheet">
            {sheet.kind === "asset" ? <AssetSheet r={sheet.row} hide={hide} logos={logos} onClose={() => setSheet(null)}
              onSend={() => setSheet({ kind: "send", chain: sheet.row.chain, token: sheet.row.address })} onReceive={() => setSheet({ kind: "receive", chain: sheet.row.chain })}
              onTrade={(m) => { setSheet(null); onTrade(sheet.row.chain, m, sheet.row.address); }} /> : (
              <>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>{sheet.kind === "receive" ? "Receive / add money" : sheet.kind === "send" ? "Send / withdraw" : "History"}</b>
                  <button type="button" className="btn small" onClick={() => setSheet(null)}>Close</button>
                </div>
                {sheet.kind !== "history" && (
                  <div className="pf-tabs" role="tablist" aria-label="Network">
                    {chains.map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={sheet.chain === c.key} className={sheet.chain === c.key ? "on" : ""} style={{ ["--net" as any]: CHAIN_COLOR[c.key] }} onClick={() => setSheet({ kind: sheet.kind, chain: c.key })}>
                        <ChainBadge c={xOf(c.key)} logo={logos[xOf(c.key).id]} size={18} />{c.short}
                      </button>
                    ))}
                  </div>
                )}
                <div className="pf-sheet-body">
                  {sheet.kind === "receive" && <Receive c={WCHAINS[sheet.chain]} address={ownerOf(sheet.chain)!} />}
                  {sheet.kind === "send" && (Array.isArray(bal[sheet.chain])
                    ? <Send key={sheet.chain + (sheet.token || "")} c={WCHAINS[sheet.chain]} signer={signer} owner={ownerOf(sheet.chain)!} holdings={bal[sheet.chain] as Holding[]} start={sheet.token} onDone={load} />
                    : <div className="tx-dim">Loading balances…</div>)}
                  {sheet.kind === "history" && <History />}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Act({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <button type="button" className="pf-act" onClick={onClick}><span aria-hidden="true">{icon}</span>{label}</button>;
}

function AssetSheet({ r, hide, logos, onClose, onSend, onReceive, onTrade }: {
  r: Row; hide: boolean; logos: Record<number, string>; onClose: () => void; onSend: () => void; onReceive: () => void; onTrade: (m: "simple" | "pro") => void;
}) {
  const c = WCHAINS[r.chain];
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 10 }}><span className="pf-logo"><Logo t={r} size={40} /><ChainBadge c={xOf(r.chain)} logo={logos[xOf(r.chain).id]} size={16} /></span><span><b>{r.symbol}</b><br /><small className="tx-dim">{r.name} · {c.name}</small></span></span>
        <button type="button" className="btn small" onClick={onClose}>Close</button>
      </div>
      <div className="pf-asset-val"><b>{hide ? "••••" : usd(r.valueUsd)}</b><small>{hide ? "••" : amt(r.amount)} {r.symbol}{r.priceUsd ? ` · ${usd(r.priceUsd)} each` : ""}</small></div>
      <div className="pf-acts">
        <button type="button" className="pf-act" onClick={onSend}><span>↑</span>Send</button>
        <button type="button" className="pf-act" onClick={onReceive}><span>↓</span>Receive</button>
        <button type="button" className="pf-act" onClick={() => onTrade("simple")}><span>+</span>Buy</button>
        {!isNative(c, r.address) && <button type="button" className="pf-act" onClick={() => onTrade("simple")}><span>−</span>Sell</button>}
        <button type="button" className="pf-act" onClick={() => onTrade("pro")}><span>▤</span>Chart</button>
      </div>
      {!isNative(c, r.address) && <a className="aw-link" href={`${c.explorer}/token/${r.address}`} target="_blank" rel="noopener noreferrer">View on {c.kind === "solana" ? "Solscan" : "explorer"} ↗</a>}
    </>
  );
}
