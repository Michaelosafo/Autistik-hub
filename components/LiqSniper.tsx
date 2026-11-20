"use client";
/**
 * ⚡ SniperBnbSol (net "bsc"): paste a BSC token, tick one or more BNB Chain wallets; they all buy with USDT the
 * moment PancakeSwap liquidity lands. 🎯 SniperLobbySol (net "solana"): the same for a Solana mint, through Jupiter,
 * from each wallet's Solana address. Each page shows and saves only its own chain's tokens.
 */
import { useEffect, useState } from "react";

type Target = { token: string; chain?: string; pay?: string; amount?: number; amounts?: Record<string, number>; prio?: string; label?: string; usd?: number; on?: boolean; state?: "waiting" | "done" | "failed"; added?: string; wallets?: number[]; fired?: number[]; first_at?: string };
type S = { liq_targets?: Target[]; liq_x?: number; liq_sell_pct?: number; liq_slip?: number; liq_tp_on?: boolean; snipe_usd?: number; copy_key_usd?: Record<string, number>; snipe_amounts?: Record<string, Record<string, number>>; enabled: boolean; mode: string; last_note?: string | null };
type Hit = { id: string; name: string; symbol: string; hasCode: boolean; hasPool: boolean; liquidityUsd: number };
type Ready = { slot: number; address: string | null; balance: number | null; gas?: number; gasNeed?: number; unit: string; need: number; ok: boolean; reason: string };
const gasOk = (w: Ready) => w.gas == null || w.gas + 1e-12 >= (w.gasNeed || 0);
// "$175", "175 usd", "1,175" → 175 / 1175 (anything that isn't a digit or a dot is dropped).
const num = (v: unknown) => { const x = Number(String(v ?? "").replace(/,/g, "").replace(/[^0-9.]/g, "")); return isFinite(x) && x > 0 ? x : 0; };
const short = (a: string) => a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 4)}…${a.slice(-4)}`;
const CHAIN_NAME: Record<string, string> = { bsc: "BNB Chain", ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", solana: "Solana" };
const unitOfT = (t: Target) => t.pay === "usdt" ? "USDT" : t.pay === "usdc" ? "USDC" : t.chain === "solana" ? "SOL" : t.chain === "bsc" || !t.chain ? "BNB" : "ETH";
const EXPL: Record<string, string> = { bsc: "https://bscscan.com/token/", ethereum: "https://etherscan.io/token/", base: "https://basescan.org/token/", arbitrum: "https://arbiscan.io/token/", solana: "https://solscan.io/token/" };

const SOL_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;
async function ask<T>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/ai-futures/${action}?desk=liq`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong.");
  return d as T;
}

export default function LiqSniper({ s, busy, set, slots, part, net = "bsc" }: { s: S; busy: string; set: (b: any, done?: string) => Promise<void>; slots: number[]; part?: "targets" | "settings"; net?: "bsc" | "solana" }) {
  const sol = net === "solana";
  const NET = sol ? "Solana" : "BNB Chain", GAS = sol ? "SOL" : "BNB", DEX = sol ? "Raydium / pump.fun (via Jupiter)" : "PancakeSwap";
  const inNet = (t: Target) => (sol ? t.chain === "solana" : !t.chain || t.chain === "bsc");
  const [prio, setPrio] = useState<"low" | "med" | "high" | "max">("max");
  const [making, setMaking] = useState(0);
  const [reload, setReload] = useState(0);
  const [ca, setCa] = useState(""), [label, setLabel] = useState(""), [amt, setAmt] = useState(""), [err, setErr] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [chain, setChain] = useState("");
  // Snipes always spend USDT; BNB only pays the gas.
  const pay = "usdt" as "native" | "usdt";
  const setPay = (_p: "native" | "usdt") => {};
  const [ready, setReady] = useState<Ready[]>([]);
  // $ for one unit of what pays (BNB / ETH / SOL, or 1 for USDT / USDC), from the last balance check.
  const [price, setPrice] = useState(0);
  // Fees a wallet needs on top of the buy (from the server), and whether a balance check is still on its way.
  const [extra, setExtra] = useState(0);
  const [loadingReady, setLoadingReady] = useState(false);
  const [checking, setChecking] = useState(false);
  // Each wallet's amount for the token being added (typed or filled from its set amount for this chain).
  const [own, setOwn] = useState<Record<number, string>>({});
  // Wallets picked for the token being added (empty = all).
  // Wallets for the token being added: null = not chosen yet (required when you have more than one), "all", or a list.
  const [pick, setPick] = useState<number[] | "all" | null>(null);
  const pickList = Array.isArray(pick) ? pick : [];
  const [editing, setEditing] = useState<string | null>(null);
  // Set once you tick / untick a wallet yourself; until then the wallets that can pay are ticked for you.
  const [manual, setManual] = useState(false);
  const who = (w?: number[]) => (w && w.length && w.length < slots.length ? `wallet ${w.map((x) => `#${x}`).join(" + ")}` : "all wallets");
  const toggle = (list: number[], x: number) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x].sort((a, b) => a - b));
  // Only this page's chain is shown; the other sniper's tokens are kept as they are on every save.
  const list = (s.liq_targets || []).filter(inNet);
  const otherNet = (s.liq_targets || []).filter((t) => !inNet(t));
  const save = (next: Target[], done?: string) => set({ liq_targets: [...otherNet, ...next] }, done);
  const per = Number(s.snipe_usd || 5), x = Number(s.liq_x || 2), pct = Number(s.liq_sell_pct || 100), slip = Number(s.liq_slip || 20), tp = s.liq_tp_on !== false;
  // Each wallet's own $ per snipe (the same amounts as on the wallet cards below); none = the normal amount.
  const typed = num(amt);
  const hit = hits.find((h) => h.id === chain) || hits[0];
  const unit = "USDT";
  // Amounts here are in $: each wallet's set amount (wallet card → Buy amount) for this chain fills in.
  const preset = (slot: number) => (chain ? Number(s.snipe_amounts?.[String(slot)]?.[chain] || 0) : 0);
  const money = (n: number) => `$${n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n.toFixed(2)}`;
  const ownNum = (slot: number) => num(own[slot]);
  const spendOf = (slot: number) => ownNum(slot) || typed;
  const ownMap: Record<string, number> = {};
  for (const sl of slots) if (ownNum(sl) > 0) ownMap[String(sl)] = ownNum(sl);
  const ownKey = JSON.stringify(ownMap);

  useEffect(() => {
    // New chain or coin: each wallet starts from its set amount there, and wallets with one are ticked.
    const next: Record<number, string> = {};
    const withPreset: number[] = [];
    for (const sl of slots) { const v = preset(sl); next[sl] = v > 0 ? String(v) : ""; if (v > 0) withPreset.push(sl); }
    setOwn(next);
    setPick(withPreset.length ? withPreset : null);
    setManual(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, pay]);

  useEffect(() => {
    const raw = ca.trim();
    if (sol ? raw.startsWith("0x") || !SOL_RE.test(raw) : !/0x[0-9a-fA-F]{40}/.test(raw)) { setHits([]); setChain(""); setChecking(false); setReady([]); return; }
    setChecking(true);
    const t = setTimeout(() => {
      ask<{ hits: Hit[]; suggested: string | null }>("sniper-detect", { token: raw, net }).then((d) => {
        const next = d.hits || [];
        setHits(next);
        setChain((cur) => {
          if (cur && next.some((h) => h.id === cur)) return cur;
          const suggested = d.suggested || "";
          if (suggested !== cur) { setPay("native"); setPick(null); }
          return suggested;
        });
      }).catch(() => { setHits([]); setChain(""); }).finally(() => setChecking(false));
    }, 350);
    return () => clearTimeout(t);
  }, [ca]);

  useEffect(() => {
    if (!chain) { setReady([]); return; }
    let gone = false;
    setLoadingReady(true);
    const t = setTimeout(() => ask<{ wallets: Ready[]; price: number; extra?: number }>("sniper-ready", { chain, pay, amount: typed, slots, amounts: ownMap, usd: true }).then((d) => {
      if (gone) return;
      const wallets = d.wallets || [];
      setReady(wallets);
      setPrice(Number(d.price) || 0);
      setExtra(Number(d.extra) || 0);
      // Any wallet with an address on this chain can be ticked, funded or not (bridge to it before launch).
      const has = wallets.filter((w) => w.address).map((w) => w.slot);
      const funded = wallets.filter((w) => w.address && (w.balance || 0) > 0).map((w) => w.slot);
      setPick((cur) => {
        if (Array.isArray(cur)) { const keep = cur.filter((x) => has.includes(x)); return keep.length ? keep : null; }
        return funded.length === 1 ? funded : null;
      });
    }).catch(() => {}).finally(() => { if (!gone) setLoadingReady(false); }), 300);
    return () => { gone = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, pay, typed, ownKey, slots.join(","), reload]);

  // Auto-pick: once there's an amount and fresh balances, tick the wallets that can pay it (until you tick by hand).
  const canPay = ready.filter((w) => w.address && w.balance != null && price > 0 && spendOf(w.slot) > 0 && w.balance + 1e-12 >= spendOf(w.slot) / price + extra && gasOk(w)).map((w) => w.slot);
  const canKey = canPay.join(",");
  useEffect(() => {
    if (manual || loadingReady || !chain) return;
    if (canPay.length) setPick(canPay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canKey, manual, loadingReady, chain]);

  const add = () => {
    const m = sol ? (ca.trim().startsWith("0x") ? null : ca.trim().match(SOL_RE)) : ca.trim().match(/0x[0-9a-fA-F]{40}/);
    const a = m ? m[0] : "";
    if (!(price > 0)) { setErr(`Waiting for the ${unit} price. Try again in a moment.`); return; }
    if (!a || chain !== net) { setErr(sol ? "Paste a Solana token address (mint)." : "Paste a BNB Chain token address (0x…)."); return; }
    const dup = (t: string) => t.startsWith("0x") ? t.toLowerCase() === a.toLowerCase() : t === a;
    if (list.some((t) => dup(t.token))) { setErr("That token is already on the list."); return; }
    if (pickList.length === 0) { setErr("Tick the wallets that should buy it."); return; }
    const noAmt = pickList.filter((x) => !(spendOf(x) > 0));
    if (noAmt.length) { setErr(`Type how many $ ${noAmt.map((x) => `#${x}`).join(", ")} spend${noAmt.length === 1 ? "s" : ""} (its own box, or the amount for all).`); return; }
    const w = [...pickList];
    const amounts: Record<string, number> = {};
    // Dollars → the pay coin at today's price (what the buyer spends).
    const coinOf = (usd: number) => +(usd / price).toFixed(pay === "native" ? 8 : 4);
    for (const x of w) if (ownNum(x) > 0) amounts[String(x)] = coinOf(ownNum(x));
    const where = hit?.name || chain;
    const spends = w.map((x) => `#${x} ${money(spendOf(x))} (${coinOf(spendOf(x))} ${unit})`).join(", ");
    setErr(""); setCa(""); setLabel(""); setAmt(""); setHits([]); setChain(""); setOwn({});
    setPick(null);
    save([...list, { token: a, chain, pay, amount: typed > 0 ? coinOf(typed) : 0, amounts: Object.keys(amounts).length ? amounts : undefined, prio: sol ? prio : undefined, label: label.trim() || undefined, on: true, state: "waiting", added: new Date().toISOString(), wallets: w }],
      `Waiting on ${where} for ${label.trim() || short(a)}: ${spends}${s.enabled ? "" : " (press ▶ START)"}.`);
  };

  const listed = ready.filter((w) => w.address);
  const missing = ready.filter((w) => !w.address);
  const unsaved = !!chain && slots.some((x) => ownNum(x) !== preset(x));
  const saveAmounts = () => {
    const all = { ...(s.snipe_amounts || {}) };
    for (const x of slots) {
      const row = { ...(all[String(x)] || {}) };
      if (ownNum(x) > 0) row[chain] = ownNum(x); else delete row[chain];
      if (Object.keys(row).length) all[String(x)] = row; else delete all[String(x)];
    }
    set({ snipe_amounts: all }, `$ amounts saved for ${hit?.name || chain}. They fill in next time you paste a ${hit?.name || chain} token.`);
  };

  async function makeSol(slot: number) {
    setMaking(slot); setErr("");
    try { await ask("sniper-sol-create", { slot }); setReload((n) => n + 1); }
    catch (e) { setErr((e as Error).message); }
    finally { setMaking(0); }
  }
  async function importSol(slot: number) {
    const k = prompt(`Paste the private key of your own Solana wallet for wallet ${slot} (Phantom / Solflare: Settings → Manage accounts → Show private key). It's stored encrypted.`);
    if (!k?.trim()) return;
    setMaking(slot); setErr("");
    try { await ask("sniper-sol-import", { slot, key: k.trim() }); setReload((n) => n + 1); }
    catch (e) { setErr((e as Error).message); }
    finally { setMaking(0); }
  }

  return (
    <section className="card stack snp-card">
      {part !== "settings" && <>
      <b>🎯 Tokens to snipe · {NET} only</b>
      <small className="muted">Paste a {NET} token address, then tick one or more of your {NET} wallets. Every ticked wallet buys with USDT together the moment it can be bought on {DEX}.</small>
      <form className="stack" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" style={{ fontFamily: "monospace" }} placeholder={sol ? "Paste a Solana token address (mint)" : "Paste a BNB Chain token address (0x…)"} value={ca} onChange={(e) => { setCa(e.target.value); setErr(""); }} aria-label="Token address" autoComplete="off" spellCheck={false} />
        {(checking || hit) && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {checking && !hit && <span className="chip">Checking chain…</span>}
            {hit && <span className="chip" style={{ fontWeight: 700 }}>{hit.name}{hit.hasPool ? " · pool" : hit.hasCode ? " · contract" : ""}</span>}
            {hits.length > 1 && hits.map((h) => (
              <button key={h.id} type="button" className={"btn small" + (chain === h.id ? " primary" : " ghost")} onClick={() => { setChain(h.id); setPay("native"); setPick(null); }}>{h.name}</button>
            ))}
          </div>
        )}
        {!checking && ca.trim().length >= 32 && hits.length === 0 && <small className="aic-warn">{sol ? "That isn't a Solana token address." : "No contract or pool found on BNB Chain for that address. Check it's a BSC token."}</small>}
        {hit && (
          <>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input className="input" style={{ flex: "1 1 120px" }} placeholder="Name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} aria-label="Name" />
              <input className="input" style={{ flex: "0 1 140px" }} inputMode="decimal" placeholder="$" value={amt} onChange={(e) => { setAmt(e.target.value); setManual(false); if (num(e.target.value) > 0) setOwn({}); }} aria-label="Dollars for all wallets" />
              <small><b>$</b> each, paid in <b>USDT</b> <span className="muted">({GAS} only for fees; for wallets with no amount of their own)</span></small>
            </div>
            {sol && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <small><b>Priority fee:</b></small>
                {(["low", "med", "high", "max"] as const).map((p) => <button key={p} type="button" className={"btn small" + (prio === p ? " primary" : " ghost")} onClick={() => setPrio(p)}>{p}</button>)}
                <small className="muted">Max lands first (up to 0.005 SOL a buy).</small>
              </div>
            )}
            <div className="stack" style={{ gap: 4 }}>
              <small><b>Your wallets on {hit.name}</b> <span className="muted">({NET} wallets only. Tick as many as you want: they all snipe together. Fund each with USDT{sol ? " (SPL)" : " (BEP20)"} to buy, plus a little {GAS} for fees.)</span></small>
              {listed.length === 0 && missing.length === 0 && <small className="muted">Reading balances…</small>}
              {listed.map((w) => {
                const on = pickList.includes(w.slot);
                const spend = spendOf(w.slot);
                // Worked out here from the $ typed right now and the last balance, so an older answer can't say "No amount set".
                const needNow = price > 0 ? spend / price : 0;
                const okNow = spend > 0 && price > 0 && w.balance != null && w.balance + 1e-12 >= needNow + extra && gasOk(w);
                const status = !(spend > 0) ? "type an amount"
                  : w.balance == null ? (loadingReady ? "checking…" : `⚠ ${w.reason}`)
                  : !(price > 0) ? "checking…"
                  : okNow ? `✅ ready · ${+needNow.toFixed(2)} ${w.unit} + ${GAS} fees`
                  : w.balance + 1e-12 >= needNow + extra && !gasOk(w) ? `Needs ${w.gasNeed} ${GAS} for fees (has ${(w.gas || 0).toFixed(4)})`
                  : w.balance <= 0 ? `No ${w.unit} · send ${w.unit} in`
                  : `Needs ${(needNow + extra).toFixed(4)} ${w.unit} (≈ ${money((needNow + extra) * price)}) · lower the $ or send more ${w.unit}`;
                return (
                  <div key={w.slot} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <button type="button" className={"btn small" + (on ? " primary" : " ghost")} style={{ justifyContent: "flex-start", flex: "1 1 200px" }} onClick={() => { const next = toggle(pickList, w.slot); setManual(true); setPick(next.length ? next : null); }} aria-pressed={on}>
                      {on ? "☑" : "☐"} #{w.slot} · {w.balance == null ? `? ${w.unit}` : <>{price > 0 ? `${money(w.balance * price)} / ` : ""}{w.balance.toLocaleString("en-US", { maximumFractionDigits: 4 })} {w.unit}</>} · {short(w.address!)}
                    </button>
                    <input className="input" style={{ flex: "0 1 100px" }} inputMode="decimal" placeholder={typed > 0 ? `$${typed}` : "$"} value={own[w.slot] || ""} onChange={(e) => { setOwn({ ...own, [w.slot]: e.target.value }); setManual(false); }} aria-label={`Wallet ${w.slot} dollars`} />
                    <small className={okNow || !on ? "muted" : "aic-warn"}>{status}</small>
                  </div>
                );
              })}
              {listed.length > 1 && <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} onClick={() => { setManual(true); setPick(pickList.length === listed.length ? null : listed.map((w) => w.slot)); }}>{pickList.length === listed.length ? "Clear" : `Tick all ${listed.length}`}</button>}
              {unsaved && <button type="button" className="btn small ghost" style={{ alignSelf: "flex-start" }} disabled={!!busy} onClick={saveAmounts}>💾 Save these as each wallet&apos;s {hit.name} amount</button>}
              {missing.map((w) => (
                <div key={w.slot} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap", opacity: 0.8 }}>
                  <small>#{w.slot} · {w.reason}</small>
                  {sol && <>
                    <button type="button" className="btn small" disabled={!!busy || making === w.slot} onClick={() => makeSol(w.slot)}>{making === w.slot ? "Working…" : "＋ Create Solana address"}</button>
                    <button type="button" className="btn small ghost" disabled={!!busy || making === w.slot} onClick={() => importSol(w.slot)}>Import my Solana key</button>
                  </>}
                </div>
              ))}
              {pickList.some((x) => { const w = listed.find((y) => y.slot === x); return !w || w.balance == null || !(price > 0) || w.balance + 1e-12 < spendOf(x) / price + extra || !gasOk(w); }) && <small className="muted">A wallet that still has no funds when the pool opens is skipped. The others buy.</small>}
            </div>
            <button type="submit" className="btn primary" disabled={!!busy || !chain || pickList.length === 0 || pickList.some((x) => !(spendOf(x) > 0))}>{pickList.length ? `Snipe on ${hit.name} with ${pickList.map((x) => `#${x}${spendOf(x) > 0 ? ` ${money(spendOf(x))}` : ""}`).join(" + ")} (in ${unit})` : "Tick a wallet"}</button>
          </>
        )}
      </form>
      {err && <small className="aic-warn" role="alert">{err}</small>}
      {!list.length && <small className="muted">No tokens yet.</small>}
      {list.map((t) => {
        const st = t.state || "waiting";
        // Some picked wallets already bought, the rest are still trying.
        const part = st === "waiting" && (t.fired || []).length ? ` · ✅ ${t.fired!.map((x) => `#${x}`).join(" + ")} bought, rest trying` : "";
        return (
          <div key={t.token} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="chip">{st === "done" ? "✅ Bought" : st === "failed" ? "⚠ Stopped" : t.on === false ? "⏸ Paused" : s.enabled ? "⏳ Waiting" : "⏹ Stopped"} · {CHAIN_NAME[t.chain || "bsc"] || "BNB Chain"} · {t.label || short(t.token)}{t.amounts && Object.keys(t.amounts).length ? ` · ${(t.wallets && t.wallets.length ? t.wallets : slots).map((x) => `#${x} ${t.amounts?.[String(x)] || t.amount || "?"}`).join(", ")} ${unitOfT(t)}` : t.amount ? ` · ${t.amount} ${unitOfT(t)} · ${who(t.wallets)}` : t.usd ? ` · $${t.usd} · ${who(t.wallets)}` : ` · ${who(t.wallets)}`}{part}</span>
            {slots.length > 1 && <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => setEditing(editing === t.token ? null : t.token)}>Wallets</button>}
            <a className="muted" href={`${EXPL[t.chain || "bsc"] || EXPL.bsc}${t.token}`} target="_blank" rel="noreferrer"><small>Explorer</small></a>
            {st === "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => save(list.map((x) => (x === t ? { ...x, on: x.on === false } : x)))}>{t.on === false ? "Resume" : "Pause"}</button>}
            {st !== "waiting" && <button type="button" className="btn small" disabled={!!busy} onClick={() => { if (confirm(`Arm ${t.label || short(t.token)} again? It will buy again if it can be bought.`)) save(list.map((x) => (x === t ? { ...x, state: "waiting", on: true, fired: undefined, first_at: undefined } : x))); }}>Arm again</button>}
            <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => save(list.filter((x) => x !== t))}>Remove</button>
            {editing === t.token && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                <small>Snipe {t.label || short(t.token)} with:</small>
                {(() => {
                  const cur = t.wallets && t.wallets.length && t.wallets.length < slots.length ? t.wallets : []; // [] = all
                  const put = (next: number[]) => { const w = next.length && next.length < slots.length ? next : undefined; save(list.map((y) => (y === t ? { ...y, wallets: w } : y)), `${t.label || short(t.token)}: ${who(w)}.`); };
                  return <>
                    <button type="button" className={"btn small" + (cur.length === 0 ? " primary" : " ghost")} disabled={!!busy || cur.length === 0} onClick={() => put([])}>All</button>
                    {slots.map((x) => {
                      const on = cur.includes(x);
                      // From "All", a tap means only that wallet; after that, taps add / drop wallets (never none).
                      return <button key={x} type="button" className={"btn small" + (on ? " primary" : " ghost")} disabled={!!busy || (on && cur.length === 1)} onClick={() => put(cur.length === 0 ? [x] : toggle(cur, x))}>#{x}</button>;
                    })}
                  </>;
                })()}
              </div>
            )}
          </div>
        );
      })}
      {s.enabled && s.last_note ? <small className="muted">Now: {s.last_note}</small> : null}

      </>}
      {part !== "targets" && <>
      <b style={{ marginTop: part === "settings" ? 0 : 8 }}>💰 Buy and sell</b>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <small><b>Normal buy:</b> ${per} per wallet <span className="muted">(for wallets without their own amount)</span></small>
        <button type="button" className="btn small" disabled={!!busy} onClick={() => { const v = prompt(`$ a wallet spends per snipe when it has no amount of its own (paid in USDT; ${GAS} only for fees):`, String(per)); if (v != null && Number(v) >= 0.5) set({ snipe_usd: Number(v) }); }}>Change</button>
      </div>
      <label className="ait-check" style={{ margin: 0 }}>
        <input type="checkbox" checked={tp} disabled={!!busy} onChange={(e) => set({ liq_tp_on: e.target.checked }, e.target.checked ? `Sells at ${x}x by itself.` : "Auto-sell off: you sell yourself (buttons on each trade).")} />
        <span>Auto-sell for profit <small className="muted">{tp ? `(sells ${pct}% at ${x}x)` : "(off: you sell yourself)"}</small></span>
      </label>
      {tp && <>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <small><b>Sell at:</b></small>
          {[1.5, 2, 3, 5, 10].map((v) => <button key={v} type="button" className={"btn small" + (x === v ? " primary" : " ghost")} disabled={!!busy || x === v} onClick={() => set({ liq_x: v }, `Sells at ${v}x.`)}>{v}x</button>)}
          <button type="button" className="btn small ghost" disabled={!!busy} onClick={() => { const v = prompt("Sell when it's worth how many times what you paid (e.g. 2.5):", String(x)); if (v != null && Number(v) > 1) set({ liq_x: Number(v) }, `Sells at ${Number(v)}x.`); }}>Other…</button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <small><b>How much to sell then:</b></small>
          {[25, 50, 75, 100].map((v) => <button key={v} type="button" className={"btn small" + (pct === v ? " primary" : " ghost")} disabled={!!busy || pct === v} onClick={() => set({ liq_sell_pct: v }, v === 100 ? "Sells everything at the target." : `Sells ${v}% at the target; the rest rides (sell it yourself).`)}>{v}%</button>)}
        </div>
        <small className="muted">Selling 50% at 2x gets your money back and lets the rest ride for free.</small>
      </>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <small><b>Slippage:</b> {slip === 20 ? "Auto (20%)" : `${slip}%`}</small>
        {([["Auto", 20], ["10%", 10], ["30%", 30], ["49%", 49]] as const).map(([l, v]) => <button key={l} type="button" className={"btn small" + (slip === v ? " primary" : " ghost")} disabled={!!busy || slip === v} onClick={() => set({ liq_slip: v }, `Slippage ${l}.`)}>{l}</button>)}
      </div>
      <small className="muted">Launches move fast and many tokens have a buy tax: the slippage must be higher than the tax or the buy is refused (the test-run catches it, no gas spent). With MEV protection on, bots can&apos;t use a high slippage against you.</small>
      </>}
    </section>
  );
}
