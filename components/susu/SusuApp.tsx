"use client";
import { pickWallet } from "@/lib/connect";
import { useCallback, useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, formatUnits, getAddress, http, parseUnits } from "viem";
import { bsc } from "viem/chains";
import { CHAINS } from "@/lib/launchpad";
import { DAY_SECONDS, ERC20_SUSU_ABI, SUSU_ABI, SUSU_ADDRESS, SUSU_LENGTHS, SUSU_MAX_DAILY, SUSU_MIN_DAILY, SUSU_TOKENS, susuToken } from "@/lib/susu";

const CREATE2 = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
type Row = { id: number; token: string; symbol: string; daily: bigint; totalDays: number; paidDays: number; day: number; due: number; saved: bigint; unlocksAt: number; withdrawn: boolean };
const pub = () => createPublicClient({ chain: bsc, transport: http(CHAINS.bsc.rpc) }) as any;
const money = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const date = (s: number) => new Date(s * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** AUTISTIK Susu: open a daily savings plan in USDT or BUSD, save each day, withdraw it all at the end. */
export default function SusuApp({ admin, signedIn }: { admin: boolean; signedIn: boolean }) {
  const [live, setLive] = useState<boolean | null>(null);
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ token: SUSU_TOKENS[0].address as string, daily: "5", days: 30, date: "" });
  // Your own end date: the plan runs until that day (7 days to 1 year from today).
  const dayStr = (d: number) => new Date(Date.now() + d * DAY_SECONDS * 1000).toISOString().slice(0, 10);
  const pickDate = (v: string) => {
    const days = Math.ceil((Date.parse(v + "T23:59:59") - Date.now()) / (DAY_SECONDS * 1000));
    setF((x) => ({ ...x, date: v, days: Math.min(365, Math.max(7, days || 7)) }));
  };

  useEffect(() => { pub().getCode({ address: SUSU_ADDRESS }).then((c: string) => setLive(!!c && c !== "0x")).catch(() => setLive(false)); }, []);

  async function wallet() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const w = createWalletClient({ chain: bsc, transport: custom(eth) }) as any;
    const [account] = await w.requestAddresses();
    try { await w.switchChain({ id: 56 }); } catch { await w.addChain({ chain: bsc }); await w.switchChain({ id: 56 }); }
    const a = getAddress(account);
    setMe(a);
    return { w, account: a, wpub: createPublicClient({ chain: bsc, transport: custom(eth) }) as any };
  }

  const load = useCallback(async (owner: `0x${string}`) => {
    const p = pub();
    const ids: bigint[] = await p.readContract({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "plansOf", args: [owner] });
    const out: Row[] = [];
    for (const id of ids) {
      const [pl, day, due, saved, unlocksAt] = await p.readContract({ address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "plan", args: [id] });
      out.push({ id: Number(id), token: pl.token, symbol: susuToken(pl.token)?.symbol ?? "USD", daily: pl.daily, totalDays: Number(pl.totalDays), paidDays: Number(pl.paidDays), day: Number(day), due: Number(due), saved, unlocksAt: Number(unlocksAt), withdrawn: pl.withdrawn });
    }
    setRows(out.reverse());
    // Remember the plans so the Hub can remind this member each day (only when signed in).
    if (signedIn && ids.length) fetch("/api/susu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: owner, ids: ids.map(Number) }) }).catch(() => {});
  }, [signedIn]);

  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || e);
      setMsg(/reject|denied/i.test(m) ? "You cancelled in your wallet." : /TooEarly/.test(m) ? "This plan hasn't ended yet." : /NothingDue/.test(m) ? "You've already saved for today." : /PlanEnded/.test(m) ? "This plan has ended: withdraw it." : /exceeds balance|insufficient/i.test(m) ? "Not enough in your wallet for that." : m.split("\n")[0]);
    } finally { setBusy(false); }
  }

  const connect = () => run(async () => { const { account } = await wallet(); await load(account); return ""; });

  // Approves up to `amount` for the Susu contract if needed (open: the whole plan, so daily saves need one tap each).
  async function allow(w: any, wpub: any, account: `0x${string}`, token: `0x${string}`, amount: bigint, label: string) {
    const have: bigint = await pub().readContract({ address: token, abi: ERC20_SUSU_ABI, functionName: "allowance", args: [account, SUSU_ADDRESS] });
    if (have >= amount) return;
    setMsg(`Step 1 of 2: allow Susu to take ${label} as you save (confirm in your wallet).`);
    const h = await w.writeContract({ account, chain: bsc, address: token, abi: ERC20_SUSU_ABI, functionName: "approve", args: [SUSU_ADDRESS, amount] });
    await wpub.waitForTransactionReceipt({ hash: h });
  }

  const open = () => run(async () => {
    const daily = Number(f.daily);
    if (!(daily >= SUSU_MIN_DAILY && daily <= SUSU_MAX_DAILY)) throw new Error(`Save between $${SUSU_MIN_DAILY} and $${SUSU_MAX_DAILY.toLocaleString()} a day.`);
    const { w, account, wpub } = await wallet();
    const t = susuToken(f.token)!;
    const per = parseUnits(String(daily), t.decimals);
    const bal: bigint = await pub().readContract({ address: t.address, abi: ERC20_SUSU_ABI, functionName: "balanceOf", args: [account] });
    if (bal < per) throw new Error(`You need at least ${daily} ${t.symbol} on BNB Chain for day 1.`);
    await allow(w, wpub, account, t.address, per * BigInt(f.days), `up to ${money(per * BigInt(f.days))} ${t.symbol}`);
    setMsg("Step 2 of 2: open your Susu and save day 1 (confirm in your wallet).");
    const h = await w.writeContract({ account, chain: bsc, address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "open", args: [t.address, per, BigInt(f.days)] });
    await wpub.waitForTransactionReceipt({ hash: h });
    await load(account);
    return `✅ Your ${f.days}-day Susu is open and day 1 is saved. Come back tomorrow${signedIn ? " (we'll remind you)" : ""}.`;
  });

  const save = (r: Row) => run(async () => {
    const { w, account, wpub } = await wallet();
    const amount = r.daily * BigInt(r.due);
    const bal: bigint = await pub().readContract({ address: r.token, abi: ERC20_SUSU_ABI, functionName: "balanceOf", args: [account] });
    if (bal < amount) throw new Error(`You need ${money(amount)} ${r.symbol} on BNB Chain.`);
    await allow(w, wpub, account, r.token as `0x${string}`, amount, `${money(amount)} ${r.symbol}`);
    setMsg(`Confirm in your wallet: save ${money(amount)} ${r.symbol}.`);
    const h = await w.writeContract({ account, chain: bsc, address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "save", args: [BigInt(r.id), BigInt(r.due)] });
    await wpub.waitForTransactionReceipt({ hash: h });
    await load(account);
    return `✅ Saved. ${r.paidDays + r.due} of ${r.totalDays} days done.`;
  });

  const withdraw = (r: Row) => run(async () => {
    const { w, account, wpub } = await wallet();
    setMsg(`Confirm in your wallet: withdraw ${money(r.saved)} ${r.symbol}.`);
    const h = await w.writeContract({ account, chain: bsc, address: SUSU_ADDRESS, abi: SUSU_ABI, functionName: "withdraw", args: [BigInt(r.id)] });
    await wpub.waitForTransactionReceipt({ hash: h });
    await load(account);
    return `✅ ${money(r.saved)} ${r.symbol} is back in your wallet. Well done!`;
  });

  const deploy = () => run(async () => {
    const { w, account, wpub } = await wallet();
    const { SUSU_INIT_CODE, SUSU_SALT } = await import("@/lib/susu-build");
    setMsg("Confirm in your wallet: this puts AUTISTIK Susu on BNB Chain (one network fee, no owner).");
    const h = await w.sendTransaction({ account, chain: bsc, to: CREATE2, data: concat([SUSU_SALT as `0x${string}`, SUSU_INIT_CODE as `0x${string}`]) });
    await wpub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
    const code = await pub().getCode({ address: SUSU_ADDRESS });
    if (!code || code === "0x") throw new Error("It didn't land at the expected address. Nothing else happened.");
    setLive(true);
    return `✅ Susu is live at ${short(SUSU_ADDRESS)}.`;
  });

  if (live === null) return <div className="card"><small className="muted">Loading…</small></div>;
  if (!live) return (
    <div className="card stack" style={{ gap: 8 }}>
      <b>Susu opens soon</b>
      <p className="muted" style={{ margin: 0 }}>Daily savings in USDT or BUSD on BNB Chain, released all at once at the end.</p>
      {admin && <button className="btn primary" type="button" disabled={busy} onClick={deploy} style={{ alignSelf: "flex-start" }}>Admin: deploy Susu on BNB Chain</button>}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );

  const t = susuToken(f.token)!;
  const daily = Number(f.daily) || 0;
  const endsOn = date(Date.now() / 1000 + f.days * DAY_SECONDS);
  const dueToday = (rows ?? []).filter((r) => !r.withdrawn && r.due > 0 && Date.now() / 1000 < r.unlocksAt);

  return (
    <div className="stack susu">
      {!me ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>Connect your wallet to start saving</b>
          <p className="muted" style={{ margin: 0 }}>You&apos;ll need USDT or BUSD on BNB Chain{signedIn ? "" : ". Sign in too, so we can remind you to save each day"}.</p>
          <button className="btn primary" type="button" disabled={busy} onClick={connect} style={{ alignSelf: "flex-start" }}>Connect wallet</button>
        </div>
      ) : (
        <small className="muted">Wallet <span className="mono">{short(me)}</span> · <button type="button" className="linkish" onClick={connect} disabled={busy}>Switch</button></small>
      )}

      {dueToday.length > 0 && (
        <div className="notice warn susu-due" role="status">
          <b>You haven&apos;t saved today.</b> {dueToday.map((r) => `${money(r.daily * BigInt(r.due))} ${r.symbol}`).join(" + ")} due. Keep your streak going!
        </div>
      )}

      <div className="susu-grid">
      <section className="card stack susu-new" style={{ gap: 14 }}>
        <div className="susu-head"><b>Start a Susu</b><small className="muted">Three choices, then confirm in your wallet.</small></div>
        <small className="susu-label"><i>1</i>Save in</small>
        <div className="hr-chips" role="radiogroup" aria-label="Stablecoin">
          {SUSU_TOKENS.map((x) => <button key={x.address} type="button" role="radio" aria-checked={f.token === x.address} className={f.token === x.address ? "on" : ""} onClick={() => setF({ ...f, token: x.address })}>{x.symbol}</button>)}
        </div>
        <small className="susu-label"><i>2</i>Every day</small>
        <div className="susu-amount">
          <input value={f.daily} onChange={(e) => setF({ ...f, daily: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" aria-label={`Amount to save every day in ${t.symbol}`} />
          <span>{t.symbol} a day</span>
        </div>
        <div className="hr-chips" aria-label="Quick amounts">
          {[1, 2, 5, 10, 20, 50].map((v) => <button key={v} type="button" className={Number(f.daily) === v ? "on" : ""} onClick={() => setF({ ...f, daily: String(v) })}>${v}</button>)}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <small className="susu-label"><i>3</i>For how long</small>
          <div className="hr-chips" role="radiogroup" aria-label="Length">
            {SUSU_LENGTHS.map((d) => <button key={d} type="button" role="radio" aria-checked={!f.date && f.days === d} className={!f.date && f.days === d ? "on" : ""} onClick={() => setF({ ...f, days: d, date: "" })}>{d === 30 ? "1 month" : d === 365 ? "1 year" : d === 90 ? "3 months" : d === 180 ? "6 months" : d === 60 ? "2 months" : `${d} days`}</button>)}
          </div>
          <label className={`susu-date${f.date ? " on" : ""}`}>
            <span>Or pick your own end date</span>
            <input type="date" value={f.date} min={dayStr(7)} max={dayStr(365)} onChange={(e) => e.target.value && pickDate(e.target.value)} />
            {f.date && <small>{f.days} days</small>}
          </label>
        </div>
        <button className="btn primary susu-go" type="button" disabled={busy || !daily} onClick={open}>{me ? `Start my Susu · save ${daily || 0} ${t.symbol} today` : "Connect wallet & start my Susu"}</button>
      </section>
      <aside className="card susu-sum" aria-label="Your plan">
        <small className="muted">Your plan</small>
        <b className="susu-total">{(daily * f.days).toLocaleString("en-US", { maximumFractionDigits: 2 })} <span>{t.symbol}</span></b>
        <small className="muted">saved by {endsOn}</small>
        <ul>
          <li><span>Every day</span><b>{daily || 0} {t.symbol}</b></li>
          <li><span>Days</span><b>{f.days}</b></li>
          <li><span>Today (day 1)</span><b>{daily || 0} {t.symbol}</b></li>
          <li><span>Released</span><b>{endsOn}</b></li>
          <li><span>Paid out</span><b>Automatically</b></li>
          <li><span>Fees</span><b>None</b></li>
        </ul>
        <p className="muted">Locked until {endsOn}. Nobody can take it out early, including you and AUTISTIK. On that day the AUTISTIK bot sends it all to your wallet automatically; you don&apos;t have to do anything.</p>
      </aside>
      </div>

      {rows && rows.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>My Susu plans</h3>
          {rows.map((r) => {
            const ended = Date.now() / 1000 >= r.unlocksAt;
            const pct = Math.round((r.paidDays / r.totalDays) * 100);
            return (
              <div key={r.id} className="card stack susu-plan" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>{money(r.daily)} {r.symbol} a day · {r.totalDays} days</b>
                  <small className="muted">{r.withdrawn ? "Paid out to your wallet" : ended ? "Ended · being sent to your wallet" : `Day ${r.day} of ${r.totalDays} · releases ${date(r.unlocksAt)}`}</small>
                </div>
                <div className="susu-bar" aria-label={`${r.paidDays} of ${r.totalDays} days saved`}><i style={{ width: `${pct}%` }} /></div>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span>Saved <b className="num">{money(r.saved)} {r.symbol}</b> · {r.paidDays}/{r.totalDays} days</span>
                  {r.withdrawn ? null : ended ? (
                    <button className="btn primary" type="button" disabled={busy} onClick={() => withdraw(r)}>Withdraw {money(r.saved)} {r.symbol}</button>
                  ) : r.due > 0 ? (
                    <button className="btn primary" type="button" disabled={busy} onClick={() => save(r)}>{r.due > 1 ? `Catch up ${r.due} days · ${money(r.daily * BigInt(r.due))} ${r.symbol}` : `Save today · ${money(r.daily)} ${r.symbol}`}</button>
                  ) : <small className="up">✓ Saved today</small>}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
