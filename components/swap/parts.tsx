"use client";
import { useEffect, useRef, useState } from "react";
import { XCHAIN_LIST, type XChain, type XToken } from "@/lib/bridge-chains";
import { amt, api, Logo } from "@/components/wallet/util";

/** A network's logo, or a badge in its own color when the logo can't load. */
export function ChainBadge({ c, logo, size = 22 }: { c: XChain; logo?: string; size?: number }) {
  const [bad, setBad] = useState(false);
  if (logo && !bad) return <img className="sx-chain-logo" src={logo} alt="" width={size} height={size} onError={() => setBad(true)} />;
  return <span className="sx-chain-logo ph" style={{ width: size, height: size, background: c.color, fontSize: size * 0.42 }} aria-hidden="true">{c.name.slice(0, 1)}</span>;
}

/** Pick a network: a searchable grid of every network the swap reaches. */
export function NetPicker({ label, value, onPick, logos, allow, tag, hint, compact }: {
  label: string; value: XChain; onPick: (c: XChain) => void; logos: Record<number, string>; allow?: (c: XChain) => string | null;
  /** A small badge by the label, e.g. "auto" when the network came from a pasted address. */
  tag?: string; hint?: string;
  /** A small chip (logo, name, ▾) that sits inside another row, instead of a card with its label. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <button type="button" className={"sx-chip" + (hint ? " ask" : "")} onClick={() => setOpen(true)} aria-label={`${label}: ${value.name}. Change network`}>
          <ChainBadge c={value} logo={logos[value.id]} size={20} /><b>{value.name}</b>{tag && <em className="sx-tag">{tag}</em>}{hint && <em className="sx-hint">{hint}</em>}<span aria-hidden="true" className="tx-caret">▾</span>
        </button>
      ) : (
        <button type="button" className={"sx-net" + (hint ? " ask" : "")} onClick={() => setOpen(true)} aria-label={`${label}: ${value.name}`}>
          <small>{label}{tag && <em className="sx-tag">{tag}</em>}{hint && <em className="sx-hint">{hint}</em>}</small>
          <span className="sx-net-in"><ChainBadge c={value} logo={logos[value.id]} size={24} /><b>{value.name}</b><span aria-hidden="true" className="tx-caret">▾</span></span>
        </button>
      )}
      {open && <NetGrid label={label} value={value} onPick={onPick} logos={logos} allow={allow} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The sheet behind the network picker: a searchable grid of every network the swap reaches. */
export function NetGrid({ label, value, onPick, logos, allow, onClose }: {
  label: string; value: XChain | null; onPick: (c: XChain) => void; logos: Record<number, string>; allow?: (c: XChain) => string | null; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const list = XCHAIN_LIST.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="aw-sheet" role="dialog" aria-label={`${label} network`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="aw-sheet-in sx-sheet">
        <div className="row" style={{ justifyContent: "space-between" }}><b>{label} network</b><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${XCHAIN_LIST.length} networks`} spellCheck={false} autoComplete="off" />
        <div className="sx-grid">
          {list.map((c) => { const why = allow?.(c) ?? null; return (
            <button key={c.id} type="button" className={"sx-grid-item" + (c.id === value?.id ? " on" : "")} disabled={!!why} title={why || c.name}
              onClick={() => { onPick(c); onClose(); }}>
              <ChainBadge c={c} logo={logos[c.id]} size={30} /><span>{c.name}</span>
            </button>
          ); })}
        </div>
        {!list.length && <small className="muted">No network called “{q}”.</small>}
      </div>
    </div>
  );
}

/** A coin's logo with its network's badge in the corner. */
export function TokenLogo({ t, c, logos, size = 32 }: { t: { symbol: string; logo?: string | null }; c: XChain; logos: Record<number, string>; size?: number }) {
  return <span className="sc-logo" style={{ width: size, height: size }}><Logo t={t} size={size} /><ChainBadge c={c} logo={logos[c.id]} size={Math.round(size * 0.44)} /></span>;
}

/** Pick a coin on any network: popular ones first, search by name, or paste an address. */
export function XTokenPicker({ c, value, onPick, label, balance }: {
  c: XChain; value: XToken | null; onPick: (t: XToken) => void; label: string; balance?: number | null;
}) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState("");
  const [list, setList] = useState<XToken[] | null>(null); const [err, setErr] = useState("");
  const seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const id = ++seq.current; setErr("");
    const t = setTimeout(() => {
      api<{ tokens: XToken[] }>("x-tokens", { chain: c.id, q }).then((d) => id === seq.current && setList(d.tokens)).catch((e) => id === seq.current && (setErr(e.message), setList([])));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [open, q, c.id]);
  useEffect(() => { setList(null); }, [c.id]);
  return (
    <>
      <button type="button" className="aw-pick" onClick={() => setOpen(true)} aria-label={label}>
        {value ? <><Logo t={value} size={24} /><b>{value.symbol}</b></> : <b>Select</b>}<span aria-hidden="true" className="tx-caret">▾</span>
      </button>
      {open && (
        <div className="aw-sheet" role="dialog" aria-label={label} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="aw-sheet-in">
            <div className="row" style={{ justifyContent: "space-between" }}><b>{label} on {c.name}</b><button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button></div>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or paste any token address" spellCheck={false} autoComplete="off" />
            {list == null && <small className="muted">Loading coins…</small>}
            {err && <small className="scan-err">{err}</small>}
            <div className="aw-list">
              {(list || []).map((t) => (
                <button key={t.address} type="button" className="aw-row" onClick={() => { onPick(t); setOpen(false); setQ(""); }}>
                  <Logo t={t} size={30} /><span className="grow"><b>{t.symbol}</b><small>{t.name}</small></span>
                  {value?.address === t.address && balance != null && balance > 0 && <span className="aw-num"><b>{amt(balance)}</b></span>}
                </button>
              ))}
              {list && !list.length && !err && <small className="muted">No coin found. Paste its address to add it.</small>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
