"use client";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, decodeEventLog, encodeFunctionData, erc20Abi, formatUnits, getAddress, http, isAddress } from "viem";
import { STAKING_ABI } from "@/lib/staking-build";
import { NATIVE, WCHAINS, toUnits } from "@/lib/wallet-chains";
import type { PoolView } from "@/lib/staking-server";
import type { Signer } from "@/components/wallet/types";
import { amt, api as walletApi, friendlyError, Logo, usd, waitEvm, type TokenInfo } from "@/components/wallet/util";

const c = WCHAINS.bsc;
type Data = { contract: string | null; owner: string | null; createFee: string; pools: PoolView[] };
const LOCKS = [0, 7, 14, 30, 90, 180];
const PERIODS = [7, 14, 30, 90, 180, 365];
const DAY = 86400;

async function post<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/stake/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const when = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const days = (d: number) => (d === 0 ? "No lock" : d === 1 ? "1 day" : `${d} days`);
const pc = () => createPublicClient({ chain: c.viem, transport: http(c.rpc) }) as any;

/** Staking: stake a token, earn rewards. The AUTISTIK pool pays BNB from platform fees; token teams open their own pools. */
export default function StakeApp({ signer, start }: { signer: Signer; start: { pool?: number; admin?: boolean } }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"pools" | "mine" | "create">("pools");
  const [open, setOpen] = useState<{ pool: PoolView; kind: "stake" | "withdraw" | "rewards" | "manage" } | null>(null);
  const me = signer.evm?.address ?? null;
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [claiming, setClaiming] = useState<number | null>(null);

  const load = useCallback(() => {
    post<Data>("pools", { chain: "bsc", user: me, all: !!start.admin }).then((d) => { setData(d); setErr(""); }).catch((e) => setErr(e.message));
  }, [me, start.admin]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  // A shared link (/stake?pool=3) opens that pool's Stake screen.
  useEffect(() => {
    if (start.pool == null || !data || open) return;
    const p = data.pools.find((x) => x.id === start.pool);
    if (p && me) setOpen({ pool: p, kind: "stake" });
  }, [data, me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function claim(p: PoolView) {
    if (!data?.contract || !signer.evm) return;
    setClaiming(p.id); setNote(null);
    try {
      await sendTx(signer, data.contract, encodeFunctionData({ abi: STAKING_ABI, functionName: "claim", args: [BigInt(p.id)] }));
      setNote({ ok: true, text: `Collected ${amt(p.mine?.earnedNum ?? 0)} ${p.reward.symbol} to your wallet.` }); load();
    } catch (e: any) { setNote({ ok: false, text: friendlyError(e, c.native.symbol) }); }
    setClaiming(null);
  }

  const pools = data?.pools || [];
  const mine = pools.filter((p) => p.mine && (p.mine.stakedNum > 0 || p.mine.earnedNum > 0));
  const shown = tab === "mine" ? mine : pools.filter((p) => !p.hidden || start.admin);
  const featured = pools.find((p) => p.featured);
  const earnedUsd = mine.reduce((s, p) => s + (p.mine!.earnedNum * (p.reward.priceUsd ?? 0)), 0);

  return (
    <div className="stk">
      <section className="stk-top">
        <div>
          <small>Your rewards</small>
          <div className="stk-big">{me ? usd(earnedUsd) : "–"}</div>
          <small>{me ? `${mine.length} pool${mine.length === 1 ? "" : "s"} staked` : "Connect a wallet to stake"}</small>
        </div>
        {featured && <div className="stk-apr"><small>AUTISTIK pool</small><b>{featured.apr != null ? `${featured.apr.toFixed(1)}% APR` : featured.live ? "Earning" : "Starting soon"}</b><small>paid in {featured.reward.symbol}</small></div>}
      </section>

      {!me && (
        <div className="stk-connect">
          {signer.loginEmbedded && <button type="button" className="btn primary" onClick={signer.loginEmbedded}>Use AUTISTIK wallet</button>}
          <button type="button" className={signer.loginEmbedded ? "btn" : "btn primary"} onClick={signer.loginExternal ?? signer.login}>Connect my wallet</button>
        </div>
      )}

      <div className="sm-tabs" role="tablist">
        {(["pools", "mine", "create"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => { setTab(t); if (t !== "create") load(); }}>
            {t === "pools" ? "All pools" : t === "mine" ? "My stakes" : "Create a pool"}
          </button>
        ))}
      </div>

      {err && <div className="notice warn">{err}</div>}
      {note && <div className={"aw-risk " + (note.ok ? "ok" : "danger")}>{note.text}</div>}
      {tab === "create" ? (
        <CreatePool signer={signer} data={data} onDone={load} />
      ) : !data ? <div className="muted">Loading pools…</div>
        : !data.contract ? <div className="notice">Staking opens soon. The team is switching it on.</div>
        : !shown.length ? <div className="muted">{tab === "mine" ? "You haven't staked yet. Pick a pool in All pools." : "No pools yet. Token teams: open the first one in Create a pool."}</div>
        : (
          <div className="stk-list">
            {shown.map((p) => <PoolCard key={p.id} p={p} me={me} admin={!!start.admin} claiming={claiming === p.id} onClaim={() => claim(p)} onOpen={(kind) => me ? setOpen({ pool: p, kind }) : (signer.loginEmbedded ?? signer.login)()} onHide={load} />)}
          </div>
        )}

      {open && data?.contract && (
        <Sheet title={open.kind === "stake" ? `Stake ${open.pool.stake.symbol}` : open.kind === "withdraw" ? `Withdraw ${open.pool.stake.symbol}` : open.kind === "rewards" ? `Add ${open.pool.reward.symbol} rewards` : "Manage pool"} onClose={() => setOpen(null)}>
          <Action kind={open.kind} p={open.pool} contract={data.contract} signer={signer} onDone={() => { load(); }} />
        </Sheet>
      )}

      <p className="muted" style={{ fontSize: ".82em" }}>
        Your tokens stay in the AUTISTIK Staking contract under your own wallet: only you can withdraw them, and nobody (not the pool&apos;s team, not AUTISTIK) can move them.
        Rewards are paid out evenly over each pool&apos;s reward period, split by how much everyone has staked. APR changes as people join and leave. Never share your seed phrase or private key.
      </p>
    </div>
  );
}

function PoolCard({ p, me, admin, claiming, onClaim, onOpen, onHide }: { p: PoolView; me: string | null; admin: boolean; claiming: boolean; onClaim: () => void; onOpen: (k: "stake" | "withdraw" | "rewards" | "manage") => void; onHide: () => void }) {
  const [copied, setCopied] = useState(false);
  const isCreator = !!me && getAddress(me) === p.creator;
  const m = p.mine;
  const now = Date.now() / 1000;
  return (
    <div className={"stk-card" + (p.featured ? " featured" : "")}>
      <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
        <Logo t={{ symbol: p.stake.symbol, logo: p.stake.logo }} size={40} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b>Stake {p.stake.symbol}</b>
          <small>Earn {p.reward.symbol}{p.featured ? " from platform fees" : ""}</small>
        </div>
        {p.featured ? <span className="stk-tag gold">Official</span> : p.hidden ? <span className="stk-tag">Hidden</span> : <span className="stk-tag">Community</span>}
      </div>
      <div className="stk-nums">
        <div><span>APR</span><b className="gold">{p.apr != null ? `${p.apr >= 1000 ? Math.round(p.apr).toLocaleString() : p.apr.toFixed(1)}%` : p.live ? "Earning" : "–"}</b></div>
        <div><span>Total staked</span><b>{p.tvlUsd != null ? usd(p.tvlUsd) : `${amt(p.totalStakedNum)}`}</b></div>
        <div><span>Lock</span><b>{days(p.lockDays)}</b></div>
        <div><span>Rewards left</span><b>{p.live ? `${amt(p.rewardsLeft)} ${p.reward.symbol}` : "None yet"}</b></div>
      </div>
      {m && (m.stakedNum > 0 || m.earnedNum > 0) && (
        <div className="stk-mine">
          <div><span>You staked</span><b>{amt(m.stakedNum)} {p.stake.symbol}</b></div>
          <div><span>You earned</span><b className="up">{amt(m.earnedNum)} {p.reward.symbol}</b></div>
          {p.lockDays > 0 && m.unlockAt > now && <div><span>Unlocks</span><b>{when(m.unlockAt)}</b></div>}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary grow" onClick={() => onOpen("stake")}>Stake</button>
        {m && m.stakedNum > 0 && <button type="button" className="btn" onClick={() => onOpen("withdraw")}>Withdraw</button>}
        {m && m.earnedNum > 0 && <button type="button" className="btn" disabled={claiming} onClick={onClaim}>{claiming ? "Collecting…" : "Collect"}</button>}
      </div>
      <div className="row stk-links">
        <button type="button" className="linkish" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/stake?pool=${p.id}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}>{copied ? "Link copied" : "Share link"}</button>
        {isCreator && <><button type="button" className="linkish" onClick={() => onOpen("rewards")}>Add rewards</button><button type="button" className="linkish" onClick={() => onOpen("manage")}>Manage</button></>}
        {admin && <button type="button" className="linkish" onClick={() => post("hide", { chain: "bsc", id: p.id, hidden: !p.hidden }).then(onHide).catch(() => {})}>{p.hidden ? "Show pool" : "Hide pool"}</button>}
        <span className="muted">Pool #{p.id}</span>
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="sm-sheet-bg" onClick={onClose}>
      <div className="sm-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}><b>{title}</b><button type="button" className="btn small" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

/** Sends one contract call from the member's wallet and waits for it. */
async function sendTx(signer: Signer, to: string, data: `0x${string}`, value = 0n) {
  const h = await signer.evm!.send(c.chainId!, { to: getAddress(to), data, value: value.toString() });
  await waitEvm(c, h);
  return h;
}
/** Approve exactly `amount` (never unlimited) if the current allowance is lower. */
async function approveExact(signer: Signer, token: string, spender: string, amount: bigint) {
  const have: bigint = await pc().readContract({ address: getAddress(token), abi: erc20Abi, functionName: "allowance", args: [signer.evm!.address, getAddress(spender)] });
  if (have >= amount) return;
  await sendTx(signer, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(spender), amount] }));
}

function Action({ kind, p, contract, signer, onDone }: { kind: "stake" | "withdraw" | "rewards" | "manage"; p: PoolView; contract: string; signer: Signer; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState("");
  const [funder, setFunder] = useState("");
  const [bal, setBal] = useState<number | null>(null);
  const token = kind === "rewards" ? p.reward : p.stake;
  const native = token.address.toLowerCase() === NATIVE.toLowerCase();
  const now = Date.now() / 1000;
  const locked = kind === "withdraw" && p.lockDays > 0 && !!p.mine && p.mine.unlockAt > now;

  useEffect(() => {
    if (kind === "withdraw") { setBal(p.mine?.stakedNum ?? 0); return; }
    if (kind === "stake") { setBal(p.mine?.balanceNum ?? null); return; }
    if (kind === "rewards" && signer.evm) {
      (native ? pc().getBalance({ address: signer.evm.address }) : pc().readContract({ address: getAddress(token.address), abi: erc20Abi, functionName: "balanceOf", args: [signer.evm.address] }))
        .then((b: bigint) => setBal(Number(b) / 10 ** token.decimals)).catch(() => {});
    }
  }, [kind, p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(fn: () => Promise<void>, ok: string) {
    setErr(""); setDone("");
    try { await fn(); setDone(ok); setAmount(""); onDone(); }
    catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }
  const raw = () => { const r = toUnits(amount || "", token.decimals); if (!r || r <= 0n) throw new Error("Enter an amount."); return r; };

  if (kind === "manage") return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>Let another wallet add rewards to this pool, for example your team&apos;s fee or marketing wallet. It can only add rewards; it can&apos;t take anything out.</p>
      <input value={funder} onChange={(e) => setFunder(e.target.value.trim())} placeholder="Wallet address (0x…)" spellCheck={false} />
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={!isAddress(funder) || !!step} onClick={() => run(async () => { setStep("Confirm in your wallet…"); await sendTx(signer, contract, encodeFunctionData({ abi: STAKING_ABI, functionName: "setFunder", args: [BigInt(p.id), getAddress(funder), true] })); }, "That wallet can now add rewards.")}>Allow</button>
        <button type="button" className="btn" disabled={!isAddress(funder) || !!step} onClick={() => run(async () => { setStep("Confirm in your wallet…"); await sendTx(signer, contract, encodeFunctionData({ abi: STAKING_ABI, functionName: "setFunder", args: [BigInt(p.id), getAddress(funder), false] })); }, "Removed.")}>Remove</button>
      </div>
      {step && <div className="aw-step"><span className="aw-spin" />{step}</div>}
      {err && <div className="aw-risk danger">{err}</div>}{done && <div className="aw-risk ok">{done}</div>}
    </div>
  );

  const go = () => {
    if (kind === "stake") return run(async () => {
      const r = raw();
      setStep(`Step 1 of 2: allow staking of your ${token.symbol}…`);
      await approveExact(signer, token.address, contract, r);
      setStep("Step 2 of 2: confirm the stake…");
      await sendTx(signer, contract, encodeFunctionData({ abi: STAKING_ABI, functionName: "stake", args: [BigInt(p.id), r] }));
    }, `Staked. You start earning ${p.reward.symbol} now.`);
    if (kind === "withdraw") return run(async () => {
      const r = raw();
      setStep("Confirm in your wallet…");
      const all = p.mine && r >= BigInt(p.mine.staked);
      await sendTx(signer, contract, all
        ? encodeFunctionData({ abi: STAKING_ABI, functionName: "exit", args: [BigInt(p.id)] })
        : encodeFunctionData({ abi: STAKING_ABI, functionName: "withdraw", args: [BigInt(p.id), r] }));
    }, "Withdrawn to your wallet.");
    return run(async () => {
      const r = raw();
      if (!native) { setStep(`Step 1 of 2: allow ${token.symbol}…`); await approveExact(signer, token.address, contract, r); }
      setStep(native ? "Confirm in your wallet…" : "Step 2 of 2: add the rewards…");
      await sendTx(signer, contract, encodeFunctionData({ abi: STAKING_ABI, functionName: "addRewards", args: [BigInt(p.id), native ? 0n : r] }), native ? r : 0n);
    }, `Added. They're paid out to stakers over the next ${p.durationDays} days.`);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      {kind === "rewards" && <p className="muted" style={{ margin: 0 }}>Rewards are paid out evenly over {p.durationDays} days to everyone staked, starting now. Anything left from before rolls in.{p.featured ? " Tip: share a part of this week's trading fees here." : ""}</p>}
      <div className="tx-field">
        <div className="row tx-field-top"><span>Amount</span>{bal != null && <span>{kind === "withdraw" ? "Staked" : "Available"} <b>{amt(bal)} {token.symbol}</b></span>}</div>
        <div className="row tx-field-mid">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.00" aria-label="Amount" />
          <span className="tx-unit">{token.symbol}</span>
        </div>
      </div>
      {bal != null && bal > 0 && <div className="tx-parts">{[25, 50, 100].map((x) => <button key={x} type="button" onClick={() => {
        // Max uses the exact on-chain amount, so nothing is left behind by rounding.
        const exact = kind === "withdraw" ? p.mine?.staked : kind === "stake" ? p.mine?.balance : null;
        if (x === 100 && exact) { setAmount(formatUnits(BigInt(exact), token.decimals)); return; }
        const v = bal * x / 100 * (native && x === 100 ? 0.98 : 1); // keep a little BNB for the network fee
        setAmount(String(Math.floor(v * 1e8) / 1e8));
      }}>{x === 100 ? "Max" : `${x}%`}</button>)}</div>}
      {kind === "stake" && p.lockDays > 0 && <div className="aw-risk warn">Locked for {days(p.lockDays)} after each stake. You can&apos;t withdraw before then (rewards keep coming).</div>}
      {locked && <div className="aw-risk warn">Your stake unlocks on {when(p.mine!.unlockAt)}.</div>}
      {step ? <div className="aw-step"><span className="aw-spin" />{step}</div>
        : <button type="button" className="tx-cta buy" disabled={!amount || locked} onClick={go}>{kind === "stake" ? `Stake ${token.symbol}` : kind === "withdraw" ? "Withdraw" : "Add rewards"}</button>}
      {err && <div className="aw-risk danger">{err}</div>}
      {done && <div className="aw-risk ok">{done}</div>}
    </div>
  );
}

/** For token teams: open a staking pool for your token in two steps. */
function CreatePool({ signer, data, onDone }: { signer: Signer; data: Data | null; onDone: () => void }) {
  const [addr, setAddr] = useState(""); const [info, setInfo] = useState<TokenInfo | null>(null); const [infoErr, setInfoErr] = useState("");
  const [rewardKind, setRewardKind] = useState<"same" | "bnb" | "other">("same");
  const [rewardAddr, setRewardAddr] = useState("");
  const [lock, setLock] = useState(7); const [period, setPeriod] = useState(30);
  const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [made, setMade] = useState<number | null>(null);

  useEffect(() => {
    setInfo(null); setInfoErr("");
    if (!isAddress(addr)) return;
    walletApi<{ token: TokenInfo }>("token", { chain: "bsc", address: addr }).then((d) => setInfo(d.token)).catch((e) => setInfoErr(e.message));
  }, [addr]);

  const reward = rewardKind === "same" ? addr : rewardKind === "bnb" ? NATIVE : rewardAddr;
  const fee = BigInt(data?.createFee || "0");
  const ready = !!data?.contract && !!info && isAddress(reward || "x") && !!signer.evm && !step;

  async function create() {
    if (!data?.contract || !signer.evm) return;
    setErr("");
    try {
      setStep("Confirm in your wallet…");
      const h = await signer.evm.send(c.chainId!, { to: getAddress(data.contract), value: fee.toString(), data: encodeFunctionData({ abi: STAKING_ABI, functionName: "createPool", args: [getAddress(addr), getAddress(reward), BigInt(lock * DAY), BigInt(period * DAY)] }) });
      setStep("Waiting for the network…");
      await waitEvm(c, h);
      const rc = await pc().getTransactionReceipt({ hash: h });
      let id: number | null = null;
      for (const l of rc.logs) { try { const ev: any = decodeEventLog({ abi: STAKING_ABI, data: l.data, topics: l.topics }); if (ev.eventName === "PoolCreated") id = Number(ev.args.id); } catch { /* other log */ } }
      setMade(id); onDone();
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }

  if (made != null) return (
    <div className="stk-card stack" style={{ gap: 10 }}>
      <b>Your pool is open (#{made})</b>
      <p className="muted" style={{ margin: 0 }}>Next: add rewards from the pool card (Add rewards), then share this link with your community so they can stake:</p>
      <code style={{ wordBreak: "break-all" }}>{typeof location !== "undefined" ? `${location.origin}/stake?pool=${made}` : ""}</code>
    </div>
  );

  return (
    <div className="stk-card stack" style={{ gap: 12 }}>
      <b>Open a staking pool for your token</b>
      <small className="muted">Your holders stake your token and earn the rewards you add. You can never touch their staked tokens. BNB Chain only for now.</small>
      <label className="field"><span>1. Your token&apos;s address</span>
        <input value={addr} onChange={(e) => setAddr(e.target.value.trim())} placeholder="0x…" spellCheck={false} autoComplete="off" />
      </label>
      {infoErr && <small className="down">{infoErr}</small>}
      {info && <div className="row" style={{ gap: 8 }}><Logo t={info} size={28} /><b>{info.symbol}</b><small className="muted">{info.name}{info.risk.honeypot ? " · looks like a honeypot" : ""}</small></div>}
      <div className="field"><span>2. Rewards paid in</span>
        <div className="stk-seg">
          {(["same", "bnb", "other"] as const).map((k) => <button key={k} type="button" className={rewardKind === k ? "on" : ""} onClick={() => setRewardKind(k)}>{k === "same" ? (info?.symbol || "Same token") : k === "bnb" ? "BNB" : "Other token"}</button>)}
        </div>
        {rewardKind === "other" && <input value={rewardAddr} onChange={(e) => setRewardAddr(e.target.value.trim())} placeholder="Reward token address (0x…)" spellCheck={false} />}
      </div>
      <div className="field"><span>3. Lock after each stake</span>
        <div className="stk-seg">{LOCKS.map((d) => <button key={d} type="button" className={lock === d ? "on" : ""} onClick={() => setLock(d)}>{d === 0 ? "None" : `${d}d`}</button>)}</div>
      </div>
      <div className="field"><span>4. Pay rewards out over</span>
        <div className="stk-seg">{PERIODS.map((d) => <button key={d} type="button" className={period === d ? "on" : ""} onClick={() => setPeriod(d)}>{d}d</button>)}</div>
      </div>
      {fee > 0n && <small className="muted">Opening a pool costs {Number(fee) / 1e18} BNB.</small>}
      {!signer.evm && <div className="notice">Connect your team wallet first (the button at the top).</div>}
      {!data?.contract && <div className="notice">Staking opens soon.</div>}
      {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : <button type="button" className="tx-cta buy" disabled={!ready} onClick={create}>Open the pool</button>}
      {err && <div className="aw-risk danger">{err}</div>}
    </div>
  );
}
