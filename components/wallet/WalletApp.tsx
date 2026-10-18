"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, isAddress } from "viem";
import { FEE_PERCENT, IMPACT_BLOCK, IMPACT_CONFIRM, IMPACT_WARN, KYBER_ROUTER, MAX_SLIPPAGE_BPS, WCHAINS, WCHAIN_LIST, isNative, isTokenAddress,
  toUnits, type WChain, type WChainKey, type WToken } from "@/lib/wallet-chains";
import type { Signer } from "./types";

type Risk = { level: "ok" | "warn" | "danger" | "unknown"; notes: string[]; buyTax: number; sellTax: number; honeypot: boolean };
type TokenInfo = WToken & { priceUsd: number | null; risk: Risk };
type Holding = WToken & { raw: string; amount: number; priceUsd: number | null; valueUsd: number | null };
type Quote = { kind: string; chain: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string; inUsd: number | null; outUsd: number | null; impact: number | null; feeBps: number; gasUsd: number | null; route: any };
type Tab = "assets" | "swap" | "send" | "receive" | "security";

async function api<T = any>(action: string, body: unknown): Promise<T> {
  const r = await fetch(`/api/wallet/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
  return d;
}
const usd = (v: number | null | undefined) => v == null || !isFinite(v) ? "–" : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1000 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : v > 0 ? `$${v.toPrecision(2)}` : "$0";
const amt = (v: number) => !isFinite(v) || v === 0 ? "0" : v < 0.0001 ? v.toPrecision(3) : v < 1 ? v.toFixed(6).replace(/0+$/, "") : v < 10_000 ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : v.toLocaleString("en-US", { maximumFractionDigits: 0 });
const raw2num = (raw: string, d: number) => Number(BigInt(raw)) / 10 ** d;
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
/** Kept back for network fees when "Max" is pressed on the chain's own coin. */
const GAS_RESERVE: Record<WChainKey, string> = { bsc: "0.002", ethereum: "0.003", base: "0.0003", arbitrum: "0.0003", solana: "0.01" };
const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

function Logo({ t, size = 34 }: { t: { symbol: string; logo?: string | null }; size?: number }) {
  const [bad, setBad] = useState(false);
  return t.logo && !bad
    ? <img className="aw-logo" src={t.logo} alt="" width={size} height={size} onError={() => setBad(true)} />
    : <span className="aw-logo ph" style={{ width: size, height: size }}>{t.symbol.slice(0, 2).toUpperCase()}</span>;
}

/** The AUTISTIK Wallet screen: balances, swap any token, send and receive. Works with any Signer. */
export default function WalletApp({ signer, start }: { signer: Signer; start: { chain?: string; buy?: string } }) {
  const [chainKey, setChainKey] = useState<WChainKey>(start.chain && start.chain in WCHAINS ? (start.chain as WChainKey) : "bsc");
  const c = WCHAINS[chainKey];
  const [tab, setTab] = useState<Tab>(start.buy ? "swap" : "assets");
  const owner = c.kind === "solana" ? signer.sol?.address : signer.evm?.address;
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [custom, setCustom] = useState<WToken[]>([]);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [swapTo, setSwapTo] = useState<string | null>(start.buy || null);

  useEffect(() => { setCustom(store.get(`aw-tokens-${chainKey}`, [])); }, [chainKey]);
  const addCustom = (t: WToken) => setCustom((list) => {
    if (list.some((x) => x.address.toLowerCase() === t.address.toLowerCase()) || c.tokens.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) return list;
    const next = [...list, { address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logo }].slice(-25);
    store.set(`aw-tokens-${chainKey}`, next);
    return next;
  });

  const load = useCallback(async () => {
    if (!owner) { setHoldings(null); return; }
    setLoadErr("");
    try {
      const d = await api<{ holdings: Holding[] }>("balances", { chain: chainKey, owner, extra: store.get<WToken[]>(`aw-tokens-${chainKey}`, []).map((t) => t.address) });
      setHoldings(d.holdings);
    } catch (e: any) { setLoadErr(e.message); setHoldings((h) => h ?? []); }
  }, [chainKey, owner]);
  useEffect(() => { setHoldings(null); load(); }, [load]);

  const total = (holdings || []).reduce((s, h) => s + (h.valueUsd || 0), 0);
  const tokens: WToken[] = useMemo(() => {
    const m = new Map<string, WToken>();
    for (const t of [c.native, ...(holdings || []), ...c.tokens, ...custom]) if (!m.has(t.address.toLowerCase())) m.set(t.address.toLowerCase(), t);
    return [...m.values()];
  }, [c, holdings, custom]);
  const balanceOf = (a: string) => holdings?.find((h) => h.address.toLowerCase() === a.toLowerCase());

  if (!signer.ready) return <div className="card muted">Loading your wallet…</div>;
  if (!signer.active) return <Welcome signer={signer} />;

  const solMissing = c.kind === "solana" && !signer.sol;
  const evmMissing = c.kind === "evm" && !signer.evm;

  return (
    <div className="stack aw" style={{ gap: 14 }}>
      <section className="an-hero tone-green aw-top">
        <div className="an-hero-top">
          <div>
            <div className="an-kicker">AUTISTIK WALLET</div>
            <div className="aw-total">{holdings ? usd(total) : "…"}</div>
            <p>{owner ? <button type="button" className="aw-addr" onClick={() => navigator.clipboard?.writeText(owner)} title="Copy address">{short(owner)} ⧉</button> : "No address on this network"}{signer.label ? ` · ${signer.label}` : ""}</p>
          </div>
          <div className="an-live"><i />{c.name}</div>
        </div>
        <div className="net-pills" role="radiogroup" aria-label="Network">
          {WCHAIN_LIST.map((x) => <button key={x.key} type="button" role="radio" aria-checked={chainKey === x.key} className={"net-pill" + (chainKey === x.key ? " on" : "")}
            onClick={() => { setChainKey(x.key); setSwapFrom(null); setSwapTo(null); }}>{x.name}</button>)}
        </div>
        <div className="aw-actions">
          {([["swap", "⇄", "Swap"], ["send", "↑", "Send"], ["receive", "↓", "Receive"], ["assets", "◎", "Assets"], ["security", "🛡", "Security"]] as const).map(([k, icon, name]) => (
            <button key={k} type="button" className={"aw-act" + (tab === k ? " on" : "")} onClick={() => setTab(k)}><span>{icon}</span>{name}</button>
          ))}
        </div>
      </section>

      {(solMissing || evmMissing) && <div className="notice warn">{solMissing ? "Solana needs the built-in AUTISTIK wallet (or a wallet like Phantom connected through it)." : "Connect a wallet to use this network."}</div>}
      {loadErr && <div className="notice warn">Couldn&apos;t load balances: {loadErr} <button className="btn small" type="button" onClick={load}>Retry</button></div>}

      {tab === "assets" && <Assets c={c} holdings={holdings} onPick={(t) => { setSwapFrom(t.address); setSwapTo(null); setTab("swap"); }} onAdd={async (a) => {
        const d = await api<{ token: TokenInfo }>("token", { chain: chainKey, address: a });
        addCustom(d.token); setTimeout(load, 50);
        return d.token;
      }} />}
      {tab === "swap" && owner && <Swap key={chainKey} c={c} signer={signer} owner={owner} tokens={tokens} balanceOf={balanceOf} initialFrom={swapFrom} initialTo={swapTo} onAdd={addCustom} onDone={load} />}
      {tab === "send" && owner && <Send key={chainKey} c={c} signer={signer} owner={owner} holdings={holdings || []} onDone={load} />}
      {tab === "receive" && owner && <Receive c={c} address={owner} />}
      {tab === "security" && <Security signer={signer} />}
    </div>
  );
}

function Welcome({ signer }: { signer: Signer }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="an-hero tone-green">
        <div className="an-kicker">AUTISTIK WALLET · SELF-CUSTODY</div>
        <h1>Your own crypto wallet, built in</h1>
        <p>Buy, sell and swap any coin on BNB Chain, Base, Ethereum, Arbitrum and Solana, including tokens launched on AUTISTIK. {signer.mode === "privy" ? "Sign in with your email or Face ID: no seed phrase to write down, no app to install." : "Connect your wallet to start."}</p>
        <div className="an-actions"><button type="button" className="btn primary" onClick={signer.login}>{signer.mode === "privy" ? "Create or open my wallet" : "Connect wallet"}</button></div>
      </section>
      <div className="aw-why">
        <div className="card"><b>🔐 Only you control it</b><p className="muted">Your keys stay with you. AUTISTIK never holds your money, so there&apos;s no pile of funds on our side to steal.</p></div>
        <div className="card"><b>🔎 Best price, every DEX</b><p className="muted">Each swap searches every pool for the best price. A {FEE_PERCENT}% fee supports the AUTISTIK team.</p></div>
        <div className="card"><b>🛡 Scam protection</b><p className="muted">Honeypot and high-tax warnings before you buy, a preview of every trade, and limits on price slippage.</p></div>
      </div>
    </div>
  );
}

function Assets({ c, holdings, onPick, onAdd }: { c: WChain; holdings: Holding[] | null; onPick: (t: WToken) => void; onAdd: (a: string) => Promise<TokenInfo> }) {
  const [addr, setAddr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const list = (holdings || []).filter((h, i) => i === 0 || h.amount > 0 || c.tokens.some((t) => t.address === h.address)).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
  return (
    <section className="card stack" style={{ gap: 6 }}>
      <h2 style={{ margin: 0 }}>Assets on {c.name}</h2>
      {!holdings && <div className="muted">Loading balances…</div>}
      {list.map((h) => (
        <button key={h.address} type="button" className="aw-row" onClick={() => onPick(h)} title={`Swap ${h.symbol}`}>
          <Logo t={h} />
          <span className="grow"><b>{h.symbol}</b><small>{h.priceUsd != null ? usd(h.priceUsd) : h.name}</small></span>
          <span className="aw-num"><b>{amt(h.amount)}</b><small>{usd(h.valueUsd)}</small></span>
        </button>
      ))}
      <form className="aw-add" onSubmit={async (e) => {
        e.preventDefault(); setMsg(""); setBusy(true);
        try { const t = await onAdd(addr.trim()); setAddr(""); setMsg(`Added ${t.symbol}.`); } catch (er: any) { setMsg(er.message); }
        setBusy(false);
      }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={`Add a token: paste its ${c.name} address`} spellCheck={false} autoComplete="off" />
        <button className="btn small" disabled={busy || !isTokenAddress(c, addr.trim())}>{busy ? "Adding…" : "+ Add"}</button>
      </form>
      {msg && <small className="muted">{msg}</small>}
    </section>
  );
}

function TokenPicker({ c, tokens, value, onPick, onAdd, label, balanceOf }: {
  c: WChain; tokens: WToken[]; value: WToken | null; onPick: (t: WToken) => void; onAdd: (t: WToken) => void; label: string; balanceOf: (a: string) => Holding | undefined;
}) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const found = tokens.filter((t) => !q || t.symbol.toLowerCase().includes(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()) || t.address.toLowerCase() === q.toLowerCase());
  async function paste(a: string) {
    setErr(""); setBusy(true);
    try { const d = await api<{ token: TokenInfo }>("token", { chain: c.key, address: a }); onAdd(d.token); onPick(d.token); setOpen(false); setQ(""); }
    catch (e: any) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className="aw-pick" onClick={() => setOpen(true)} aria-label={label}>
        {value ? <><Logo t={value} size={24} /><b>{value.symbol}</b></> : <b>Select</b>}<span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="aw-sheet" role="dialog" aria-label={label} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="aw-sheet-in">
            <div className="row" style={{ justifyContent: "space-between" }}><b>{label}</b><button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button></div>
            <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); const v = e.target.value.trim(); if (isTokenAddress(c, v) && !tokens.some((t) => t.address.toLowerCase() === v.toLowerCase())) paste(v); }}
              placeholder="Search or paste any token address" spellCheck={false} autoComplete="off" />
            {busy && <small className="muted">Looking up token…</small>}
            {err && <small className="scan-err">{err}</small>}
            <div className="aw-list">
              {found.map((t) => { const h = balanceOf(t.address); return (
                <button key={t.address} type="button" className="aw-row" onClick={() => { onPick(t); setOpen(false); setQ(""); }}>
                  <Logo t={t} size={30} /><span className="grow"><b>{t.symbol}</b><small>{t.name}</small></span>
                  {h && h.amount > 0 && <span className="aw-num"><b>{amt(h.amount)}</b></span>}
                </button>
              ); })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RiskBox({ r, symbol }: { r: Risk; symbol: string }) {
  if (r.level === "ok") return <div className="aw-risk ok">✅ ${symbol} passed the safety checks.</div>;
  if (r.level === "unknown") return <div className="aw-risk warn">⚠️ No safety data for ${symbol} yet. New tokens are risky: start small.</div>;
  return <div className={"aw-risk " + r.level}>{r.level === "danger" ? "🚨" : "⚠️"} <b>${symbol}:</b><ul>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></div>;
}

/** Waits for an EVM transaction, from the browser. */
async function waitEvm(c: WChain, hash: `0x${string}`) {
  const pc = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
  const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== "success") throw new Error("The transaction failed on the network. No tokens were swapped (only the network fee was used).");
}
/** Signs a Solana transaction in the member's wallet, sends it, and waits for it to confirm. */
async function sendSol(signer: Signer, txBase64: string): Promise<string> {
  const signed = await signer.sol!.sign(txBase64);
  const { signature } = await api<{ signature: string }>("sol-send", { tx: signed });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { status } = await api<{ status: string }>("sol-status", { sig: signature }).catch(() => ({ status: "pending" }));
    if (status === "done") return signature;
    if (status === "failed") throw new Error("The transaction failed on Solana. Nothing was swapped.");
  }
  return signature;
}

function Swap({ c, signer, owner, tokens, balanceOf, initialFrom, initialTo, onAdd, onDone }: {
  c: WChain; signer: Signer; owner: string; tokens: WToken[]; balanceOf: (a: string) => Holding | undefined; initialFrom: string | null; initialTo: string | null; onAdd: (t: WToken) => void; onDone: () => void;
}) {
  const find = (a: string | null) => (a ? tokens.find((t) => t.address.toLowerCase() === a.toLowerCase()) ?? null : null);
  const [from, setFrom] = useState<WToken | null>(find(initialFrom) ?? c.native);
  const [to, setTo] = useState<WToken | null>(find(initialTo) ?? (initialTo ? null : c.tokens[0] ?? null));
  const [amount, setAmount] = useState("");
  const [infoTo, setInfoTo] = useState<TokenInfo | null>(null);
  const [infoFrom, setInfoFrom] = useState<TokenInfo | null>(null);
  const [q, setQ] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState(""); const [quoting, setQuoting] = useState(false);
  const [slip, setSlip] = useState<number | "auto">("auto");
  const [ack, setAck] = useState(false); const [review, setReview] = useState(false);
  const [step, setStep] = useState(""); const [done, setDone] = useState<{ hash: string } | null>(null); const [err, setErr] = useState("");
  const limit = store.get<number | null>("aw-limit", null);

  // A token from a link (?buy=0x…): look it up and select it.
  useEffect(() => {
    if (initialTo && !find(initialTo) && isTokenAddress(c, initialTo)) api<{ token: TokenInfo }>("token", { chain: c.key, address: initialTo }).then((d) => { onAdd(d.token); setTo(d.token); }).catch((e) => setQErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setInfoTo(null); if (to) api<{ token: TokenInfo }>("token", { chain: c.key, address: to.address }).then((d) => setInfoTo(d.token)).catch(() => {}); }, [c.key, to]);
  useEffect(() => { setInfoFrom(null); if (from) api<{ token: TokenInfo }>("token", { chain: c.key, address: from.address }).then((d) => setInfoFrom(d.token)).catch(() => {}); }, [c.key, from]);

  const rawIn = from ? toUnits(amount || "", from.decimals) : null;
  const bal = from ? balanceOf(from.address) : undefined;
  const tooMuch = !!(rawIn && bal && rawIn > BigInt(bal.raw));
  const tax = Math.max(infoTo?.risk.buyTax || 0, infoFrom?.risk.sellTax || 0);
  const stable = /USD/.test(from?.symbol || "") && /USD/.test(to?.symbol || "");
  const autoSlip = tax > 0 ? Math.min(MAX_SLIPPAGE_BPS, Math.ceil((tax + 2) * 100)) : stable ? 50 : 100;
  const slipBps = slip === "auto" ? autoSlip : slip;

  // Fresh quote after typing stops.
  const seq = useRef(0);
  useEffect(() => {
    setQ(null); setQErr(""); setAck(false); setReview(false);
    if (!from || !to || !rawIn || rawIn <= 0n) return;
    const id = ++seq.current; setQuoting(true);
    const t = setTimeout(() => {
      api<{ quote: Quote }>("quote", { chain: c.key, tokenIn: from.address, tokenOut: to.address, amount: rawIn.toString() })
        .then((d) => id === seq.current && setQ(d.quote)).catch((e) => id === seq.current && setQErr(e.message)).finally(() => id === seq.current && setQuoting(false));
    }, 550);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.key, from?.address, to?.address, amount]);

  const out = q && to ? raw2num(q.amountOut, to.decimals) : 0;
  const minOut = out * (1 - slipBps / 10_000);
  const impact = q?.impact ?? null;
  const danger = infoTo?.risk.level === "danger" || infoFrom?.risk.level === "danger";
  const blocked = infoTo?.risk.honeypot ? "This token looks like a honeypot (you couldn't sell it). Buying is blocked for your safety."
    : impact != null && impact >= IMPACT_BLOCK ? `This trade would move the price ${impact.toFixed(0)}%. Try a smaller amount.`
    : limit && q?.inUsd && q.inUsd > limit ? `This trade (${usd(q.inUsd)}) is over your limit of ${usd(limit)} per trade. Change it in Security.`
    : tooMuch ? `Not enough ${from?.symbol}.` : "";
  const needAck = danger || (impact != null && impact >= IMPACT_CONFIRM);

  function max() {
    if (!bal || !from) return;
    let r = BigInt(bal.raw);
    if (isNative(c, from.address)) { const keep = toUnits(GAS_RESERVE[c.key], from.decimals) || 0n; r = r > keep ? r - keep : 0n; }
    const s = (Number(r) / 10 ** from.decimals);
    setAmount(s > 0 ? String(Math.floor(s * 1e8) / 1e8) : "0");
  }

  async function go() {
    if (!q || !from || !to) return;
    setErr(""); setDone(null);
    try {
      if (c.kind === "solana") {
        setStep("Building your swap…");
        const { tx } = await api<{ tx: { kind: string; tx: string } }>("build", { chain: c.key, quote: q, from: owner, slippageBps: slipBps });
        setStep("Approve in your wallet…");
        const sig = await sendSol(signer, tx.tx);
        setDone({ hash: sig });
      } else {
        const ev = signer.evm!;
        setStep("Building your swap…");
        const { tx } = await api<{ tx: { to: `0x${string}`; data: `0x${string}`; value: string; spender: `0x${string}` | null } }>("build", { chain: c.key, quote: q, from: owner, slippageBps: slipBps });
        // Never send to a contract we don't expect, even if the server were tampered with.
        const allowed = [KYBER_ROUTER, c.v2Router].filter(Boolean).map((a) => getAddress(a!));
        if (!allowed.includes(getAddress(tx.to))) throw new Error("Unexpected swap contract. Stopped for your safety.");
        if (tx.spender) {
          const pc: any = createPublicClient({ chain: c.viem, transport: http(c.rpc) });
          const have: bigint = await pc.readContract({ address: from.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [ev.address, tx.spender] });
          if (have < BigInt(q.amountIn)) {
            // Exact amount only: no unlimited approvals left lying around.
            setStep(`Step 1 of 2: allow the swap to use ${amount} ${from.symbol}…`);
            const h = await ev.send(c.chainId!, { to: from.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [tx.spender, BigInt(q.amountIn)] }) });
            await waitEvm(c, h);
          }
          setStep("Step 2 of 2: confirm the swap in your wallet…");
        } else setStep("Confirm the swap in your wallet…");
        const hash = await ev.send(c.chainId!, { to: tx.to, data: tx.data, value: tx.value });
        setStep("Waiting for the network…");
        await waitEvm(c, hash);
        setDone({ hash });
      }
      setAmount(""); setReview(false); onDone();
    } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled it. Nothing was sent." : /insufficient funds|exceeds balance/i.test(m) ? `Not enough ${c.native.symbol} to pay the network fee.` : m.slice(0, 220));
    }
    setStep("");
  }

  return (
    <section className="card stack aw-swap" style={{ gap: 10 }}>
      <div className="aw-box">
        <div className="row aw-box-top"><small className="muted">You pay</small>{bal && <button type="button" className="aw-link" onClick={max}>Balance {amt(bal.amount)} · Max</button>}</div>
        <div className="row aw-box-mid">
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))} placeholder="0.0" aria-label="Amount to pay" />
          <TokenPicker c={c} tokens={tokens} value={from} onPick={(t) => { if (to && t.address === to.address) setTo(from); setFrom(t); }} onAdd={onAdd} label="Pay with" balanceOf={balanceOf} />
        </div>
        <small className="muted">{q?.inUsd ? usd(q.inUsd) : " "}</small>
      </div>
      <button type="button" className="aw-flip" aria-label="Switch" onClick={() => { setFrom(to); setTo(from); }}>⇅</button>
      <div className="aw-box">
        <div className="row aw-box-top"><small className="muted">You get (about)</small>{to && balanceOf(to.address) && <small className="muted">Balance {amt(balanceOf(to.address)!.amount)}</small>}</div>
        <div className="row aw-box-mid">
          <div className="aw-out">{quoting ? <span className="muted">Finding best price…</span> : q ? amt(out) : <span className="muted">0.0</span>}</div>
          <TokenPicker c={c} tokens={tokens} value={to} onPick={(t) => { if (from && t.address === from.address) setFrom(to); setTo(t); }} onAdd={onAdd} label="Receive" balanceOf={balanceOf} />
        </div>
        <small className="muted">{q?.outUsd ? usd(q.outUsd) : " "}</small>
      </div>

      {infoTo && to && !isNative(c, to.address) && <RiskBox r={infoTo.risk} symbol={to.symbol} />}
      {qErr && <div className="scan-err">{qErr}</div>}

      {q && to && from && (
        <div className="aw-details">
          <div><span>Rate</span><b>1 {from.symbol} ≈ {amt(out / Number(amount || 1))} {to.symbol}</b></div>
          <div><span>Price impact</span><b className={impact != null && impact >= IMPACT_WARN ? "down" : ""}>{impact == null ? "–" : `${impact.toFixed(2)}%`}</b></div>
          <div><span>Minimum you get</span><b>{amt(minOut)} {to.symbol}</b></div>
          <div><span>Slippage</span><span className="aw-slip">
            {(["auto", 50, 100, 300] as const).map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s === "auto" ? `Auto ${autoSlip / 100}%` : `${s / 100}%`}</button>)}
          </span></div>
          <div><span>AUTISTIK fee</span><b>{q.feeBps ? `${q.feeBps / 100}%` : "Free"}</b></div>
          {q.gasUsd != null && <div><span>Network fee</span><b>≈ {usd(q.gasUsd)}</b></div>}
          <div><span>Route</span><b>{q.kind === "kyber" ? "KyberSwap (all DEXs)" : q.kind === "jupiter" ? "Jupiter (all Solana DEXs)" : "PancakeSwap / Uniswap direct"}</b></div>
        </div>
      )}
      {impact != null && impact >= IMPACT_WARN && impact < IMPACT_BLOCK && <div className="aw-risk warn">⚠️ This trade moves the price {impact.toFixed(1)}%: you get noticeably less than the market price.</div>}
      {blocked && q && <div className="aw-risk danger">🚫 {blocked}</div>}
      {needAck && !blocked && q && <label className="row aw-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand the risks and want to continue.</label>}

      {!review ? (
        <button type="button" className="btn primary aw-go" disabled={!q || !!blocked || (needAck && !ack) || quoting} onClick={() => setReview(true)}>
          {!amount ? "Enter an amount" : quoting ? "Finding best price…" : blocked && q ? "Can't swap" : q ? "Review swap" : "Swap"}
        </button>
      ) : q && from && to && (
        <div className="aw-review stack">
          <b>Check before you confirm</b>
          <div className="aw-details">
            <div><span>You pay</span><b>{amount} {from.symbol}</b></div>
            <div><span>You get at least</span><b>{amt(minOut)} {to.symbol}</b></div>
            <div><span>Sent to</span><b>Your wallet {short(owner)}</b></div>
            <div><span>Network</span><b>{c.name}</b></div>
          </div>
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : (
            <div className="row" style={{ gap: 8 }}><button type="button" className="btn" onClick={() => setReview(false)}>Back</button><button type="button" className="btn primary grow" onClick={go}>Confirm swap</button></div>
          )}
        </div>
      )}
      {err && <div className="aw-risk danger">{err}</div>}
      {done && <div className="aw-risk ok">✅ Swap complete. <a href={`${c.explorer}/tx/${done.hash}`} target="_blank" rel="noopener noreferrer">View on {c.kind === "solana" ? "Solscan" : "explorer"} ↗</a></div>}
    </section>
  );
}

function Send({ c, signer, owner, holdings, onDone }: { c: WChain; signer: Signer; owner: string; holdings: Holding[]; onDone: () => void }) {
  const list = holdings.filter((h, i) => i === 0 || h.amount > 0);
  const [token, setToken] = useState<Holding | null>(list[0] ?? null);
  const [to, setTo] = useState(""); const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false); const [step, setStep] = useState(""); const [err, setErr] = useState(""); const [done, setDone] = useState<string | null>(null);
  const raw = token ? toUnits(amount || "", token.decimals) : null;
  const okAddr = c.kind === "solana" ? isTokenAddress(c, to.trim()) : isAddress(to.trim());
  const self = to.trim().toLowerCase() === owner.toLowerCase();
  const problem = !token ? "Nothing to send yet." : !okAddr && to ? `That isn't a ${c.name} address.` : self ? "That's your own address." : raw && raw > BigInt(token.raw) ? `Not enough ${token.symbol}.` : "";
  async function go() {
    if (!token || !raw) return;
    setErr(""); setDone(null);
    try {
      if (c.kind === "solana") {
        setStep("Building…");
        const { tx } = await api<{ tx: { tx: string } }>("sol-transfer", { chain: c.key, from: owner, to: to.trim(), mint: token.address, amount: raw.toString(), decimals: token.decimals });
        setStep("Approve in your wallet…");
        setDone(await sendSol(signer, tx.tx));
      } else {
        setStep("Approve in your wallet…");
        const dest = getAddress(to.trim());
        const hash = isNative(c, token.address)
          ? await signer.evm!.send(c.chainId!, { to: dest, value: raw.toString() })
          : await signer.evm!.send(c.chainId!, { to: token.address as `0x${string}`, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [dest, raw] }) });
        setStep("Waiting for the network…");
        await waitEvm(c, hash);
        setDone(hash);
      }
      setAmount(""); setReview(false); onDone();
    } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled it. Nothing was sent." : m.slice(0, 220));
    }
    setStep("");
  }
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>Send</h2>
      <label className="stack" style={{ gap: 4 }}><small className="muted">Token</small>
        <select value={token?.address || ""} onChange={(e) => setToken(list.find((h) => h.address === e.target.value) ?? null)}>
          {list.map((h) => <option key={h.address} value={h.address}>{h.symbol} · {amt(h.amount)}</option>)}
        </select>
      </label>
      <label className="stack" style={{ gap: 4 }}><small className="muted">To ({c.name} address)</small>
        <input value={to} onChange={(e) => { setTo(e.target.value); setReview(false); }} placeholder={c.kind === "solana" ? "Solana address" : "0x…"} spellCheck={false} autoComplete="off" />
      </label>
      <label className="stack" style={{ gap: 4 }}><small className="muted">Amount {token && <button type="button" className="aw-link" onClick={() => setAmount(String(Math.max(0, token.amount - (isNative(c, token.address) ? Number(GAS_RESERVE[c.key]) : 0))))}>Max</button>}</small>
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")); setReview(false); }} placeholder="0.0" />
      </label>
      {problem && <div className="scan-err">{problem}</div>}
      {!review ? <button type="button" className="btn primary" disabled={!!problem || !okAddr || !raw || raw <= 0n} onClick={() => setReview(true)}>Review</button> : token && (
        <div className="aw-review stack">
          <b>Check the address carefully</b>
          <div className="aw-details">
            <div><span>Sending</span><b>{amount} {token.symbol}</b></div>
            <div><span>To</span><b className="aw-break">{to.trim()}</b></div>
            <div><span>Network</span><b>{c.name}</b></div>
          </div>
          <small className="muted">Crypto sent to the wrong address or network can&apos;t be brought back. Make sure the receiver uses {c.name}.</small>
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : <div className="row" style={{ gap: 8 }}><button type="button" className="btn" onClick={() => setReview(false)}>Back</button><button type="button" className="btn primary grow" onClick={go}>Send now</button></div>}
        </div>
      )}
      {err && <div className="aw-risk danger">{err}</div>}
      {done && <div className="aw-risk ok">✅ Sent. <a href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View ↗</a></div>}
    </section>
  );
}

function Receive({ c, address }: { c: WChain; address: string }) {
  const [qr, setQr] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(() => { import("qrcode").then((m) => m.toDataURL(address, { margin: 1, width: 220 })).then(setQr).catch(() => {}); }, [address]);
  return (
    <section className="card stack aw-receive" style={{ gap: 10, alignItems: "center", textAlign: "center" }}>
      <h2 style={{ margin: 0 }}>Receive on {c.name}</h2>
      {qr && <img src={qr} alt={`QR code for your ${c.name} address`} width={220} height={220} className="aw-qr" />}
      <code className="aw-break">{address}</code>
      <button type="button" className="btn primary" onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "✓ Copied" : "Copy address"}</button>
      <div className="notice warn" style={{ textAlign: "left" }}>Only send <b>{c.name}</b> coins and tokens to this address. {c.kind === "evm" ? "The same address works on BNB Chain, Base, Ethereum and Arbitrum, but always pick the right network when withdrawing from an exchange." : "This is a Solana address: don't send BNB or ETH here."}</div>
    </section>
  );
}

function Security({ signer }: { signer: Signer }) {
  const [limit, setLimit] = useState<string>(() => String(store.get<number | null>("aw-limit", null) ?? ""));
  const [saved, setSaved] = useState(false);
  return (
    <section className="card stack" style={{ gap: 12 }}>
      <h2 style={{ margin: 0 }}>🛡 Security</h2>
      <ul className="aw-sec">
        <li>✅ <b>Self-custody:</b> only you can move your funds. AUTISTIK never holds your money or your keys.</li>
        <li>✅ <b>Every trade is previewed</b> and needs your approval. Swaps always pay out to your own wallet.</li>
        <li>✅ <b>Exact approvals only:</b> the swap contract can only use the amount you&apos;re swapping, never your whole balance.</li>
        <li>✅ <b>Scam checks</b> on every token before you buy. Honeypots are blocked.</li>
        <li>🚫 <b>Nobody from AUTISTIK will ever ask for your key, code or seed phrase.</b> Anyone who does is a scammer.</li>
      </ul>
      <label className="stack" style={{ gap: 4 }}><b>Limit per trade (USD)</b>
        <span className="row" style={{ gap: 8 }}>
          <input inputMode="decimal" value={limit} onChange={(e) => { setLimit(e.target.value.replace(/[^\d.]/g, "")); setSaved(false); }} placeholder="No limit" style={{ flex: 1 }} />
          <button type="button" className="btn small" onClick={() => { const n = Number(limit); store.set("aw-limit", limit && n > 0 ? n : null); setSaved(true); }}>Save</button>
        </span>
        <small className="muted">{saved ? "✓ Saved on this device." : "Trades above this amount are blocked on this device. Helpful if someone else uses your phone."}</small>
      </label>
      {signer.exportKey && (
        <div className="stack" style={{ gap: 6 }}>
          <b>Back up your wallet</b>
          <small className="muted">Your wallet already works on any device where you sign in. You can also copy your private key to use in another wallet app. Only do this somewhere private, and never share it.</small>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {signer.evm && <button type="button" className="btn small" onClick={() => signer.exportKey!("evm")}>Export BNB/ETH key</button>}
            {signer.sol && <button type="button" className="btn small" onClick={() => signer.exportKey!("solana")}>Export Solana key</button>}
          </div>
        </div>
      )}
      <button type="button" className="btn" onClick={signer.logout}>{signer.mode === "privy" ? "Log out of wallet" : "Disconnect"}</button>
    </section>
  );
}
