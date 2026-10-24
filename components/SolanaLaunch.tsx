"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { parseUnits } from "viem";
import { getState, pickWallet, restoreSol, setNetwork, subscribe } from "@/lib/connect";
import { CHAINS, LOCKS, SOL_POOL_COST, solLaunchFee, type LaunchPlan } from "@/lib/launchpad";
import { reportActivity } from "@/lib/activity-client";
import { signAndSend, solErr, solLaunchApi, type SolWallet } from "@/lib/sol-wallet";

const c = CHAINS.solana;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * The Solana wallet for launching and locking: the same one as the site's Connect window (Bitget, Trust, Phantom,
 * Solflare, OKX, Backpack, Coinbase… on this device, or opened in the wallet's app on a phone).
 */
export function useSolWallet() {
  const cs = useSyncExternalStore(subscribe, getState, getState);
  useEffect(() => { restoreSol().catch(() => {}); }, []);
  const sw: SolWallet | null = cs.sol ? { wallet: cs.sol.wallet, account: cs.sol.account } : null;
  const open = () => { setNetwork("solana"); pickWallet({ fresh: true }); };
  const picker = (busy: boolean, _onErr: (m: string) => void) => sw ? (
    <small className="muted">Wallet: <span className="mono">{short(sw.account.address)}</span> ({cs.sol!.name}) · <button type="button" className="linkish" onClick={open} disabled={busy}>Switch</button></small>
  ) : (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button type="button" className="btn small primary" disabled={busy} onClick={open}>Connect a Solana wallet</button>
      <small className="muted">Bitget, Trust, Phantom, Solflare, OKX, Backpack…</small>
    </div>
  );
  return { sw, picker };
}

type Step = "token" | "pool" | "burn" | "list";
const STEPS: Record<Step, string> = { token: "Create the token", pool: "Create the Raydium pool", burn: "Burn the LP tokens", list: "Add it to the Hub" };
const stepName = (k: Step, plan: LaunchPlan) => (k === "burn" && plan.lock !== "burn" ? `Lock the LP tokens (${LOCKS[plan.lock].label.replace("Lock ", "")})` : STEPS[k]);

/** The Solana launch: three signatures (token, pool, then burn or lock the LP tokens), each step resumable if one fails. */
export function SolanaLaunch({ plan, agree, onDone }: { plan: LaunchPlan; agree: boolean; onDone: (d: { token: string; pair: string; hash: string; listed: boolean }) => void }) {
  const { sw, picker } = useSolWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [mint, setMint] = useState<{ mint: string; sig: string } | null>(null);
  const [pool, setPool] = useState<{ pool: string; lpMint: string } | null>(null);
  const [burned, setBurned] = useState(false);
  const step: Step = !mint ? "token" : !pool ? "pool" : !burned ? "burn" : "list";
  // Progress is kept on this device, so a failed step or a reload continues with the same token (never a second one).
  const key = `sol-launch:${plan.symbol}:${plan.name}`;
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "null");
      if (v?.mint?.mint) { setMint(v.mint); if (v.pool?.pool) setPool(v.pool); if (v.burned) setBurned(true); setMsg(`Continuing your launch of $${plan.symbol}: the token already exists.`); }
    } catch { /* private mode */ }
  }, [key]);
  useEffect(() => {
    try { if (mint) localStorage.setItem(key, JSON.stringify({ mint, pool, burned })); } catch { /* private mode */ }
  }, [key, mint, pool, burned]);

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
        setMsg(`✅ Pool created. Last step: ${stepName("burn", plan).toLowerCase()}.`);
      } else if (step === "burn") {
        const locking = plan.lock !== "burn";
        setMsg(`Step 3 of 3: confirm the ${locking ? "lock" : "burn"} in your wallet…`);
        const r = locking
          ? await solLaunchApi<{ tx: string }>("lock", { owner, lpMint: pool!.lpMint, lock: plan.lock })
          : await solLaunchApi<{ tx: string }>("burn", { owner, lpMint: pool!.lpMint });
        await signAndSend(sw, r.tx);
        setBurned(true);
      }
      if (step === "burn" || step === "list") {
        setMsg("Adding it to the Hub…");
        const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", token: mint!.mint, pair: pool!.pool, txHash: mint!.sig, lock: plan.lock, lpMint: pool!.lpMint }) });
        onDone({ token: mint!.mint, pair: pool!.pool, hash: mint!.sig, listed: res.ok });
        try { localStorage.removeItem(key); } catch { /* private mode */ }
        setMsg("");
      }
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {picker(busy, setMsg)}
      <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: ".88em" }}>
        {(Object.keys(STEPS) as Step[]).map((k) => <li key={k} style={{ fontWeight: k === step ? 700 : 400 }}>{stepName(k, plan)}{k === "token" && mint ? " ✓" : k === "pool" && pool ? " ✓" : k === "burn" && burned ? " ✓" : ""}</li>)}
      </ol>
      {!mint && sw && <ResumeToken owner={sw.account.address} busy={busy} onFound={(m) => { setMint(m); setMsg("✅ Found your token. Next: the pool."); }} onErr={setMsg} />}
      {mint && <small className="muted">Token: <a href={`${c.explorer}/token/${mint.mint}`} target="_blank" rel="noopener noreferrer" className="mono">{short(mint.mint)}</a></small>}
      <button className="btn primary" type="button" disabled={!sw || !agree || busy} onClick={next}>
        {busy ? "Working…" : step === "token" ? `Launch for ${plan.liquidity} SOL + about ${+(SOL_POOL_COST + solLaunchFee()).toFixed(3)} SOL in fees` : `Continue: ${stepName(step, plan).toLowerCase()}`}
      </button>
      {msg && <span className="muted" style={{ fontSize: ".88em" }}>{msg}</span>}
    </div>
  );
}

/** No pool yet: create the Raydium pool (token / SOL) with amounts the member picks. */
function SolCreatePool({ mint, sw, picker, busy, setBusy, setMsg, onCreated }: {
  mint: string; sw: SolWallet | null; picker: ReturnType<typeof useSolWallet>["picker"]; busy: boolean;
  setBusy: (b: boolean) => void; setMsg: (m: string) => void; onCreated: (pool: string, lpMint: string) => void;
}) {
  const [tok, setTok] = useState("");
  const [sol, setSol] = useState("");
  const [have, setHave] = useState<{ amount: string; decimals: number | null; sol: string } | null>(null);
  useEffect(() => {
    if (!sw) return;
    solLaunchApi<{ amount: string; decimals: number | null; sol: string }>("balance", { owner: sw.account.address, mint }).then(setHave).catch(() => {});
  }, [sw, mint]);
  const all = have?.decimals != null ? fmtUnits(BigInt(have.amount), have.decimals) : null;
  const price = Number(sol) > 0 && Number(tok) > 0 ? Number(sol) / Number(tok) : null;
  async function create() {
    if (!sw) return;
    setBusy(true);
    try {
      setMsg("Confirm the new Raydium pool in your wallet…");
      const r = await solLaunchApi<{ tx: string; pool: string; lpMint: string }>("create-pool", { owner: sw.account.address, mint, tokens: tok, sol });
      const sig = await signAndSend(sw, r.tx);
      reportActivity("liquidity", "solana", sig, `Created a Raydium pool with ${sol} SOL`);
      setMsg("✅ Pool created and trading is open. Now burn the LP tokens so buyers can trust it.");
      onCreated(r.pool, r.lpMint);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="notice">🆕 This token has no pool yet. Create it on Raydium: the amounts you put in set the starting price.</div>
      {picker(busy, setMsg)}
      <label className="field"><span>Tokens</span><input value={tok} onChange={(e) => setTok(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
      {all && <small className="muted">You have {Number(all).toLocaleString("en-US")} tokens · {(Number(have!.sol) / 1e9).toFixed(4)} SOL. <button type="button" className="linkish" onClick={() => setTok(all)}>Use all my tokens</button></small>}
      <label className="field"><span>SOL</span><input value={sol} onChange={(e) => setSol(e.target.value.trim())} inputMode="decimal" placeholder="0.5" /></label>
      {price && <small className="muted">Starting price: 1 token = {price.toPrecision(4)} SOL</small>}
      <button className="btn primary" type="button" disabled={!sw || busy || !(Number(tok) > 0) || !(Number(sol) >= 0.01)} onClick={create}>
        {busy ? "Working…" : `Create the pool (${sol || 0} SOL + about ${SOL_POOL_COST} SOL in fees)`}
      </button>
      <small className="muted">Raydium charges about 0.15 SOL to create a pool. You get LP tokens back; burn them next so the liquidity stays forever.</small>
    </div>
  );
}

/** "Already made the token?": continue a launch that stopped after step 1, with that token. */
function ResumeToken({ owner, busy, onFound, onErr }: { owner: string; busy: boolean; onFound: (m: { mint: string; sig: string }) => void; onErr: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [addr, setAddr] = useState("");
  const [checking, setChecking] = useState(false);
  if (!open) return <button type="button" className="linkish" style={{ fontSize: ".86em" }} onClick={() => setOpen(true)}>Already created the token here? Continue with it</button>;
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="Your token address (ends in tik)" spellCheck={false} style={{ flex: 1, minWidth: 200 }} aria-label="Your token address" />
      <button type="button" className="btn small" disabled={busy || checking || addr.length < 32} onClick={async () => {
        setChecking(true);
        try { onFound(await solLaunchApi<{ mint: string; sig: string }>("resume", { owner, mint: addr })); } catch (e) { onErr(solErr(e)); } finally { setChecking(false); }
      }}>{checking ? "Checking…" : "Continue"}</button>
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
  const [noPool, setNoPool] = useState(false);
  const mint = mintIn.trim();

  useEffect(() => {
    setPool(null); setLp(null); setMsg("");
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return;
    let gone = false;
    setNoPool(false);
    solLaunchApi<Pool>("find", { mint, pool: fixedPool }).then((p) => { if (!gone) setPool(p); })
      .catch((e) => { if (gone) return; if (/No Raydium pool/i.test(String(e?.message))) setNoPool(true); else setMsg(solErr(e)); });
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
      const sig = await signAndSend(sw, r.tx);
      reportActivity("liquidity", "solana", sig, `Added ${amtSol} SOL + ${amtTok} ${pool.symbol} on Solana`);
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
      reportActivity("lp-burn", "solana", await signAndSend(sw, r.tx), "Burned LP tokens on Solana");
      setLp(null); setMsg("🔥 LP tokens burned. This liquidity can never be removed.");
      // Made here earlier? Add it to the Hub's list now that its pool exists and the LP is burned.
      if (pool) solLaunchApi<{ sig: string }>("resume", { owner: sw.account.address, mint })
        .then((r) => fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", token: mint, pair: pool.pool, txHash: r.sig, lock: "burn", lpMint: lp }) }))
        .then((res) => res?.ok && setMsg("🔥 LP tokens burned and your token is listed on the Hub."))
        .catch(() => {});
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
      {noPool && !pool && !lp && (
        <SolCreatePool mint={mint} sw={sw} picker={picker} busy={busy} setBusy={setBusy} setMsg={setMsg}
          onCreated={(p, lpMint) => { setNoPool(false); setLp(lpMint); solLaunchApi<Pool>("find", { mint, pool: p }).then(setPool).catch(() => {}); }} />
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

/** Token page, Solana, LP tokens locked in the AUTISTIK Solana Locker: once the date passes, the creator claims them back. */
export function SolanaClaim({ token, pair, creator, unlockAt }: { token: string; pair: string; creator: string; unlockAt: string | null }) {
  const { sw, picker } = useSolWallet();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const ended = !!unlockAt && Date.parse(unlockAt) <= Date.now();
  const mine = !!sw && sw.account.address === creator;
  async function claim() {
    if (!sw) return;
    setBusy(true); setMsg("Finding the pool's LP token…");
    try {
      const p = await solLaunchApi<{ lpMint: string }>("find", { mint: token, pool: pair });
      setMsg("Confirm the claim in your wallet…");
      const r = await solLaunchApi<{ tx: string }>("claim", { owner: sw.account.address, lpMint: p.lpMint });
      await signAndSend(sw, r.tx);
      setClaimed(true); setMsg("✅ Your LP tokens are back in your wallet.");
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }
  return (
    <div className="card stack" style={{ gap: 8, fontSize: ".92em" }}>
      <b>🔒 Locked liquidity</b>
      <small className="muted">The LP tokens are in the AUTISTIK Solana Locker{unlockAt ? ` until ${new Date(unlockAt).toLocaleDateString()}` : ""}. Nobody can take them out before then. After that, only the creator&apos;s wallet can claim them.</small>
      {ended && !claimed && (
        <>
          {picker(busy, setMsg)}
          {sw && !mine && <small className="muted">This wallet isn&apos;t the token&apos;s creator.</small>}
          {mine && <button className="btn primary" type="button" disabled={busy} onClick={claim}>{busy ? "Claiming…" : "Claim my LP tokens"}</button>}
        </>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
