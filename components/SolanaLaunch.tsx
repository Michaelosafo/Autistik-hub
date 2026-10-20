"use client";
import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import type { Wallet } from "@wallet-standard/base";
import { CHAINS, SOL_POOL_COST, type LaunchPlan } from "@/lib/launchpad";
import { connectSol, signAndSend, solErr, solLaunchApi, solWallets, type SolWallet } from "@/lib/sol-wallet";

const c = CHAINS.solana;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** Connect a Solana wallet: one button per wallet found on this device. */
function useSolWallet() {
  const [sw, setSw] = useState<SolWallet | null>(null);
  const [found, setFound] = useState<Wallet[]>([]);
  useEffect(() => { setFound(solWallets()); const t = setTimeout(() => setFound(solWallets()), 800); return () => clearTimeout(t); }, []);
  const picker = (busy: boolean, onErr: (m: string) => void) => sw ? (
    <small className="muted">Wallet: <span className="mono">{short(sw.account.address)}</span> ({sw.wallet.name})</small>
  ) : found.length ? (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      {found.map((w) => (
        <button key={w.name} type="button" className="btn small" disabled={busy} onClick={() => connectSol(w).then(setSw).catch((e) => onErr(solErr(e)))}>
          {w.icon && <img src={w.icon} alt="" width={16} height={16} style={{ verticalAlign: "middle", marginRight: 6 }} />}Connect {w.name}
        </button>
      ))}
    </div>
  ) : (
    <div className="notice warn" style={{ fontSize: ".88em" }}>No Solana wallet found on this device. Install <a href="https://phantom.com/download" target="_blank" rel="noopener noreferrer">Phantom</a> or Solflare, or open this page inside your wallet app&apos;s browser.</div>
  );
  return { sw, picker };
}

type Step = "token" | "pool" | "burn" | "list";
const STEPS: Record<Step, string> = { token: "Create the token", pool: "Create the Raydium pool", burn: "Burn the LP tokens", list: "Add it to the Hub" };

/** The Solana launch: three signatures (token, pool, burn), each step resumable if one fails. */
export function SolanaLaunch({ plan, agree, onDone }: { plan: LaunchPlan; agree: boolean; onDone: (d: { token: string; pair: string; hash: string; listed: boolean }) => void }) {
  const { sw, picker } = useSolWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mint, setMint] = useState<{ mint: string; sig: string } | null>(null);
  const [pool, setPool] = useState<{ pool: string; lpMint: string } | null>(null);
  const [burned, setBurned] = useState(false);
  const step: Step = !mint ? "token" : !pool ? "pool" : !burned ? "burn" : "list";

  async function next() {
    if (!sw) return;
    setBusy(true);
    const owner = sw.account.address;
    try {
      if (step === "token") {
        setMsg("Step 1 of 3: confirm the new token in your wallet…");
        const r = await solLaunchApi<{ tx: string; mint: string }>("mint", { owner, plan });
        const sig = await signAndSend(sw, r.tx);
        setMint({ mint: r.mint, sig });
        setMsg("✅ Token created. Next: the pool.");
      } else if (step === "pool") {
        setMsg("Step 2 of 3: confirm the Raydium pool in your wallet…");
        const r = await solLaunchApi<{ tx: string; pool: string; lpMint: string }>("pool", { owner, plan, mint: mint!.mint });
        await signAndSend(sw, r.tx);
        setPool({ pool: r.pool, lpMint: r.lpMint });
        setMsg("✅ Pool created. Last step: burn the LP tokens.");
      } else if (step === "burn") {
        setMsg("Step 3 of 3: confirm the burn in your wallet…");
        const r = await solLaunchApi<{ tx: string }>("burn", { owner, lpMint: pool!.lpMint });
        await signAndSend(sw, r.tx);
        setBurned(true);
      }
      if (step === "burn" || step === "list") {
        setMsg("Adding it to the Hub…");
        const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", token: mint!.mint, pair: pool!.pool, txHash: mint!.sig }) });
        onDone({ token: mint!.mint, pair: pool!.pool, hash: mint!.sig, listed: res.ok });
        setMsg("");
      }
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {picker(busy, setMsg)}
      <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: ".88em" }}>
        {(Object.keys(STEPS) as Step[]).map((k) => <li key={k} style={{ fontWeight: k === step ? 700 : 400 }}>{STEPS[k]}{k === "token" && mint ? " ✓" : k === "pool" && pool ? " ✓" : k === "burn" && burned ? " ✓" : ""}</li>)}
      </ol>
      {mint && <small className="muted">Token: <a href={`${c.explorer}/token/${mint.mint}`} target="_blank" rel="noopener noreferrer" className="mono">{short(mint.mint)}</a></small>}
      <button className="btn primary" type="button" disabled={!sw || !agree || busy} onClick={next}>
        {busy ? "Working…" : step === "token" ? `Launch for ${plan.liquidity} SOL + about ${SOL_POOL_COST} SOL in fees` : `Continue: ${STEPS[step].toLowerCase()}`}
      </button>
      {msg && <span className="muted" style={{ fontSize: ".88em" }}>{msg}</span>}
    </div>
  );
}

type Pool = { pool: string; lpMint: string; symbol: string; decimals: number; tokenReserve: string; solReserve: string };

/** Add liquidity to any Raydium CPMM pool paired with SOL, then burn the LP tokens or keep them. */
export function SolAddLiquidity({ mint: fixedMint, pool: fixedPool }: { mint?: string; pool?: string }) {
  const { sw, picker } = useSolWallet();
  const [mintIn, setMintIn] = useState(fixedMint ?? "");
  const [pool, setPool] = useState<Pool | null>(null);
  const [amtSol, setAmtSol] = useState("");
  const [amtTok, setAmtTok] = useState("");
  const [last, setLast] = useState<"sol" | "token">("sol");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [lp, setLp] = useState<string | null>(null);
  const mint = mintIn.trim();

  useEffect(() => {
    setPool(null); setLp(null); setMsg("");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
    let gone = false;
    solLaunchApi<Pool>("find", { mint, pool: fixedPool }).then((p) => { if (!gone) setPool(p); }).catch((e) => { if (!gone) setMsg(solErr(e)); });
    return () => { gone = true; };
  }, [mint, fixedPool]);

  const symbol = pool?.symbol || "tokens";
  // The other side follows the pool's price (the reserves are in base units).
  function onSol(v: string) {
    setAmtSol(v); setLast("sol");
    if (!pool) return;
    try { setAmtTok(fmtUnits((parseUnits(v || "0", 9) * BigInt(pool.tokenReserve)) / BigInt(pool.solReserve), pool.decimals)); } catch { setAmtTok(""); }
  }
  function onTok(v: string) {
    setAmtTok(v); setLast("token");
    if (!pool) return;
    try { setAmtSol(fmtUnits((parseUnits(v || "0", pool.decimals) * BigInt(pool.solReserve)) / BigInt(pool.tokenReserve), 9)); } catch { setAmtSol(""); }
  }

  async function add() {
    if (!sw || !pool) return;
    setBusy(true); setLp(null);
    try {
      setMsg("Confirm in your wallet…");
      const r = await solLaunchApi<{ tx: string; lpMint: string }>("add", { owner: sw.account.address, pool: pool.pool, side: last, amount: last === "sol" ? amtSol : amtTok, decimals: pool.decimals });
      await signAndSend(sw, r.tx);
      setLp(r.lpMint); setAmtSol(""); setAmtTok("");
      setMsg("✅ Liquidity added. The LP tokens are in your wallet.");
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  async function burn() {
    if (!sw || !lp) return;
    if (!confirm("Burn these LP tokens? The liquidity stays in the pool forever and nobody can take it out, including you.")) return;
    setBusy(true); setMsg("Confirm the burn in your wallet…");
    try {
      const r = await solLaunchApi<{ tx: string }>("burn", { owner: sw.account.address, lpMint: lp });
      await signAndSend(sw, r.tx);
      setLp(null); setMsg("🔥 LP tokens burned. This liquidity can never be removed.");
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      {!fixedMint && <input value={mintIn} onChange={(e) => setMintIn(e.target.value)} placeholder="Token address on Solana" spellCheck={false} aria-label="Token address" />}
      {pool && (
        <>
          <div className="notice">🪙 <b>{pool.symbol || short(mint)}</b> · Raydium pool <span className="mono">{short(pool.pool)}</span> · 1 {symbol} = {(Number(pool.solReserve) / 1e9 / (Number(pool.tokenReserve) / 10 ** pool.decimals)).toPrecision(4)} SOL</div>
          <label className="field"><span>SOL</span><input value={amtSol} onChange={(e) => onSol(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          <label className="field"><span>{symbol}</span><input value={amtTok} onChange={(e) => onTok(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          {picker(busy, setMsg)}
          <button className="btn primary" type="button" disabled={!sw || busy || !(Number(amtSol) > 0)} onClick={add}>Add liquidity</button>
          <small className="muted">Up to 5% price movement is allowed. You get Raydium LP tokens back.</small>
        </>
      )}
      {lp && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <button className="btn small" type="button" disabled={busy} onClick={burn}>🔥 Burn the LP tokens</button>
          <small className="muted">Or keep them: you can remove this liquidity later on <a href={`https://raydium.io/liquidity-pools/?token=${mint}`} target="_blank" rel="noopener noreferrer">Raydium</a>.</small>
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}

function fmtUnits(v: bigint, d: number) {
  const s = v.toString().padStart(d + 1, "0");
  const out = `${s.slice(0, -d) || "0"}.${s.slice(-d)}`.replace(/\.?0+$/, "");
  return out || "0";
}
