"use client";
/**
 * Lockers page, Solana: lock any standard Solana token (LP tokens or team tokens) until a date, see your locks and
 * claim them when they end, and check any token's locks. Done entirely on the Hub; the tokens are held by Jupiter Lock
 * (free, open source, audited), set up so nobody can cancel a lock or take it early (lib/solana-jup-lock.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { useSolWallet } from "@/components/SolanaLaunch";
import { signAndSend, solErr } from "@/lib/sol-wallet";

type Info = { decimals: number; symbol: string; name: string; balance: string };
type Lock = { escrow: string; recipient: string; creator: string; mint: string; unlockAt: number; amount: string; claimed: string; strict: boolean };

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const DAY = 86_400;
const PRESETS: [string, number][] = [["1 month", 30 * DAY], ["3 months", 91 * DAY], ["6 months", 182 * DAY], ["1 year", 365 * DAY]];

async function api<T>(body: object): Promise<T> {
  const r = await fetch("/api/lockers/solana", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
  return d as T;
}
/** Base units → a readable number, and back, without floating-point mistakes. */
const fmt = (raw: string, dec: number) => {
  const s = raw.padStart(dec + 1, "0"), whole = s.slice(0, s.length - dec), frac = dec ? s.slice(-dec).replace(/0+$/, "") : "";
  return `${BigInt(whole).toLocaleString("en-US")}${frac ? "." + frac.slice(0, 6) : ""}`;
};
const toRaw = (v: string, dec: number) => {
  const m = v.trim().replace(/,/g, "").match(/^(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = (m[2] || "").slice(0, dec).padEnd(dec, "0");
  const raw = BigInt((m[1] || "0") + frac);
  return raw > 0n ? raw : null;
};
const dateText = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function SolanaLocker() {
  const { sw, picker } = useSolWallet();
  const owner = sw?.account.address ?? null;
  const [mint, setMint] = useState("");
  const [info, setInfo] = useState<Info | null>(null);
  const [amount, setAmount] = useState("");
  const [preset, setPreset] = useState(182 * DAY);
  const [custom, setCustom] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<{ escrow: string; sig: string } | null>(null);
  const [mine, setMine] = useState<Lock[] | null>(null);

  const loadMine = useCallback(() => {
    if (!owner) return;
    api<{ locks: Lock[] }>({ action: "list", owner }).then((d) => setMine(d.locks)).catch(() => setMine([]));
  }, [owner]);
  useEffect(() => { loadMine(); }, [loadMine]);

  useEffect(() => {
    setInfo(null); setDone(null);
    if (!owner || !SOL_ADDR.test(mint.trim())) return;
    let alive = true;
    api<Info>({ action: "info", owner, mint: mint.trim() }).then((d) => alive && setInfo(d)).catch((e) => alive && setMsg(e.message));
    return () => { alive = false; };
  }, [owner, mint]);

  const unlockAt = custom ? Math.floor(Date.parse(custom + "T00:00:00Z") / 1000) : Math.floor(Date.now() / 1000) + preset;
  const raw = info ? toRaw(amount, info.decimals) : null;
  const tooMuch = !!(info && raw && raw > BigInt(info.balance));
  const ready = !!(sw && info && raw && !tooMuch && agree && unlockAt > Date.now() / 1000 + 3600);

  async function lock() {
    if (!sw || !info || !raw) return;
    setBusy(true); setMsg("Confirm the lock in your wallet…");
    try {
      const r = await api<{ tx: string; escrow: string }>({ action: "lock", owner: sw.account.address, mint: mint.trim(), amount: raw.toString(), unlockAt });
      const sig = await signAndSend(sw, r.tx);
      setDone({ escrow: r.escrow, sig }); setMsg(""); setAmount(""); setAgree(false);
      setTimeout(loadMine, 4000);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  async function claim(l: Lock) {
    if (!sw) return;
    setBusy(true); setMsg("Confirm the claim in your wallet…");
    try {
      const r = await api<{ tx: string }>({ action: "claim", owner: sw.account.address, escrow: l.escrow });
      await signAndSend(sw, r.tx);
      setMsg("✅ Claimed: the tokens are back in your wallet."); setTimeout(loadMine, 4000);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  return (
    <div className="card stack" id="solana" style={{ gap: 12, scrollMarginTop: 80 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ margin: 0 }}>🔒 Lock on Solana</h2>
        <span className="chip-flag ok">Free · no cancel · no early release</span>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".92em" }}>
        Lock LP tokens or team tokens until a date. Nobody can cancel the lock or take the tokens early, including you and the AUTISTIK team. After the date only your wallet can claim them. The tokens are held by <a href="https://lock.jup.ag" target="_blank" rel="noopener noreferrer">Jupiter Lock</a> (open source, audited), and it costs only Solana&apos;s small account fee.
      </p>
      {picker(busy, setMsg)}

      {sw && (
        <div className="stack" style={{ gap: 10 }}>
          <label className="field"><span>Token or LP token address</span>
            <input value={mint} onChange={(e) => setMint(e.target.value.trim())} placeholder="e.g. your pool's LP mint, or your token" spellCheck={false} />
          </label>
          {info && <small className="muted">{info.symbol ? <b>${info.symbol}</b> : "Token"}{info.name ? ` · ${info.name}` : ""} · you hold <b>{fmt(info.balance, info.decimals)}</b></small>}
          {info && (
            <>
              <label className="field"><span>Amount to lock</span>
                <div className="row" style={{ gap: 6 }}>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" style={{ flex: 1, minWidth: 0 }} />
                  <button type="button" className="btn small" onClick={() => setAmount(fmt(info.balance, info.decimals).replace(/,/g, ""))}>Max</button>
                </div>
              </label>
              {tooMuch && <small style={{ color: "var(--coral)" }}>That&apos;s more than this wallet holds.</small>}
              <fieldset className="lock-pick">
                <legend>Unlock after</legend>
                {PRESETS.map(([label, s]) => (
                  <label key={label}><input type="radio" name="sol-lock" checked={!custom && preset === s} onChange={() => { setCustom(""); setPreset(s); }} /> {label}</label>
                ))}
                <label><input type="radio" name="sol-lock" checked={!!custom} onChange={() => setCustom(new Date(Date.now() + 730 * DAY * 1000).toISOString().slice(0, 10))} /> Pick a date</label>
              </fieldset>
              {custom && <input type="date" value={custom} min={new Date(Date.now() + DAY * 1000).toISOString().slice(0, 10)} onChange={(e) => setCustom(e.target.value)} aria-label="Unlock date" />}
              <div className="notice warn" style={{ fontSize: ".88em" }}>
                Unlocks on <b>{dateText(unlockAt)}</b>. Until then nobody can move these tokens. This can&apos;t be undone.
              </div>
              <label className="row" style={{ gap: 8, alignItems: "flex-start", flexWrap: "nowrap", fontSize: ".9em" }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>I understand these tokens are locked until {dateText(unlockAt)} and can&apos;t be taken out early by anyone, including me.</span>
              </label>
              <button className="btn primary" type="button" disabled={!ready || busy} onClick={lock}>{busy ? "Working…" : `Lock ${amount || "0"} ${info.symbol || "tokens"}`}</button>
            </>
          )}
          {done && (
            <div className="notice" style={{ fontSize: ".9em" }}>
              ✅ Locked. <a href={`https://solscan.io/account/${done.escrow}`} target="_blank" rel="noopener noreferrer">See the lock on Solscan</a> · <a href={`https://solscan.io/tx/${done.sig}`} target="_blank" rel="noopener noreferrer">Transaction</a>
            </div>
          )}
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}

      {sw && (
        <div className="stack" style={{ gap: 6 }}>
          <b>Your Solana locks</b>
          {mine === null ? <small className="muted">Loading…</small> : mine.length === 0 ? <small className="muted">No locks yet.</small> : (
            <LockList locks={mine} onClaim={claim} busy={busy} me={owner} />
          )}
        </div>
      )}

      <CheckSolana />
    </div>
  );
}

function LockList({ locks, onClaim, busy, me }: { locks: Lock[]; onClaim?: (l: Lock) => void; busy?: boolean; me?: string | null }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {locks.map((l) => {
        const ended = l.unlockAt * 1000 <= Date.now();
        const left = BigInt(l.amount) - BigInt(l.claimed);
        return (
          <div key={l.escrow} className="row" style={{ gap: 8, justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 12, fontSize: ".9em" }}>
            <span style={{ minWidth: 0 }}>
              <b className="mono">{short(l.mint)}</b> · {left > 0n ? (ended ? "🔓 ended " : "🔒 until ") : "✓ claimed · ended "}{dateText(l.unlockAt)}
              {!l.strict && <span className="muted"> · can be cancelled</span>}
              <br /><a className="muted" href={`https://solscan.io/account/${l.escrow}`} target="_blank" rel="noopener noreferrer">View on Solscan</a>
            </span>
            {onClaim && me === l.recipient && ended && left > 0n && <button className="btn small primary" type="button" disabled={busy} onClick={() => onClaim(l)}>Claim</button>}
          </div>
        );
      })}
    </div>
  );
}

/** Anyone can check a Solana token's locks (no wallet needed). */
function CheckSolana() {
  const [q, setQ] = useState("");
  const [locks, setLocks] = useState<Lock[] | null>(null);
  const [err, setErr] = useState("");
  async function check(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLocks(null);
    if (!SOL_ADDR.test(q.trim())) { setErr("That isn't a Solana address."); return; }
    try { setLocks((await api<{ locks: Lock[] }>({ action: "list", mint: q.trim() })).locks); } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <b>Check a Solana token&apos;s locks</b>
      <form className="row" style={{ gap: 8, flexWrap: "wrap" }} onSubmit={check}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Token or LP mint address" spellCheck={false} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn primary" type="submit">Check</button>
      </form>
      {err && <small style={{ color: "var(--coral)" }}>{err}</small>}
      {locks && (locks.length ? <LockList locks={locks} /> : <small className="muted">No Jupiter Lock locks found for this token.</small>)}
    </div>
  );
}
