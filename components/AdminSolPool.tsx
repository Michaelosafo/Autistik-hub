"use client";
import { reportActivity } from "@/lib/activity-client";
import { MAX_RAGE_TAX, SOL_ADDR, rageTaxBps } from "@/lib/admin-rage";
import { getState, pickWallet, restoreSol, setNetwork, subscribe } from "@/lib/connect";
import { CHAINS, SOL_DECIMALS, SOL_POOL_COST } from "@/lib/launchpad";
import { signAndSend, solErr, type SolWallet } from "@/lib/sol-wallet";
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatUnits } from "viem";

/**
 * Rage on Solana: create an SPL token (or Token-2022 when a tax is set), add Raydium liquidity, then ask to remove
 * the LP sitting in this wallet. Solana cannot keep trading closed for a private first buy, and Token-2022 has one
 * transfer fee rather than a separate buy and sell tax.
 */
const CHAIN = CHAINS.solana;
const SAVED = "autistik-admin-direct-token:solana";
const SAVED_LIST = "autistik-admin-direct-tokens:solana";
const fmt = (raw: string, d: number) => {
  try { return Number(formatUnits(BigInt(raw), d)).toLocaleString("en-US", { maximumFractionDigits: 6 }); } catch { return "0"; }
};
const showNum = (n: string) => {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 6 }) : n;
};

type Pool = { pool: string; lpMint: string; tokenReserve: string; solReserve: string; lpAmount: string; lpDecimals: number };
type Info = { symbol: string; name: string; decimals: number; tokenBal: string; solBal: string; feeBps: number | null; pool: Pool | null };

async function rageSol<T>(action: string, body: object): Promise<T> {
  const r = await fetch("/api/admin/rage-solana", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
  return d as T;
}

export default function AdminSolPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  const cs = useSyncExternalStore(subscribe, getState, getState);
  const sw: SolWallet | null = cs.sol ? { wallet: cs.sol.wallet, account: cs.sol.account } : null;
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [buyTax, setBuyTax] = useState("0");
  const [sellTax, setSellTax] = useState("0");
  const [tokenIn, setTokenIn] = useState("");
  const [savedCAs, setSavedCAs] = useState<{ mint: string; name: string; symbol: string }[]>([]);
  const [amtToken, setAmtToken] = useState("");
  const [amtSol, setAmtSol] = useState("");
  const [pct, setPct] = useState(100);
  const [askRemove, setAskRemove] = useState(false);
  const [known, setKnown] = useState<{ mint: string; pool: string } | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const mint = SOL_ADDR.test(tokenIn.trim()) ? tokenIn.trim() : "";
  const knownPool = known?.mint === mint ? known.pool : "";

  useEffect(() => { restoreSol().catch(() => {}); }, []);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED);
      if (saved && SOL_ADDR.test(saved)) setTokenIn(saved);
      const list = JSON.parse(localStorage.getItem(SAVED_LIST) || "[]");
      if (Array.isArray(list)) setSavedCAs(list.filter((x: any) => x && SOL_ADDR.test(String(x.mint || ""))).slice(0, 50));
    } catch { /* private mode */ }
  }, []);
  useEffect(() => {
    setInfo(null);
    if (!mint) return;
    let gone = false;
    rageSol<Info>("info", { owner: sw?.account.address || "", mint, ...(knownPool ? { pool: knownPool } : {}) }).then((d) => { if (!gone) setInfo(d); }).catch((e) => { if (!gone) setMsg(solErr(e)); });
    return () => { gone = true; };
  }, [mint, sw?.account.address, tick, knownPool]);

  function connect() { setNetwork("solana").catch(() => {}); pickWallet({ fresh: true }); }
  function save(addr: string) {
    setTokenIn(addr);
    try { localStorage.setItem(SAVED, addr); } catch { /* private mode */ }
  }
  function saveCA() {
    if (!mint) { setMsg("Enter a valid Solana token CA first."); return; }
    const entry = { mint, name: info?.name || name || "Token", symbol: info?.symbol || symbol || "TOKEN" };
    const next = [entry, ...savedCAs.filter((x) => x.mint !== mint)].slice(0, 50);
    setSavedCAs(next);
    try { localStorage.setItem(SAVED_LIST, JSON.stringify(next)); localStorage.setItem(SAVED, mint); } catch { /* ignore */ }
    setMsg(`CA saved: ${mint}`);
  }
  function newDeployment() {
    // Works even while a step is waiting on the wallet: a stuck step must never block a new launch.
    setBusy(false); setKnown(null);
    setName(""); setSymbol(""); setSupply("1000000000"); setBuyTax("0"); setSellTax("0");
    setTokenIn(""); setInfo(null); setAmtToken(""); setAmtSol(""); setAskRemove(false); setMsg("Ready for another deployment.");
    try { localStorage.removeItem(SAVED); } catch { /* private mode */ }
  }

  const showDeploy = mode === "all" || mode === "deploy";
  const showAdd = mode === "all" || mode === "add";
  const showRemove = mode === "all" || mode === "remove";
  const buyBps = rageTaxBps(buyTax);
  const sellBps = rageTaxBps(sellTax);
  const feePct = buyBps == null || sellBps == null ? null : Math.max(buyBps, sellBps) / 100;

  async function deploy() {
    const n = name.trim();
    const s = symbol.trim().replace(/^\$/, "").toUpperCase();
    if (!n || n.length > 32) { setMsg("Name must be 1–32 characters."); return; }
    if (!/^[A-Z0-9]{1,12}$/.test(s)) { setMsg("Ticker must be 1–12 letters or numbers."); return; }
    if (buyBps == null || sellBps == null) { setMsg(`Buy tax and sell tax must each be 0–${MAX_RAGE_TAX}%.`); return; }
    const whole = supply.replace(/[,_\s]/g, "");
    if (!/^\d{1,16}$/.test(whole) || BigInt(whole) <= 0n) { setMsg("Supply must be a whole number of tokens."); return; }
    if (!sw) { setMsg("Connect a Solana wallet first."); return; }
    if (buyBps !== sellBps && !confirm(`Solana uses one transfer fee, not a separate buy and sell tax. This token will charge ${feePct}% on every transfer (buys, sells, and sends), the higher of the two. Continue?`)) return;
    setBusy(true);
    try {
      setMsg(feePct ? `Confirm in your wallet: deploy ${s} with a ${feePct}% transfer fee.` : "Confirm in your wallet: deploy the token. The whole supply comes to this wallet.");
      const built = await rageSol<{ tx: string; mint: string; feeBps: number }>("mint", { owner: sw.account.address, name: n, symbol: s, supply: whole, buyTax, sellTax });
      const sig = await signAndSend(sw, built.tx, () => {
        // Switch the panel to the new mint immediately after wallet submission,
        // so delayed confirmation lookup cannot leave the previous token selected.
        save(built.mint);
        setMsg("Transaction submitted. Loading new token CA: " + built.mint);
      });
      save(built.mint);
      setTick((x) => x + 1);
      const feeNote = built.feeBps > 0 ? ` Transfer fee ${built.feeBps / 100}% (Token-2022, every transfer).` : " No transfer fee.";
      setMsg(`✅ ${s} deployed.${feeNote} Now add the liquidity below. ${CHAIN.explorer}/token/${built.mint} · ${CHAIN.explorer}/tx/${sig}`);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  async function add() {
    if (!sw || !mint || !info) return;
    if (!amtToken || !amtSol) { setMsg("Type both amounts."); return; }
    setBusy(true);
    try {
      if (!info.pool) {
        setMsg(`Confirm in your wallet: create the Raydium pool. Raydium charges about 0.15 SOL on top (keep about ${SOL_POOL_COST} SOL spare).`);
        const r = await rageSol<{ tx: string; pool: string; lpMint: string }>("pool", { owner: sw.account.address, mint, tokens: amtToken, sol: amtSol });
        const sig = await signAndSend(sw, r.tx);
        setKnown({ mint, pool: r.pool });
        reportActivity("liquidity", "solana", sig, `Admin added ${amtToken} ${info.symbol || "tokens"} + ${amtSol} SOL`);
        setAmtToken(""); setAmtSol(""); setTick((x) => x + 1);
        setMsg(`✅ Liquidity is in. ${CHAIN.explorer}/tx/${sig}`);
      } else {
        setMsg("Confirm in your wallet: add liquidity at the pool's price.");
        const r = await rageSol<{ tx: string }>("add", { owner: sw.account.address, pool: info.pool.pool, side: "token", amount: amtToken, decimals: info.decimals });
        const sig = await signAndSend(sw, r.tx);
        reportActivity("liquidity", "solana", sig, `Admin added ${amtToken} ${info.symbol || "tokens"} on Raydium`);
        setAmtToken(""); setAmtSol(""); setTick((x) => x + 1);
        setMsg(`✅ Liquidity added. ${CHAIN.explorer}/tx/${sig}`);
      }
      if (mode === "all" && confirm("Done. Remove the liquidity now?")) setAskRemove(true);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  async function remove() {
    if (!sw || !info?.pool) return;
    if (!confirm(`Remove ${pct}% of the LP in this wallet? The tokens and SOL come back here. Liquidity that was burned or locked on a normal launch is not touched.`)) return;
    setBusy(true);
    try {
      const r = await rageSol<{ tx: string }>("remove", { owner: sw.account.address, pool: info.pool.pool, pct });
      const sig = await signAndSend(sw, r.tx);
      reportActivity("liquidity", "solana", sig, `Admin removed ${pct}% of ${info.symbol || "token"} liquidity`);
      setMsg(`✅ Removed ${pct}% of the liquidity in this wallet. ${CHAIN.explorer}/tx/${sig}`);
      setTick((x) => x + 1);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  async function collect() {
    if (!sw || !mint) return;
    setBusy(true);
    try {
      const r = await rageSol<{ txs: string[]; amount: string }>("collect", { owner: sw.account.address, mint });
      if (!r.txs.length) { setMsg("No tax is waiting to collect yet. It builds up as people transfer the token."); return; }
      let last = "";
      for (const tx of r.txs) last = await signAndSend(sw, tx);
      setMsg(`✅ Collected the withheld tax into this wallet. ${CHAIN.explorer}/tx/${last}`);
      setTick((x) => x + 1);
    } catch (e) { setMsg(solErr(e)); } finally { setBusy(false); }
  }

  function onToken(v: string) {
    setAmtToken(v);
    const pool = info?.pool;
    if (!pool) return;
    const token = Number(pool.tokenReserve), sol = Number(pool.solReserve);
    if (!(token > 0) || !(sol >= 0)) return;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) setAmtSol(String(+(n * sol / token).toPrecision(6)));
  }

  const title = mode === "add" ? "Add LP" : mode === "remove" ? "Remove LP" : "Rage";
  const lp = info?.pool ? BigInt(info.pool.lpAmount) : 0n;
  return (
    <>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>
        Solana · Raydium. Deploy the token, add the liquidity, then it asks if you want to remove that liquidity. The LP stays in this wallet.
        Trading opens as soon as the pool exists: Solana has no closed-trading first buy.
      </p>
      {!sw && <button className="btn small" type="button" disabled={busy} onClick={connect}>Connect a Solana wallet</button>}
      {sw && <small className="muted">Wallet <span className="mono">{sw.account.address.slice(0, 4)}…{sw.account.address.slice(-4)}</span> on Solana · <button type="button" className="linkish" onClick={connect} disabled={busy}>Switch</button></small>}

      {showDeploy && (
        <>
          <div className="notice" style={{ display: "grid", gap: 8 }}>
        <b>CA management</b>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn small" type="button" disabled={!mint || busy} onClick={saveCA}>Save current CA</button>
          <button className="btn small" type="button" onClick={newDeployment}>Start another deployment</button>
          {busy && <button className="btn small ghost" type="button" onClick={() => { setBusy(false); setMsg("Stopped waiting. If your wallet still shows the request, reject it there, then try again."); }}>Stop waiting</button>}
        </div>
        {savedCAs.length > 0 && <div className="stack" style={{ gap: 6 }}>
          <small>Saved CAs</small>
          {savedCAs.map((item) => <div className="row" key={item.mint} style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{item.symbol} · {item.mint.slice(0, 6)}…{item.mint.slice(-6)}</span>
            <button className="btn small" type="button" onClick={() => setTokenIn(item.mint)}>Load</button>
          </div>)}
        </div>}
      </div>
      <b>1. Deploy the token</b>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" maxLength={32} /></label>
          <label className="field"><span>Ticker</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="TOK" maxLength={12} /></label>
          <label className="field"><span>Supply (whole tokens, 6 decimals)</span><input value={supply} onChange={(e) => setSupply(e.target.value)} inputMode="decimal" placeholder="1000000000" /></label>
          <label className="field"><span>Buy tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={buyTax} onChange={(e) => setBuyTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Buy tax percent" /></label>
          <label className="field"><span>Sell tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={sellTax} onChange={(e) => setSellTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Sell tax percent" /></label>
          <small className="muted">Token-2022 has one fee on every transfer, not a separate buy and sell tax. If these differ, the token uses the higher one. At 0% and 0% it is a normal SPL token with no fee. The fee cannot be changed, and only this wallet can collect it.</small>
          <button className="btn primary" type="button" disabled={busy || !name.trim() || !symbol.trim()} onClick={deploy}>Deploy token</button>
        </>
      )}

      <b>2. Token</b>
      <input value={tokenIn} onChange={(e) => setTokenIn(e.target.value.trim())} placeholder="Token address (filled in after deploy)" spellCheck={false} aria-label="Token address" />

      {info && (
        <>
          <div className="notice">
            🪙 <b>{info.symbol || "Token"}</b>
            {info.feeBps != null && info.feeBps > 0 ? <> · transfer fee {info.feeBps / 100}%</> : <> · no transfer fee</>}
            {info.pool ? <> · pool: {showNum(info.pool.tokenReserve)} {info.symbol || "tokens"} + {showNum(info.pool.solReserve)} SOL</> : <> · no Raydium pool yet: the amounts you add set the starting price</>}
            {sw && <><br /><small>You have {fmt(info.tokenBal, info.decimals)} {info.symbol || "tokens"} and {fmt(info.solBal, 9)} SOL</small></>}
            {info.pool && <><br /><small>Pool <a href={`${CHAIN.explorer}/account/${info.pool.pool}`} target="_blank" rel="noreferrer">{info.pool.pool.slice(0, 4)}…{info.pool.pool.slice(-4)}</a></small></>}
          </div>
          {info.feeBps != null && info.feeBps > 0 && (
            <button className="btn small" type="button" disabled={busy} onClick={collect}>Collect withheld tax</button>
          )}
          {showAdd && (
            <>
              <b>3. Add liquidity</b>
              <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>
                {info.pool ? "The pool already has a price. The token amount is what you add; SOL follows that price." : `A new pool needs both amounts. Keep about ${SOL_POOL_COST} SOL spare for Raydium's pool fee and rent.`}
              </p>
              <label className="field"><span>{info.symbol || "Tokens"}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>SOL</span><input value={amtSol} onChange={(e) => setAmtSol(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <button className="btn primary" type="button" disabled={busy || !amtToken || !amtSol} onClick={add}>{info.pool ? "Add liquidity" : "Create pool"}</button>
            </>
          )}
          {showRemove && (askRemove || mode !== "all" || lp > 0n) && (
            info.pool ? (
              sw ? (
                lp > 0n ? (
                  <>
                    <b>4. Remove liquidity?</b>
                    <small>LP in this wallet: {fmt(info.pool.lpAmount, info.pool.lpDecimals)}</small>
                    <label className="field"><span>Remove <b>{pct}%</b></span><input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Share of liquidity to remove" /></label>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {[25, 50, 100].map((p) => <button key={p} type="button" className={"btn small" + (pct === p ? " primary" : "")} onClick={() => setPct(p)}>{p}%</button>)}
                    </div>
                    <button className="btn" type="button" disabled={busy} onClick={remove}>Remove liquidity</button>
                  </>
                ) : <small className="muted">Waiting for the LP to show in this wallet.</small>
              ) : <small className="muted">Connect the wallet that holds the LP.</small>
            ) : <small className="muted">This token has no pool yet. Add liquidity first.</small>
          )}
        </>
      )}
      {msg && <small className="muted" style={{ overflowWrap: "anywhere" }}>{msg}</small>}
    </>
  );
}
