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
export function NetPicker({ label, value, onPick, logos, allow }: {
  label: string; value: XChain; onPick: (c: XChain) => void; logos: Record<number, string>; allow?: (c: XChain) => string | null;
}) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState("");
  const list = XCHAIN_LIST.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <button type="button" className="sx-net" onClick={() => setOpen(true)} aria-label={`${label}: ${value.name}`}>
        <small>{label}</small>
        <span className="sx-net-in"><ChainBadge c={value} logo={logos[value.id]} size={24} /><b>{value.name}</b><span aria-hidden="true" className="tx-caret">▾</span></span>
      </button>
      {open && (
        <div className="aw-sheet" role="dialog" aria-label={`${label} network`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="aw-sheet-in sx-sheet">
            <div className="row" style={{ justifyContent: "space-between" }}><b>{label} network</b><button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button></div>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${XCHAIN_LIST.length} networks`} spellCheck={false} autoComplete="off" />
            <div className="sx-grid">
              {list.map((c) => { const why = allow?.(c) ?? null; return (
                <button key={c.id} type="button" className={"sx-grid-item" + (c.id === value.id ? " on" : "")} disabled={!!why} title={why || c.name}
                  onClick={() => { onPick(c); setOpen(false); setQ(""); }}>
                  <ChainBadge c={c} logo={logos[c.id]} size={30} /><span>{c.name}</span>
                </button>
              ); })}
            </div>
            {!list.length && <small className="muted">No network called “{q}”.</small>}
          </div>
        </div>
      )}
    </>
  );
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
