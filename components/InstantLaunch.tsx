"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PhotoCrop from "@/components/PhotoCrop";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createPublicClient, createWalletClient, custom, formatEther, getAddress, http, parseEther, parseEventLogs } from "viem";
import { CHAINS, MIN_HOLD_USD, viemChain } from "@/lib/launchpad";
import { INSTANT_ABI, INSTANT_CREATOR_BPS } from "@/lib/instant";

type Style = "liquidity" | "instant";
const KEY = "launch-style";

/**
 * Create a coin: first choose how. "Add liquidity" is the classic Launch Pad (you put BNB in the pool, then lock or
 * burn it). "Instant" needs no liquidity and has no bonding curve: the coin is on PancakeSwap and DexScreener the
 * moment it's made.
 */
export default function LaunchChoice({ instant, admin, children }: { instant: string | null; admin: boolean; children: React.ReactNode }) {
  const [style, setStyle] = useState<Style | null>(null);
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s === "liquidity" || s === "instant") setStyle(s); } catch {} }, []);
  const pick = (s: Style) => {
    setStyle(s);
    try { localStorage.setItem(KEY, s); } catch {}
    setTimeout(() => document.getElementById("launch-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  return (
    <div className="stack">
      <div className="lc-pick" role="radiogroup" aria-label="How do you want to launch?">
        <h2>How do you want to launch?</h2>
        <button type="button" role="radio" aria-checked={style === "instant"} className={"lc-card lc-instant" + (style === "instant" ? " on" : "")} onClick={() => pick("instant")}>
          <span className="lc-tag">New · no liquidity needed</span>
          <b>⚡ Instant launch</b>
          <small>No liquidity from you and no bonding curve. Your coin is <b>live on PancakeSwap</b> and shows on <b>DexScreener</b> the moment it&apos;s made. Start marketing straight away.</small>
          <ul>
            <li>✓ Free to create (just the network fee)</li>
            <li>✓ Liquidity locked in the pool forever</li>
            <li>✓ You earn {INSTANT_CREATOR_BPS / 100}% of the pool&apos;s 1% trading fee</li>
            <li>• BNB Chain only, no tax, 1 billion supply</li>
          </ul>
        </button>
        <button type="button" role="radio" aria-checked={style === "liquidity"} className={"lc-card" + (style === "liquidity" ? " on" : "")} onClick={() => pick("liquidity")}>
          <span className="lc-tag">Classic · full control</span>
          <b>💧 Add liquidity</b>
          <small>You put {"BNB, ETH or SOL"} into the pool and set the starting price yourself, then lock or burn the liquidity.</small>
          <ul>
            <li>✓ Any network: BNB Chain, Ethereum, Solana…</li>
            <li>✓ Your own supply, share, tax and holder rewards</li>
            <li>✓ Lock 6 months, 1 year, or burn</li>
            <li>• You need BNB/ETH/SOL for the pool</li>
          </ul>
        </button>
      </div>
      <div id="launch-form">
        {style === "instant" && (instant ? <InstantForm pad={instant as `0x${string}`} admin={admin} /> : (
          <div className="card stack" style={{ gap: 6 }}>
            <b>⚡ Instant launch opens very soon</b>
            <p className="muted" style={{ margin: 0 }}>The AUTISTIK team is switching it on for BNB Chain. Until then you can launch the classic way with <button type="button" className="linkish" onClick={() => pick("liquidity")}>Add liquidity</button>.</p>
          </div>
        ))}
        {style === "liquidity" && children}
      </div>
    </div>
  );
}

const BUYS = ["0", "0.05", "0.1", "0.2"];
type Done = { token: string; pool: string; hash: string; listed: boolean; symbol: string };

function InstantForm({ pad, admin }: { pad: `0x${string}`; admin: boolean }) {
  const c = CHAINS.bsc;
  const [f, setF] = useState({ name: "", symbol: "", buy: "0", logo: "" });
  const [cfg, setCfg] = useState<{ fee: bigint; fdv: bigint } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [agree, setAgree] = useState(false);
  const [taken, setTaken] = useState<{ name: boolean; symbol: boolean } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
    Promise.all([pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "launchFee" }), pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "startFdv" })])
      .then(([fee, fdv]: bigint[]) => setCfg({ fee, fdv })).catch(() => {});
  }, [pad]);
  useEffect(() => {
    setTaken(null);
    if (!f.name.trim() && !f.symbol.trim()) return;
    const t = setTimeout(() => {
      fetch(`/api/launchpad/name-check?name=${encodeURIComponent(f.name)}&symbol=${encodeURIComponent(f.symbol)}`).then((r) => r.json()).then(setTaken).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [f.name, f.symbol]);

  async function uploadLogo(blob: Blob) {
    setLogoFile(null); setLogoBusy("Uploading…");
    try {
      const sb = supabaseBrowser();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Sign in to add a picture.");
      const path = `${user.id}/logo-${Date.now()}.webp`;
      const { error } = await sb.storage.from("token-logos").upload(path, blob, { contentType: "image/webp" });
      if (error) throw new Error(error.message);
      setF((x) => ({ ...x, logo: sb.storage.from("token-logos").getPublicUrl(path).data.publicUrl }));
      setLogoBusy("");
    } catch (e: any) { setLogoBusy(e?.message?.includes("Sign in") ? e.message : "Couldn't upload that picture. Try another one."); }
  }

  // The creator's first buy is capped at 5% of the supply: about 5% of the starting market cap in BNB.
  const maxBuy = cfg ? Number(formatEther(cfg.fdv)) * 0.05 : 0.3;
  const fdv = cfg ? Number(formatEther(cfg.fdv)) : 6;

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    const name = f.name.trim(), symbol = f.symbol.trim();
    if (!name || !symbol) { setStatus("Add a name and a ticker."); return; }
    if (taken?.name || taken?.symbol) { setStatus(taken.name ? "That name was already launched here. Pick another." : "That ticker was already launched here. Pick another."); return; }
    const buy = Number(f.buy || 0);
    if (!(buy >= 0) || buy > maxBuy) { setStatus(`Your first buy can be up to ${maxBuy.toFixed(2)} BNB (5% of the coins).`); return; }
    if (!agree) { setStatus("Tick the box to confirm you've read how it works."); return; }
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }
      setStatus(admin ? "Getting your admin launch permit…" : `Checking this wallet holds at least $${MIN_HOLD_USD} of AUTISTIK…`);
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "bsc", wallet: account, name, symbol, style: "instant" }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); return; }
      const fee = (await pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "launchFee" } as any)) as bigint;
      setStatus("Confirm the launch in your wallet…");
      const call = {
        account, address: pad, abi: INSTANT_ABI, functionName: "launch",
        args: [name, symbol, permit.salt, BigInt(permit.deadline || 0), (permit.signature || "0x") as `0x${string}`, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
        value: fee + parseEther(f.buy || "0"),
      } as const;
      const gas = ((await pub.estimateContractGas(call as any)) * 130n) / 100n;
      const hash = await wallet.writeContract({ ...call, chain, gas } as any);
      setStatus("Launching on PancakeSwap… this usually takes under a minute.");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The launch transaction failed. Nothing was created, but the network fee was spent."); return; }
      const ev = parseEventLogs({ abi: INSTANT_ABI, logs: receipt.logs, eventName: "Launched" })[0];
      if (!ev) { setStatus("Launched, but we couldn't read the result. Check your wallet's activity."); return; }
      const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "bsc", style: "instant", txHash: hash, logo: f.logo }) });
      setDone({ token: getAddress(ev.args.token), pool: getAddress(ev.args.pool), hash, listed: res.ok, symbol });
      setStatus("");
    } catch (e: any) {
      const r = String(e?.shortMessage || e?.message || "");
      setStatus(/NotEligible|PermitUsed/.test(r) ? `The launch was refused: this wallet must hold at least $${MIN_HOLD_USD} of AUTISTIK. Press Launch again to re-check.`
        : /CreatorBuyTooBig/.test(r) ? "Your first buy is more than 5% of the coins. Make it smaller."
        : /PoolTaken/.test(r) ? "Someone tried to set up a pool for this coin first. Nothing was launched. Press Launch again (you'll get a new address)."
        : /TooLate/.test(r) ? "The launch took too long. Nothing was launched. Press Launch again."
        : /insufficient funds/i.test(r) ? "Not enough BNB in this wallet for the network fee and your first buy."
        : /reject|denied/i.test(r) ? "You cancelled in your wallet. Nothing was launched." : e?.shortMessage || "Something went wrong. Nothing was launched.");
    } finally { setBusy(false); }
  }

  if (done) return (
    <div className="card stack lc-done" style={{ gap: 10 }}>
      <h3 style={{ margin: 0 }}>🎉 ${done.symbol} is live on PancakeSwap</h3>
      <p className="muted" style={{ margin: 0 }}>Anyone can buy it now. DexScreener shows the chart within a few minutes of the first trade. Share your links and start marketing.</p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Link className="btn primary small" href={`/launchpad/bsc/${done.token}`}>Open your coin page</Link>
        <a className="btn small" href={`https://pancakeswap.finance/swap?chain=bsc&outputCurrency=${done.token}`} target="_blank" rel="noopener noreferrer">PancakeSwap</a>
        <a className="btn small" href={`https://dexscreener.com/bsc/${done.pool}`} target="_blank" rel="noopener noreferrer">DexScreener</a>
        <a className="btn small" href={`${c.explorer}/tx/${done.hash}`} target="_blank" rel="noopener noreferrer">Transaction</a>
      </div>
      <div className="field"><span>Contract address</span><span className="mono" style={{ overflowWrap: "anywhere" }}>{done.token}</span></div>
      {!done.listed && <small className="muted">Your coin is live, but we couldn&apos;t add it to the Board just now.</small>}
      <button type="button" className="linkish" onClick={() => { setDone(null); setF({ name: "", symbol: "", buy: "0", logo: "" }); setAgree(false); }}>Launch another</button>
    </div>
  );

  return (
    <form className="card stack lc-form" style={{ gap: 14 }} onSubmit={launch}>
      <div><b style={{ fontSize: "1.15em" }}>⚡ Instant launch</b><small className="muted" style={{ display: "block" }}>BNB Chain · PancakeSwap v3 · no liquidity · no bonding curve</small></div>
      <div className="ql-pic">
        <button type="button" className="ql-pic-btn" onClick={() => logoInput.current?.click()} aria-label={f.logo ? "Change the coin picture" : "Add a coin picture"}>
          {f.logo ? <img src={f.logo} alt="" /> : <span><svg viewBox="0 0 24 24" width="22" height="22"><use href="#i-cam" /></svg><small>Add picture</small></span>}
        </button>
        <div><b>Coin picture</b><small className="muted">Square works best. Shows on the Board and your coin page.</small>
          {logoBusy && <small className="muted">{logoBusy}</small>}
        </div>
        <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const x = e.target.files?.[0]; if (x) setLogoFile(x); e.target.value = ""; }} />
        {logoFile && <PhotoCrop file={logoFile} onCancel={() => setLogoFile(null)} onDone={uploadLogo} />}
      </div>
      <div className="form-grid">
        <label className="field"><span>Name {taken?.name ? <b className="ql-bad">already launched</b> : f.name.trim() && taken ? <b className="ql-good">✓ available</b> : null}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={32} placeholder="e.g. Calm Otter" required /></label>
        <label className="field"><span>Ticker {taken?.symbol ? <b className="ql-bad">already launched</b> : f.symbol.trim() && taken ? <b className="ql-good">✓ available</b> : null}</span><input value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} maxLength={12} placeholder="e.g. OTTER" required /></label>
      </div>
      <div className="field">
        <span>Be the first buyer <small className="muted">optional, up to {maxBuy.toFixed(2)} BNB (5% of the coins)</small></span>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {BUYS.map((b) => <button key={b} type="button" className={"btn small" + (f.buy === b ? " primary" : "")} onClick={() => setF({ ...f, buy: b })}>{b === "0" ? "No buy" : `${b} BNB`}</button>)}
          <input style={{ width: 110 }} inputMode="decimal" value={f.buy} onChange={(e) => setF({ ...f, buy: e.target.value.replace(/[^0-9.]/g, "") })} aria-label="First buy in BNB" />
        </div>
        <small className="muted">You buy before anyone else, at the starting price, in the same transaction (so bots can&apos;t jump in front).</small>
      </div>
      <ul className="lc-facts">
        <li><b>1,000,000,000</b> coins, all in the PancakeSwap pool</li>
        <li>Starting market cap <b>{fdv} BNB</b>. The price rises as people buy</li>
        <li>Liquidity <b>locked forever</b>: nobody can remove it, not you and not AUTISTIK</li>
        <li>No tax, no owner, no minting. Anti-bot: max 1% per buy for the first 5 minutes</li>
        <li>The pool charges 1% per trade: <b>{INSTANT_CREATOR_BPS / 100}% of it is yours</b>, collected from your coin page</li>
        <li>Cost: {cfg && cfg.fee > 0n ? `${formatEther(cfg.fee)} BNB + ` : "free + "}the network fee (about $0.30){Number(f.buy) > 0 ? ` + your ${f.buy} BNB buy` : ""}</li>
        <li>You need ${MIN_HOLD_USD} of AUTISTIK in this wallet to launch</li>
      </ul>
      <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><small>I understand the coins go straight into the PancakeSwap pool, the liquidity can never be taken out, and coin prices can go to zero. <Link href="/terms">Terms</Link></small></label>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Launching…" : "⚡ Launch now"}</button>
      {status && <p className="muted" role="status" style={{ margin: 0 }}>{status}</p>}
    </form>
  );
}

/** Coin page of an Instant coin: the pool's trading fees, collected and split between the creator and AUTISTIK. */
export function InstantFees({ pad, token, creator }: { pad: `0x${string}`; token: `0x${string}`; creator: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [owed, setOwed] = useState<bigint>(0n);
  const c = CHAINS.bsc;
  async function run(claim: boolean) {
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setMsg("Check your wallet app…");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }
      const hash = await wallet.writeContract({ account, chain, address: pad, abi: INSTANT_ABI, functionName: claim ? "claim" : "collectFees", args: claim ? [] : [token] } as any);
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("failed");
      const ev = parseEventLogs({ abi: INSTANT_ABI, logs: r.logs, eventName: "FeesCollected" })[0] as any;
      setOwed((await pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "owed", args: [account] } as any)) as bigint);
      setMsg(claim ? "✅ Sent to your wallet." : ev ? `✅ Collected ${Number(formatEther(ev.args.bnb)).toFixed(5)} BNB of fees: ${Number(formatEther(ev.args.toCreatorBnb)).toFixed(5)} BNB went to the creator.` : "✅ Done.");
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : "Couldn't do that right now. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <b>⚡ Instant coin · pool fees</b>
      <small className="muted">Every trade pays the PancakeSwap pool a 1% fee. Anyone can press Collect: {INSTANT_CREATOR_BPS / 100}% goes straight to the creator ({creator.slice(0, 6)}…{creator.slice(-4)}) and the rest to AUTISTIK. The liquidity itself stays in the pool forever.</small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => run(false)}>{busy ? "…" : "Collect fees"}</button>
        {owed > 0n && <button type="button" className="btn small" disabled={busy} onClick={() => run(true)}>Claim {formatEther(owed)} BNB</button>}
      </div>
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
