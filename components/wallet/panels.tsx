"use client";
import { useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi, getAddress, isAddress } from "viem";
import { FEE_PERCENT, WCHAINS, isNative, isTokenAddress, toUnits, type WChain, type WToken } from "@/lib/wallet-chains";
import type { Member, Signer } from "./types";
import { GAS_RESERVE } from "./MarketForm";
import { amt, api, friendlyError, Logo, sendSol, store, usd, waitEvm, type Holding, type TokenInfo, type Trade } from "./util";

/** First visit: pick the built-in AUTISTIK wallet or connect your own. */
export function Welcome({ signer, member }: { signer: Signer; member?: Member | null }) {
  const builtIn = !!signer.loginEmbedded;
  const ready = member?.evm || member?.sol;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="tx-welcome">
        <div className="an-kicker">AUTISTIK TRADE</div>
        <h1>Trade any token. Keep your own keys.</h1>
        <p>Buy and sell on BNB Chain, Base, Ethereum, Arbitrum and Solana at the best price across every DEX, including tokens launched on AUTISTIK.</p>
        <div className="tx-choose">
          <button type="button" className="tx-choice main" onClick={signer.loginEmbedded || signer.login} disabled={!builtIn}>
            <b>{ready ? "Open my AUTISTIK wallet" : "Use AUTISTIK wallet"}</b>
            <span>{!builtIn ? "Opening soon."
              : member ? `We'll email a code to ${member.email}. First time: you'll also add an authenticator app. No seed phrase.`
              : "Free for every member. Sign in or join with your email, and a wallet is made for you."}</span>
          </button>
          <button type="button" className="tx-choice" onClick={signer.loginExternal || signer.login}>
            <b>Connect my wallet</b>
            <span>MetaMask, Trust Wallet, OKX{builtIn ? ", Phantom" : ""} and more.</span>
          </button>
        </div>
      </section>
      {ready && (
        <div className="card aw-ready">
          <b>Your AUTISTIK wallet is ready</b>
          <p className="muted" style={{ margin: "4px 0 0" }}>Made for {member!.email} when you joined. Open it to see your balance, add funds and trade.</p>
          <dl className="aw-addrs">
            {member!.evm && <div><dt>BNB Chain, Base, Ethereum, Arbitrum</dt><dd className="mono">{member!.evm}</dd></div>}
            {member!.sol && <div><dt>Solana</dt><dd className="mono">{member!.sol}</dd></div>}
          </dl>
        </div>
      )}
      <div className="aw-why">
        <div className="card"><b>Only you control it</b><p className="muted">AUTISTIK never holds your money or your keys. Every trade needs your approval{builtIn ? " and a code from your authenticator app" : ""}.</p></div>
        <div className="card"><b>Best price, every DEX</b><p className="muted">Each order is routed across all pools. Trading fee {FEE_PERCENT}%.</p></div>
        <div className="card"><b>Scam protection</b><p className="muted">Honeypot and tax checks before you buy, price-impact limits and exact approvals.</p></div>
      </div>
    </div>
  );
}

export function Assets({ c, holdings, onPick, onAdd }: { c: WChain; holdings: Holding[] | null; onPick: (t: WToken) => void; onAdd: (a: string) => Promise<TokenInfo> }) {
  const [addr, setAddr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const list = (holdings || []).filter((h, i) => i === 0 || h.amount > 0 || c.tokens.some((t) => t.address === h.address)).sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
  return (
    <div className="stack" style={{ gap: 4 }}>
      {!holdings && <div className="tx-dim">Loading balances…</div>}
      {holdings && (
        <div className="tx-table" role="table" aria-label="Assets">
          <div className="tx-tr head" role="row"><span>Asset</span><span className="n">Amount</span><span className="n hide-sm">Price</span><span className="n">Value</span></div>
          {list.map((h) => (
            <button key={h.address} type="button" className="tx-tr" role="row" onClick={() => onPick(h)} title={`Trade ${h.symbol}`}>
              <span className="tx-asset"><Logo t={h} size={24} /><b>{h.symbol}</b></span>
              <span className="n">{amt(h.amount)}</span><span className="n hide-sm">{usd(h.priceUsd)}</span><span className="n">{usd(h.valueUsd)}</span>
            </button>
          ))}
        </div>
      )}
      <form className="aw-add" onSubmit={async (e) => {
        e.preventDefault(); setMsg(""); setBusy(true);
        try { const t = await onAdd(addr.trim()); setAddr(""); setMsg(`Added ${t.symbol}.`); } catch (er: any) { setMsg(er.message); }
        setBusy(false);
      }}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder={`Add a token by its ${c.name} address`} spellCheck={false} autoComplete="off" />
        <button className="btn small" disabled={busy || !isTokenAddress(c, addr.trim())}>{busy ? "Adding…" : "Add"}</button>
      </form>
      {msg && <small className="tx-dim">{msg}</small>}
    </div>
  );
}

export function History() {
  const [list, setList] = useState<Trade[]>([]);
  useEffect(() => { setList(store.get<Trade[]>("aw-history", [])); }, []);
  if (!list.length) return <div className="tx-dim">No trades yet on this device.</div>;
  return (
    <div className="tx-table" role="table" aria-label="Order history">
      <div className="tx-tr head" role="row"><span>Time</span><span>Side</span><span className="hide-sm">Paid</span><span className="n">Received</span></div>
      {list.map((t) => { const c = WCHAINS[t.chain as keyof typeof WCHAINS]; return (
        <a key={t.hash} className="tx-tr" role="row" href={`${c?.explorer}/tx/${t.hash}`} target="_blank" rel="noopener noreferrer">
          <span>{new Date(t.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span className={t.side === "buy" ? "up" : t.side === "sell" ? "down" : ""}>{t.side === "convert" ? "Convert" : t.side === "buy" ? "Buy" : "Sell"}</span>
          <span className="hide-sm">{t.pay}</span><span className="n">{t.get}</span>
        </a>
      ); })}
    </div>
  );
}

export function Send({ c, signer, owner, holdings, onDone }: { c: WChain; signer: Signer; owner: string; holdings: Holding[]; onDone: () => void }) {
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
        setStep("Preparing…");
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
    } catch (e: any) { setErr(friendlyError(e, c.native.symbol)); }
    setStep("");
  }
  return (
    <div className="stack" style={{ gap: 10, maxWidth: 520 }}>
      <label className="stack" style={{ gap: 4 }}><small className="tx-dim">Asset</small>
        <select value={token?.address || ""} onChange={(e) => setToken(list.find((h) => h.address === e.target.value) ?? null)}>
          {list.map((h) => <option key={h.address} value={h.address}>{h.symbol} · {amt(h.amount)}</option>)}
        </select>
      </label>
      <label className="stack" style={{ gap: 4 }}><small className="tx-dim">To ({c.name} address)</small>
        <input value={to} onChange={(e) => { setTo(e.target.value); setReview(false); }} placeholder={c.kind === "solana" ? "Solana address" : "0x…"} spellCheck={false} autoComplete="off" />
      </label>
      <label className="stack" style={{ gap: 4 }}><small className="tx-dim">Amount {token && <button type="button" className="aw-link" onClick={() => setAmount(String(Math.max(0, token.amount - (isNative(c, token.address) ? Number(GAS_RESERVE[c.key]) : 0))))}>Max</button>}</small>
        <input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")); setReview(false); }} placeholder="0.00" />
      </label>
      {problem && <div className="scan-err">{problem}</div>}
      {!review ? <button type="button" className="tx-cta" disabled={!!problem || !okAddr || !raw || raw <= 0n} onClick={() => setReview(true)}>Review</button> : token && (
        <div className="aw-review stack">
          <b>Check the address carefully</b>
          <div className="aw-details">
            <div><span>Sending</span><b>{amount} {token.symbol}</b></div>
            <div><span>To</span><b className="aw-break">{to.trim()}</b></div>
            <div><span>Network</span><b>{c.name}</b></div>
          </div>
          <small className="tx-dim">Crypto sent to the wrong address or network can&apos;t be brought back. Make sure the receiver uses {c.name}.</small>
          {step ? <div className="aw-step"><span className="aw-spin" />{step}</div> : <div className="row" style={{ gap: 8 }}><button type="button" className="btn" onClick={() => setReview(false)}>Back</button><button type="button" className="tx-cta grow" onClick={go}>Send now</button></div>}
        </div>
      )}
      {err && <div className="aw-risk danger">{err}</div>}
      {done && <div className="aw-risk ok">Sent. <a href={`${c.explorer}/tx/${done}`} target="_blank" rel="noopener noreferrer">View ↗</a></div>}
    </div>
  );
}

export function Receive({ c, address }: { c: WChain; address: string }) {
  const [qr, setQr] = useState(""); const [copied, setCopied] = useState(false);
  useEffect(() => { import("qrcode").then((m) => m.toDataURL(address, { margin: 1, width: 200 })).then(setQr).catch(() => {}); }, [address]);
  return (
    <div className="tx-receive">
      {qr && <img src={qr} alt={`QR code for your ${c.name} address`} width={180} height={180} className="aw-qr" />}
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <b>Deposit on {c.name}</b>
        <code className="aw-break">{address}</code>
        <button type="button" className="tx-cta" onClick={() => { navigator.clipboard?.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy address"}</button>
        <small className="tx-dim">Only send {c.name} coins and tokens here. {c.kind === "evm" ? "The same address works on BNB Chain, Base, Ethereum and Arbitrum: always pick the right network when withdrawing from an exchange." : "This is a Solana address: never send BNB or ETH here."}</small>
      </div>
    </div>
  );
}

export function Security({ signer }: { signer: Signer }) {
  const [limit, setLimit] = useState<string>(() => String(store.get<number | null>("aw-limit", null) ?? ""));
  const [saved, setSaved] = useState(false);
  return (
    <div className="stack" style={{ gap: 12, maxWidth: 620 }}>
      <ul className="aw-sec">
        <li><b>Self-custody.</b> Only you can move your funds. AUTISTIK never holds your money or keys.</li>
        {signer.mode === "privy" && signer.using === "embedded" && <li><b>Authenticator app: on.</b> Your AUTISTIK wallet asks for a 6-digit code from your app before it sends anything or shows its key.</li>}
        <li><b>Every trade is previewed</b> and needs your approval. Trades always pay out to your own wallet.</li>
        <li><b>Exact approvals only.</b> A trade can only use the amount you&apos;re trading, never your whole balance.</li>
        <li><b>Scam checks</b> on every token before you buy. Honeypots are blocked.</li>
        <li><b>Nobody from AUTISTIK will ever ask for your key, code or seed phrase.</b> Anyone who does is a scammer.</li>
      </ul>
      <label className="stack" style={{ gap: 4 }}><b>Limit per trade (USD)</b>
        <span className="row" style={{ gap: 8 }}>
          <input inputMode="decimal" value={limit} onChange={(e) => { setLimit(e.target.value.replace(/[^\d.]/g, "")); setSaved(false); }} placeholder="No limit" style={{ flex: 1 }} />
          <button type="button" className="btn small" onClick={() => { const n = Number(limit); store.set("aw-limit", limit && n > 0 ? n : null); setSaved(true); }}>Save</button>
        </span>
        <small className="tx-dim">{saved ? "Saved on this device." : "Trades above this amount are blocked on this device."}</small>
      </label>
      {signer.exportKey && signer.using === "embedded" && (
        <div className="stack" style={{ gap: 6 }}>
          <b>Back up your wallet</b>
          <small className="tx-dim">Your AUTISTIK wallet works on any device where you sign in. You can also copy its private key to use in another wallet app. Do this somewhere private and never share it.</small>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {signer.evm && <button type="button" className="btn small" onClick={() => signer.exportKey!("evm")}>Export EVM key</button>}
            {signer.sol && <button type="button" className="btn small" onClick={() => signer.exportKey!("solana")}>Export Solana key</button>}
          </div>
        </div>
      )}
      <button type="button" className="btn" onClick={signer.logout} style={{ alignSelf: "flex-start" }}>{signer.mode === "privy" ? "Sign out" : "Disconnect"}</button>
    </div>
  );
}
