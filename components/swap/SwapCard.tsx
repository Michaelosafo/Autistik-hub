"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WCHAINS, type WChainKey } from "@/lib/wallet-chains";
import { XCHAIN_BY_KEY, XCHAIN_LIST, XCHAINS, isXNative, xNative, type XChain, type XToken } from "@/lib/bridge-chains";
import { amt, api, store, usd, type Holding } from "@/components/wallet/util";
import { ChainBadge, NetGrid, TokenLogo } from "./parts";

/** What a swap form hands the card: the amount being typed, the balance, and the price it found. */
export type CardIO = {
  amount: string; setAmount: (s: string) => void;
  balance: number | null; onMax: (() => void) | null;
  inUsd: number | null; out: ReactNode; outUsd: number | null;
  /** Under the "get" coin, e.g. where a cross-chain swap pays out. */
  toExtra?: ReactNode;
};
export type Side = "from" | "to";
export type Pick = { net: XChain; token: XToken | null };
export type Owners = { evm?: string | null; sol?: string | null };

/** The Wallet writes a chain's own coin as 0xEeee… or wSOL; the swap uses LI.FI's way. */
export const toX = (net: XChain, t: XToken): XToken => (isXNative(net, t.address) ? { ...t, address: xNative(net) } : t);
const same = (a: XToken | null, b: XToken | null) => !!a && !!b && a.address.toLowerCase() === b.address.toLowerCase();
const ownerOn = (net: XChain, o: Owners) => (net.kind === "solana" ? o.sol : o.evm) || null;
const money = (v: number | null | undefined) => (v && v > 0 ? usd(v) : "$0.00");

const Chevron = ({ up }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </svg>
);

/**
 * The swap card: the coin you pay with and how much, a round button to switch the two, and the coin you get.
 * Tapping a coin opens the token sheet, where the network is picked too.
 */
export function SwapPanels({ io, from, to, logos, owners, allow, onPick, onFlip }: {
  io: CardIO; from: Pick; to: Pick; logos: Record<number, string>; owners: Owners;
  allow?: (c: XChain) => string | null; onPick: (side: Side, net: XChain, token: XToken) => void; onFlip: () => void;
}) {
  const [sheet, setSheet] = useState<Side | null>(null);
  const len = io.amount.length;
  const pill = (side: Side, p: Pick) => (
    <button type="button" className="sc-pill" onClick={() => setSheet(side)} aria-label={side === "from" ? "Pick the coin you pay with" : "Pick the coin you get"}>
      {p.token ? <TokenLogo t={p.token} c={p.net} logos={logos} size={30} /> : <ChainBadge c={p.net} logo={logos[p.net.id]} size={30} />}
      <b>{p.token?.symbol || "Select"}</b><Chevron />
    </button>
  );
  return (
    <div className="sc">
      <div className="sc-box">
        <div className="sc-top">
          {pill("from", from)}
          {io.balance != null && <span className="sc-have">
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v3H6.5a.5.5 0 0 0 0 1H20v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A2.5 2.5 0 0 1 4 17.5zM16 13a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 16 13" /></svg>
            {amt(io.balance)}
            {io.onMax && <button type="button" className="sc-max" onClick={io.onMax}>Max</button>}
          </span>}
        </div>
        <input className="sc-amt" inputMode="decimal" value={io.amount} placeholder="0" aria-label="Amount to pay" autoComplete="off"
          style={len > 9 ? { fontSize: len > 14 ? "1.6em" : "2.1em" } : undefined}
          onChange={(e) => io.setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} />
        <div className="sc-usd"><span aria-hidden="true">⇅</span> {money(io.inUsd)}</div>
      </div>
      <button type="button" className="sc-flip" onClick={onFlip} aria-label="Switch the two coins">
        <span><Chevron up /><Chevron /></span>
      </button>
      <div className="sc-box sc-get">
        <div className="sc-top">
          {pill("to", to)}
          <span className="sc-out"><b>{io.out}</b>{io.outUsd ? <small>{usd(io.outUsd)}</small> : null}</span>
        </div>
        {io.toExtra}
      </div>
      {sheet && (
        <TokenSheet side={sheet} current={sheet === "from" ? from : to} logos={logos} owners={owners} allow={sheet === "from" ? allow : undefined}
          onPick={(net, t) => { onPick(sheet, net, t); setSheet(null); }} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

type Row = { net: XChain; token: XToken; amount: number | null; value: number | null };
const rowKey = (r: { net: XChain; token: XToken }) => `${r.net.id}:${r.token.address.toLowerCase()}`;
type Fav = { chain: number; token: XToken };

/** What a wallet holds on each of the Wallet's networks, kept for a minute so the sheet opens fast. */
const HELD: Record<string, { at: number; list: Holding[] }> = {};
async function holdings(k: WChainKey, owner: string): Promise<Holding[]> {
  const id = `${k}:${owner}`, hit = HELD[id];
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  const extra = store.get<XToken[]>(`aw-tokens-${k}`, []).map((t) => t.address);
  const { holdings: list } = await api<{ holdings: Holding[] }>("balances", { chain: k, owner, extra });
  HELD[id] = { at: Date.now(), list };
  return list;
}

const WKEYS = Object.keys(WCHAINS) as WChainKey[];
const QUICK = ["bsc", "ethereum", "solana", "base", "arbitrum"].map((k) => XCHAIN_BY_KEY[k]);
const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);

/**
 * Pick a coin: search by name or paste a contract address, narrow to favourites, all networks or one network, and
 * see what you hold. Every coin shows its network's badge.
 */
export function TokenSheet({ side, current, logos, owners, allow, onPick, onClose }: {
  side: Side; current: Pick; logos: Record<number, string>; owners: Owners; allow?: (c: XChain) => string | null;
  onPick: (net: XChain, t: XToken) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<"fav" | "all" | number>(current.net.id);
  const [q, setQ] = useState("");
  const [grid, setGrid] = useState(false);
  const [held, setHeld] = useState<Partial<Record<WChainKey, Holding[]>>>({});
  const [list, setList] = useState<XToken[] | null>(null);
  const [found, setFound] = useState<{ row: Row | null; err: string } | null>(null);
  const [favs, setFavs] = useState<Fav[]>(() => store.get<Fav[]>("sx-favs", []));
  const net = typeof tab === "number" ? XCHAINS[tab] : null;
  const query = q.trim();

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Balances: the open network's, or every Wallet network's for "All" and favourites.
  useEffect(() => {
    const keys = net ? (net.wchain ? [net.wchain] : []) : WKEYS;
    for (const k of keys) {
      const o = ownerOn(XCHAIN_BY_KEY[k], owners);
      if (o && !held[k]) holdings(k, o).then((l) => setHeld((h) => ({ ...h, [k]: l }))).catch(() => setHeld((h) => ({ ...h, [k]: [] })));
    }
  }, [net?.id, owners.evm, owners.sol]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coins on the open network, searched on the server.
  const seq = useRef(0);
  useEffect(() => {
    if (!net || isAddr(query)) return;
    const id = ++seq.current; setList(null);
    const t = setTimeout(() => {
      api<{ tokens: XToken[] }>("x-tokens", { chain: net.id, q: query }).then((d) => id === seq.current && setList(d.tokens)).catch(() => id === seq.current && setList([]));
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [net?.id, query]); // eslint-disable-line react-hooks/exhaustive-deps

  // A pasted contract address: find which network it lives on.
  useEffect(() => {
    setFound(null);
    if (!isAddr(query)) return;
    const id = ++seq.current;
    api<{ chain: number; token: XToken }>("x-detect", { address: query })
      .then((d) => id === seq.current && setFound({ row: { net: XCHAINS[d.chain], token: d.token, amount: null, value: null }, err: "" }))
      .catch((e) => id === seq.current && setFound({ row: null, err: e.message }));
  }, [query]);

  const heldRows = (n: XChain): Row[] => (n.wchain ? held[n.wchain] || [] : [])
    .filter((h) => h.amount > 0).map((h) => ({ net: n, token: toX(n, h), amount: h.amount, value: h.valueUsd }));
  const balanceIn = (n: XChain, t: XToken): { amount: number | null; value: number | null } => {
    const h = n.wchain && held[n.wchain]?.find((x) => same(toX(n, x), t));
    if (h) return { amount: h.amount, value: h.valueUsd };
    return n.wchain && held[n.wchain] && ownerOn(n, owners) ? { amount: 0, value: 0 } : { amount: null, value: null };
  };
  const match = (t: XToken) => !query || t.symbol.toLowerCase().includes(query.toLowerCase()) || t.name.toLowerCase().includes(query.toLowerCase());

  const rows: Row[] = useMemo(() => {
    let out: Row[];
    if (isAddr(query)) out = found?.row ? [{ ...found.row, ...balanceIn(found.row.net, found.row.token) }] : [];
    else if (tab === "fav") out = favs.filter((f) => XCHAINS[f.chain] && match(f.token)).map((f) => ({ net: XCHAINS[f.chain], token: f.token, ...balanceIn(XCHAINS[f.chain], f.token) }));
    else if (tab === "all") {
      const mine = WKEYS.flatMap((k) => heldRows(XCHAIN_BY_KEY[k])).sort((a, b) => (b.value || 0) - (a.value || 0));
      const popular = WKEYS.flatMap((k) => { const n = XCHAIN_BY_KEY[k]; return [WCHAINS[k].native, ...WCHAINS[k].tokens].map((t) => ({ net: n, token: toX(n, t), ...balanceIn(n, toX(n, t)) })); });
      out = [...mine, ...popular].filter((r) => match(r.token));
    } else {
      const n = net!;
      const mine = heldRows(n).sort((a, b) => (b.value || 0) - (a.value || 0)).filter((r) => match(r.token));
      out = [...mine, ...(list || []).map((t) => ({ net: n, token: t, ...balanceIn(n, t) }))];
    }
    const seen = new Set<string>();
    return out.filter((r) => !seen.has(rowKey(r)) && !!seen.add(rowKey(r)));
  }, [tab, query, found, favs, held, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const favSet = new Set(favs.map((f) => `${f.chain}:${f.token.address.toLowerCase()}`));
  function star(r: Row) {
    const k = rowKey(r);
    const next = favSet.has(k) ? favs.filter((f) => `${f.chain}:${f.token.address.toLowerCase()}` !== k)
      : [...favs, { chain: r.net.id, token: { address: r.token.address, symbol: r.token.symbol, name: r.token.name, decimals: r.token.decimals, logo: r.token.logo } }].slice(-40);
    setFavs(next); store.set("sx-favs", next);
  }
  async function paste() {
    try { const t = (await navigator.clipboard.readText()).trim(); if (t) setQ(t.slice(0, 64)); } catch { /* no clipboard permission */ }
  }

  // The chips: favourites, all, the open network with its name, one more, then every other network.
  const chipNets = [...(net ? [net] : []), ...QUICK.filter((n) => n.id !== net?.id)].slice(0, 2);
  const loading = isAddr(query) ? !found : typeof tab === "number" && list == null;
  return (
    <div className="aw-sheet sc-sheet" role="dialog" aria-label={side === "from" ? "Pick the coin you pay with" : "Pick the coin you get"} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-sheet-in sc-sheet-in">
        <button type="button" className="sc-grab" onClick={onClose} aria-label="Close"><span /></button>
        <label className="sc-search">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Token name or contract" spellCheck={false} autoComplete="off" aria-label="Search by token name or paste a contract address" />
          {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear">×</button>
            : <button type="button" onClick={paste} aria-label="Paste a contract address" title="Paste">
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 4.5H6.5a2 2 0 0 0-2 2V16" /></svg>
              </button>}
        </label>
        <div className="sc-chips" role="tablist" aria-label="Networks">
          <button type="button" role="tab" aria-selected={tab === "fav"} className={"sc-chip" + (tab === "fav" ? " on" : "")} onClick={() => setTab("fav")} aria-label="Favourites" title="Favourites">
            <span className="sc-star-ico" aria-hidden="true">★</span>{tab === "fav" && <b>Favourites</b>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "all"} className={"sc-chip" + (tab === "all" ? " on" : "")} onClick={() => setTab("all")} aria-label="All networks" title="All networks">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" /></svg>
            {tab === "all" && <b>All</b>}
          </button>
          {chipNets.map((n) => { const why = allow?.(n) ?? null; const on = tab === n.id; return (
            <button key={n.id} type="button" role="tab" aria-selected={on} className={"sc-chip" + (on ? " on" : "")} disabled={!!why} title={why || n.name} aria-label={n.name} onClick={() => setTab(n.id)}>
              <ChainBadge c={n} logo={logos[n.id]} size={24} />{on && <b>{n.name}</b>}
            </button>
          ); })}
          <button type="button" className="sc-chip sc-more" onClick={() => setGrid(true)} aria-label="More networks">{XCHAIN_LIST.length - chipNets.length}+</button>
        </div>
        <div className="sc-list-head"><span>Token</span><span>Balance</span></div>
        <div className="sc-list">
          {rows.map((r) => { const why = allow?.(r.net) ?? null; const on = r.net.id === current.net.id && same(r.token, current.token); const fav = favSet.has(rowKey(r)); return (
            <div key={rowKey(r)} className={"sc-row" + (on ? " on" : "")}>
              <button type="button" className="sc-row-main" disabled={!!why} title={why || undefined} onClick={() => onPick(r.net, r.token)}>
                <TokenLogo t={r.token} c={r.net} logos={logos} size={40} />
                <span className="sc-row-name"><b>{r.token.symbol}</b><small>{tab === "all" || tab === "fav" || isAddr(query) ? r.net.name : r.token.name}</small></span>
                {r.amount != null && <span className="sc-row-bal"><b>{amt(r.amount)}</b><small>{money(r.value)}</small></span>}
              </button>
              <button type="button" className={"sc-fav" + (fav ? " on" : "")} onClick={() => star(r)} aria-pressed={fav} aria-label={fav ? `Remove ${r.token.symbol} from favourites` : `Add ${r.token.symbol} to favourites`}>{fav ? "★" : "☆"}</button>
            </div>
          ); })}
          {loading && <div className="sc-empty"><span className="aw-spin" /> {isAddr(query) ? "Finding this coin on every network…" : "Loading coins…"}</div>}
          {!loading && !rows.length && (
            <div className="sc-empty">{found?.err || (tab === "fav" && !query ? "Tap ☆ on any coin to keep it here." : "No coin found. Paste its contract address to add it.")}</div>
          )}
        </div>
      </div>
      {grid && <NetGrid label={side === "from" ? "Pay on" : "Get on"} value={net} logos={logos} allow={allow} onPick={(n) => setTab(n.id)} onClose={() => setGrid(false)} />}
    </div>
  );
}
