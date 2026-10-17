"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPublicClient, createWalletClient, custom, decodeEventLog, formatUnits, isAddress, parseUnits } from "viem";
import { LOCK_PRESETS, LOCKER_ABI, LOCKER_CHAINS, LOCKER_ERRORS, TOKEN_ABI, lockerTransport, short, untilText, type LockerChain, type LockerSite } from "@/lib/locker";

type TokenInfo = { address: `0x${string}`; name: string; decimals: number; isLp: boolean; balance: bigint | null };
type MyLock = { id: bigint; name: string; decimals: number; left: bigint; free: bigint; unlockDate: number; vesting: boolean; isLp: boolean };

const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const day = 86400;

/** Turns a wallet or contract error into a short sentence. */
function explain(e: any): string {
  let name: string | undefined;
  e?.walk?.((x: any) => { if (x?.data?.errorName) name = x.data.errorName; return false; });
  if (name && LOCKER_ERRORS[name]) return LOCKER_ERRORS[name];
  const m = String(e?.shortMessage || e?.message || "");
  if (/user (rejected|denied)|rejected the request/i.test(m)) return "You cancelled in your wallet. Nothing happened.";
  if (/insufficient funds/i.test(m)) return "Not enough coins in your wallet to pay the network fee.";
  return m.split("\n")[0] || "Something went wrong. Nothing was locked.";
}

/** Lock liquidity or tokens, and see / unlock your own locks. Uses the visitor's wallet; we never hold anything. */
export default function Locker({ sites }: { sites: LockerSite[] }) {
  const [tab, setTab] = useState<"lock" | "mine">("lock");
  const [chain, setChain] = useState<LockerChain>(sites[0].chain);
  const site = sites.find((s) => s.chain === chain)!;
  const cfg = LOCKER_CHAINS[chain];
  // Cast: viem's types misread optional fields when the project has `strict: false`.
  const pub = useMemo(() => createPublicClient({ chain: cfg.viem as any, transport: lockerTransport(chain) }) as any, [cfg, chain]);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // ----- lock form
  const [kind, setKind] = useState<"lp" | "token">("lp");
  const [tokenIn, setTokenIn] = useState("");
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState<number>(182);
  const [custom_, setCustom] = useState("");
  const [steps, setSteps] = useState(false);
  const [stepPct, setStepPct] = useState("10");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ id: string; hash: string } | null>(null);

  // ----- my locks
  const [mine, setMine] = useState<MyLock[] | null>(null);

  async function wallet() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet found. Open this page in the browser inside MetaMask, Trust Wallet or another wallet app.");
    const w = createWalletClient({ chain: cfg.viem as any, transport: custom(eth) }) as any;
    const [acc] = await w.requestAddresses();
    try { await w.switchChain({ id: cfg.viem.id }); } catch { await w.addChain({ chain: cfg.viem }); await w.switchChain({ id: cfg.viem.id }); }
    setAccount(acc);
    return { w, acc: acc as `0x${string}` };
  }

  // Read the token as soon as a full address is typed.
  useEffect(() => {
    setInfo(null); setDone(null);
    const a = tokenIn.trim();
    if (!isAddress(a)) return;
    let gone = false;
    (async () => {
      try {
        const read = (fn: any, address = a as `0x${string}`, args: any[] = []) => pub.readContract({ address, abi: TOKEN_ABI, functionName: fn, args } as any).catch(() => undefined);
        const [isLp, sym, dec, bal] = await Promise.all([
          pub.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "isPair", args: [a as `0x${string}`] }).catch(() => false),
          read("symbol"), read("decimals"), account ? read("balanceOf", a as `0x${string}`, [account]) : undefined,
        ]);
        if (dec === undefined) { if (!gone) setMsg(`That address isn't a token on ${cfg.name}.`); return; }
        let name = String(sym ?? "token");
        if (isLp) {
          const [t0, t1] = await Promise.all([read("token0"), read("token1")]);
          const [s0, s1] = await Promise.all([t0 ? read("symbol", t0 as any) : "?", t1 ? read("symbol", t1 as any) : "?"]);
          name = `${s0}/${s1} LP`;
        }
        if (gone) return;
        setInfo({ address: a as `0x${string}`, name, decimals: Number(dec), isLp: !!isLp, balance: (bal as bigint) ?? null });
        setKind(isLp ? "lp" : "token");
        setMsg("");
      } catch { if (!gone) setMsg("Couldn't read that token. Check the address and the chain."); }
    })();
    return () => { gone = true; };
  }, [tokenIn, pub, site.address, account, cfg.name]);

  const unlockAt = useMemo(() => {
    if (custom_) { const t = Date.parse(custom_ + "T00:00:00"); return isFinite(t) ? Math.floor(t / 1000) : 0; }
    return Math.floor(Date.now() / 1000) + days * day;
  }, [custom_, days]);

  let units = 0n;
  try { units = info && amount ? parseUnits(amount.replace(/,/g, ""), info.decimals) : 0n; } catch { units = 0n; }
  const step = Math.round(Number(stepPct) * 100);
  const problem = !info ? null
    : units <= 0n ? "Enter how much to lock."
    : info.balance != null && units > info.balance ? `You only have ${fmt(info.balance, info.decimals)} ${info.name}.`
    : unlockAt <= Date.now() / 1000 + 600 ? "Pick an unlock date in the future."
    : steps && !(step >= 1 && step <= 10_000) ? "Each step must be between 0.01% and 100%."
    : owner && !isAddress(owner) ? "The owner wallet address isn't valid."
    : null;

  async function doLock() {
    if (!info || problem) return;
    setBusy(true); setMsg("Check your wallet app…"); setDone(null);
    try {
      const { w, acc } = await wallet();
      const who = (owner && isAddress(owner) ? owner : acc) as `0x${string}`;
      const allowance = (await pub.readContract({ address: info.address, abi: TOKEN_ABI, functionName: "allowance", args: [acc, site.address] })) as bigint;
      if (allowance < units) {
        setMsg(`Step 1 of 2: allow the locker to take your ${info.name}…`);
        const h = await w.writeContract({ account: acc, chain: cfg.viem, address: info.address, abi: TOKEN_ABI, functionName: "approve", args: [site.address, units] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      setMsg(`${allowance < units ? "Step 2 of 2: " : ""}confirm the lock in your wallet…`);
      const args = steps
        ? { functionName: "vestingLock" as const, args: [who, info.address, info.isLp, units, BigInt(unlockAt), BigInt(step), BigInt(30 * day), BigInt(step), note.slice(0, 200)] }
        : { functionName: "lock" as const, args: [who, info.address, info.isLp, units, BigInt(unlockAt), note.slice(0, 200)] };
      const { request } = await pub.simulateContract({ account: acc, address: site.address, abi: LOCKER_ABI, ...args } as any);
      const hash = await w.writeContract(request);
      setMsg("Locking… waiting for the network to confirm.");
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") { setMsg("The lock failed. Your tokens weren't moved, but the network fee was spent."); return; }
      const ev = r.logs.map((l) => { try { return decodeEventLog({ abi: LOCKER_ABI, ...l }) as any; } catch { return null; } }).find((x) => x?.eventName === "LockAdded");
      setDone({ id: ev ? String(ev.args.id) : "?", hash });
      setMsg(""); setAmount("");
      fetch("/api/lockers/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, token: info.address, name: info.name, lp: info.isLp }) }).catch(() => {});
    } catch (e: any) { setMsg(explain(e)); } finally { setBusy(false); }
  }

  const loadMine = useCallback(async () => {
    setMine(null); setMsg("");
    try {
      const { acc } = await wallet();
      const ids = (await pub.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "lockIdsForUser", args: [acc] })) as bigint[];
      const rows: MyLock[] = await Promise.all(ids.map(async (id) => {
        const [l, free] = await Promise.all([
          pub.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "getLockById", args: [id] }) as Promise<any>,
          pub.readContract({ address: site.address, abi: LOCKER_ABI, functionName: "withdrawableTokens", args: [id] }) as Promise<bigint>,
        ]);
        const [sym, dec] = await Promise.all([
          pub.readContract({ address: l.token, abi: TOKEN_ABI, functionName: "symbol" }).catch(() => "token"),
          pub.readContract({ address: l.token, abi: TOKEN_ABI, functionName: "decimals" }).catch(() => 18),
        ]);
        return { id, name: l.isLpToken ? `${sym} (LP)` : String(sym), decimals: Number(dec), left: (l.amount as bigint) - (l.unlockedAmount as bigint), free, unlockDate: Number(l.tgeDate), vesting: l.cycle > 0n, isLp: l.isLpToken };
      }));
      setMine(rows);
    } catch (e: any) { setMine([]); setMsg(explain(e)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pub, site.address, chain]);

  async function doUnlock(id: bigint) {
    setBusy(true); setMsg("Confirm the unlock in your wallet…");
    try {
      const { w, acc } = await wallet();
      const { request } = await pub.simulateContract({ account: acc, address: site.address, abi: LOCKER_ABI, functionName: "unlock", args: [id] });
      const hash = await w.writeContract(request);
      await pub.waitForTransactionReceipt({ hash });
      await loadMine();
      setMsg("✅ Unlocked. The tokens are back in the owner wallet.");
    } catch (e: any) { setMsg(explain(e)); } finally { setBusy(false); }
  }

  useEffect(() => { if (tab === "mine" && account) loadMine(); }, [tab, chain, account, loadMine]);

  return (
    <div className="card stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className={"btn small" + (tab === "lock" ? " primary" : "")} onClick={() => setTab("lock")}>🔒 New lock</button>
        <button type="button" className={"btn small" + (tab === "mine" ? " primary" : "")} onClick={() => setTab("mine")}>📋 My locks</button>
        {sites.length > 1 && (
          <select value={chain} onChange={(e) => { setChain(e.target.value as LockerChain); setTokenIn(""); setMine(null); }} aria-label="Chain" style={{ marginLeft: "auto" }}>
            {sites.map((s) => <option key={s.chain} value={s.chain}>{LOCKER_CHAINS[s.chain].name}</option>)}
          </select>
        )}
      </div>

      {tab === "lock" ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className={"btn small" + (kind === "lp" ? " primary" : "")} onClick={() => setKind("lp")}>💧 Liquidity (LP)</button>
            <button type="button" className={"btn small" + (kind === "token" ? " primary" : "")} onClick={() => setKind("token")}>🪙 Tokens</button>
          </div>
          <label className="stack" style={{ gap: 4 }}>
            <b>1. {kind === "lp" ? "The pool (LP token) address" : "The token address"}</b>
            <input value={tokenIn} onChange={(e) => setTokenIn(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            <small className="muted">{kind === "lp" ? "Find it on DexScreener: open your token, the \"Pair\" address is the LP token." : `Any token on ${cfg.name}.`}</small>
          </label>
          {info && (
            <>
              <div className="notice">{info.isLp ? "💧" : "🪙"} <b>{info.name}</b>{info.balance != null ? ` · you have ${fmt(info.balance, info.decimals)}` : " · connect your wallet to see your balance"}</div>
              <label className="stack" style={{ gap: 4 }}>
                <b>2. How much</b>
                <div className="row" style={{ gap: 6 }}>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0" style={{ flex: 1, minWidth: 0 }} />
                  {info.balance != null && [25, 50, 100].map((p) => (
                    <button key={p} type="button" className="btn small" onClick={() => setAmount(formatUnits((info.balance! * BigInt(p)) / 100n, info.decimals))}>{p === 100 ? "Max" : `${p}%`}</button>
                  ))}
                </div>
              </label>
              <div className="stack" style={{ gap: 4 }}>
                <b>3. Lock until</b>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {LOCK_PRESETS.map((p) => (
                    <button key={p.days} type="button" className={"btn small" + (!custom_ && days === p.days ? " primary" : "")} onClick={() => { setDays(p.days); setCustom(""); }}>{p.label}</button>
                  ))}
                  <input type="date" value={custom_} onChange={(e) => setCustom(e.target.value)} aria-label="Pick a date" min={new Date(Date.now() + day * 1000).toISOString().slice(0, 10)} />
                </div>
                <small className="muted">Unlocks on <b>{unlockAt ? new Date(unlockAt * 1000).toLocaleDateString() : "–"}</b>. The date can be moved later, never earlier.</small>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <input type="checkbox" checked={steps} onChange={(e) => setSteps(e.target.checked)} style={{ marginTop: 4 }} />
                <span>Unlock in steps instead (vesting): <input value={stepPct} onChange={(e) => setStepPct(e.target.value)} inputMode="decimal" style={{ width: 56 }} disabled={!steps} />% on the unlock date, then the same every month</span>
              </label>
              <details>
                <summary className="muted">More options: owner and note</summary>
                <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                  <input value={owner} onChange={(e) => setOwner(e.target.value.trim())} placeholder="Owner wallet (leave empty for your wallet)" spellCheck={false} />
                  <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Note shown with the lock, e.g. Team tokens" />
                </div>
              </details>
              <div className="notice warn" style={{ fontSize: ".9em" }}>
                🔐 Once locked, <b>nobody can move it before the unlock date</b>: not you, not the AUTISTIK team. Only the owner can take it back after. Tokens with a tax lock what actually arrives.
              </div>
              <button type="button" className="btn primary" disabled={busy || !!problem} onClick={doLock}>{busy ? "Working…" : account ? `🔒 Lock ${info.name}` : "🔒 Connect wallet & lock"}</button>
              {problem && amount && <small className="muted">{problem}</small>}
            </>
          )}
          {!info && !account && <button type="button" className="btn" onClick={() => wallet().catch((e) => setMsg(explain(e)))}>Connect wallet</button>}
          {done && (
            <div className="notice">
              ✅ Locked! Lock #{done.id}.{" "}
              <a href={`${cfg.explorer}/tx/${done.hash}`} target="_blank" rel="noreferrer">See it on the explorer</a> ·{" "}
              <Link href={`/lockers?chain=${chain}&token=${info?.address ?? ""}`}>See all locks for this token</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {!account ? <button type="button" className="btn primary" onClick={loadMine}>Connect wallet to see your locks</button>
            : mine == null ? <div className="muted">Loading your locks…</div>
            : !mine.length ? <div className="muted">No active locks for {short(account)} on {cfg.name}.</div>
            : mine.map((l) => (
              <div key={String(l.id)} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span>#{String(l.id)} · {l.isLp ? "💧" : "🪙"} {fmt(l.left, l.decimals)} {l.name}{l.vesting ? " · in steps" : ""}<br />
                  <small className="muted">{l.unlockDate * 1000 > Date.now() ? `Unlocks ${new Date(l.unlockDate * 1000).toLocaleDateString()} (${untilText(l.unlockDate)})` : l.free > 0n ? `${fmt(l.free, l.decimals)} ready to unlock` : "Next step not reached yet"}</small>
                </span>
                <button type="button" className="btn small" disabled={busy || l.free === 0n} onClick={() => doUnlock(l.id)}>{l.free > 0n ? "Unlock" : "🔒 Locked"}</button>
              </div>
            ))}
        </div>
      )}
      {msg && <div className="muted" style={{ fontSize: ".9em" }}>{msg}</div>}
      <small className="muted">Locker contract on {cfg.name}: <a href={`${cfg.explorer}/address/${site.address}#code`} target="_blank" rel="noreferrer">{short(site.address)}</a>{site.verified ? " · ✓ verified source" : ""}</small>
    </div>
  );
}
