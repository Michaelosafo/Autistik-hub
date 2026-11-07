"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import PhotoCrop from "@/components/PhotoCrop";
import { supabaseBrowser } from "@/lib/supabase/client";
import { createPublicClient, createWalletClient, custom, formatEther, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseEventLogs, zeroAddress } from "viem";
import { CHAINS, MIN_HOLD_USD, SOL_REWARD_TOKENS, viemChain } from "@/lib/launchpad";
import { INSTANT_ABI, INSTANT_CREATOR_BPS, INSTANT_DEX, INSTANT_REWARDS, INSTANT_TOKEN_V2_ABI, INSTANT_V2_ABI, NATIVE_REWARD, findRewardPool, isInstantChain, type InstantChain } from "@/lib/instant";
import { useSolWallet } from "@/components/SolanaLaunch";
import { signAndSend, solErr, solLaunchApi } from "@/lib/sol-wallet";

type Style = "liquidity" | "instant";
const KEY = "launch-style";
type Instants = Partial<Record<InstantChain, string>>;
type Versions = Partial<Record<InstantChain, number>>;

/**
 * Create a coin. Instant comes first and is open straight away when it's live: a name, a picture and a few words,
 * sign once, and the coin trades on PancakeSwap (BNB Chain) or Uniswap (Ethereum) at once, with no liquidity from
 * you and no bonding curve. "Add liquidity" is the classic Launch Pad (you put coins in the pool, then lock or burn it);
 * its form and tools only show when you pick it.
 */
export default function LaunchChoice({ instants, instantVersions = {}, admin, children }: { instants: Instants; instantVersions?: Versions; admin: boolean; children: React.ReactNode }) {
  const open = (Object.keys(INSTANT_DEX) as InstantChain[]).filter((k) => instants[k]);
  const [style, setStyle] = useState<Style>("instant");
  useEffect(() => { try { if (localStorage.getItem(KEY) === "liquidity") setStyle("liquidity"); } catch {} }, []);
  const pick = (s: Style) => {
    setStyle(s);
    try { localStorage.setItem(KEY, s); } catch {}
    setTimeout(() => document.getElementById("launch-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  return (
    <div className="stack">
      <div className="lc-bars" role="radiogroup" aria-label="How do you want to launch?">
        <LaunchBar on={style === "instant"} onPick={() => pick("instant")} icon="⚡" title="Instant launch" tag="Recommended"
          line="Name, picture, done. No liquidity needed. Live on PancakeSwap, Uniswap or Raydium at once.">
          <ol>
            <li>Pick the network (BNB Chain, Ethereum, Robinhood Chain or Solana), then add a name, a ticker and a picture. A description and links are optional.</li>
            <li>Press <b>Launch now</b> and sign once in your wallet. You only pay the network fee; you need $20 of AUTISTIK in that wallet.</li>
            <li>All 1,000,000,000 coins go straight into a {`PancakeSwap / Uniswap / Raydium`} pool at a small starting price. There&apos;s no bonding curve: buyers bring the BNB or ETH, and the price rises as they buy.</li>
            <li>The pool is locked forever (by the AUTISTIK Instant contract, or Raydium&apos;s lock on Solana), so nobody can pull the liquidity, not you and not AUTISTIK. No tax, no owner, no minting.</li>
            <li>Every trade pays the pool 1%: {INSTANT_CREATOR_BPS / 100}% of that is yours, sent straight to the wallet that launched it. For 5 minutes after launch, big buys are blocked to stop bots.</li>
            <li>Optional holder rewards: give some or all of your share to your holders, paid in BNB or ETH, a top token like USDT, USDC or CAKE, or any token you paste in.</li>
          </ol>
        </LaunchBar>
        <LaunchBar on={style === "liquidity"} onPick={() => pick("liquidity")} icon="💧" title="Add liquidity" tag="Classic"
          line="Put in your own BNB, ETH or SOL, set the price, then lock or burn it. Any network.">
          <ol>
            <li>Pick any network (BNB Chain, Ethereum, Solana and more), a name, a ticker and a picture.</li>
            <li>Choose your supply, how much goes into the pool, an optional tax (up to 10%) and optional holder rewards.</li>
            <li>Add your own BNB, ETH or SOL to the pool. That sets the starting price.</li>
            <li>Lock the liquidity for 6 months or 1 year, or burn it forever, so buyers know it can&apos;t be pulled.</li>
            <li>A small fee on every trade supports AUTISTIK: 0.3% on BNB Chain and Ethereum, 0.5% on Solana.</li>
          </ol>
        </LaunchBar>
      </div>
      <div id="launch-form">
        {style === "instant" && (true ? <InstantForm instants={instants} versions={instantVersions} open={open} admin={admin} /> : (
          <div className="card stack" style={{ gap: 6 }}>
            <b>⚡ Instant launch opens very soon</b>
            {admin ? (
              <p style={{ margin: 0 }}>Admin: Instant launch isn&apos;t deployed yet, so nobody can use it. Deploy it once with <a href="#instant-admin">Admin: Instant launch</a> at the bottom of this page. It switches on here straight away.</p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>The AUTISTIK team is switching it on. Until then you can launch the classic way with <button type="button" className="linkish" onClick={() => pick("liquidity")}>Add liquidity</button>.</p>
            )}
          </div>
        ))}
        {style === "liquidity" && children}
      </div>
    </div>
  );
}

/** One launch option as a simple bar: tap to choose it; "More" opens how it works, without choosing it. */
function LaunchBar({ on, onPick, icon, title, tag, line, children }: { on: boolean; onPick: () => void; icon: string; title: string; tag: string; line: string; children: React.ReactNode }) {
  const [more, setMore] = useState(false);
  return (
    <div className={"lc-bar" + (on ? " on" : "")}>
      <button type="button" role="radio" aria-checked={on} className="lc-bar-main" onClick={onPick}>
        <span className="lc-bar-ic" aria-hidden="true">{icon}</span>
        <span className="lc-bar-t"><b>{title} <em>{tag}</em></b><small>{line}</small></span>
        <span className="lc-bar-dot" aria-hidden="true" />
      </button>
      <button type="button" className="lc-bar-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Less" : "More"}</button>
      {more && <div className="lc-bar-body">{children}</div>}
    </div>
  );
}

const BUYS = ["0", "0.05", "0.1", "0.2"];
type RewardState = { on: boolean; token: string; custom: string; share: number; checking?: boolean; found?: { symbol: string; fee: number } | null; err?: string };
const RW0: RewardState = { on: false, token: "native", custom: "", share: 50 };
type Done = { token: string; pool: string; hash: string; listed: boolean; symbol: string };
type Net = InstantChain | "solana";
/** Solana Instant: Raydium concentrated pool, whole supply one-sided, the position locked forever (lib/solana-instant.ts). */
const SOL_DX = { dex: "Raydium", startFdv: "30", noFirstBuy: true, swap: (t: string) => `https://raydium.io/swap/?inputMint=sol&outputMint=${t}` };
type SolProgress = { mint?: string; sig?: string; pool?: string; nftMint?: string; pooled?: boolean; locked?: boolean };

function InstantForm({ instants, versions, open, admin }: { instants: Instants; versions: Versions; open: InstantChain[]; admin: boolean }) {
  const [net, setNet] = useState<Net>(open[0] ?? "solana");
  const sol = net === "solana";
  const c = CHAINS[net];
  const dx = sol ? SOL_DX : INSTANT_DEX[net as InstantChain];
  const pad = (sol ? null : instants[net as InstantChain]) as `0x${string}`;
  const { sw, picker } = useSolWallet();
  const [solStep, setSolStep] = useState<SolProgress>({});
  const [f, setF] = useState({ name: "", symbol: "", buy: "0", logo: "", description: "", website: "", x: "", telegram: "" });
  const [cfg, setCfg] = useState<{ fee: bigint; fdv: bigint } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [agree, setAgree] = useState(false);
  const [taken, setTaken] = useState<{ name: boolean; symbol: boolean } | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  // Holder rewards (Instant v2 contracts only): off, or a share of the creator's fees paid to holders in a reward.
  const v2 = !sol && (versions[net as InstantChain] ?? 1) >= 2;
  const [rw, setRw] = useState<RewardState>(RW0);
  // Admin only: launch at a starting market cap of your choice (Instant v2: team wallets the owner allowed, and the owner).
  const [adminFdv, setAdminFdv] = useState("");
  const picks = sol ? [] : INSTANT_REWARDS[net as InstantChain];
  const canPaste = net === "bsc" || net === "ethereum";
  const rewardLabel = !rw.on ? "" : rw.token === "native" ? c.coin : rw.token === "custom" ? (rw.found?.symbol || "your token") : picks.find((x) => x.address === rw.token)?.symbol || "";
  // Solana holder rewards: an extra fee on every transfer, collected and shared out by the AUTISTIK rewards wallet.
  const [solRw, setSolRw] = useState({ on: false, reward: "sol", fee: 1, share: 50 });
  const [solRwReady, setSolRwReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (!sol || solRwReady !== null) return;
    fetch("/api/launchpad/solana-rewards?status=1").then((r) => r.json()).then((j) => setSolRwReady(!!j?.ready)).catch(() => setSolRwReady(false));
  }, [sol, solRwReady]);
  async function checkCustom(addr: string) {
    setRw((x) => ({ ...x, custom: addr, found: undefined, err: "" }));
    if (!isAddress(addr)) return;
    setRw((x) => ({ ...x, checking: true }));
    const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
    const f = await findRewardPool(pub, net as InstantChain, getAddress(addr)).catch(() => null);
    setRw((x) => x.custom !== addr ? x : { ...x, checking: false, found: f ? { symbol: f.symbol, fee: f.fee } : null, err: f ? "" : `No ${INSTANT_DEX[net as InstantChain].dex} v3 pool with ${c.coin} found for that token, so fees couldn't buy it. Pick another.` });
  }

  useEffect(() => {
    if (sol || !pad) return;
    const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
    Promise.all([pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "launchFee" }), pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "startFdv" })])
      .then(([fee, fdv]: bigint[]) => setCfg({ fee, fdv })).catch(() => {});
  }, [pad, c, sol]);
  // A Solana launch in progress is kept on this device, so a failed step or a reload continues with the same coin.
  const solKey = `sol-instant:${f.symbol}:${f.name}`;
  useEffect(() => {
    if (!sol) return;
    try { const v = JSON.parse(localStorage.getItem(solKey) || "null"); setSolStep(v?.mint ? v : {}); } catch { setSolStep({}); }
  }, [sol, solKey]);
  const keepSol = (v: SolProgress) => { setSolStep(v); try { localStorage.setItem(solKey, JSON.stringify(v)); } catch { /* private mode */ } };

  /** Solana: coin → pool (two signatures) → lock → add to the Board. Each step continues where it stopped. */
  async function launchSol(name: string, symbol: string) {
    if (!sw) { setStatus("Connect a Solana wallet first (the button above)."); return; }
    setBusy(true);
    const owner = sw.account.address;
    let st = { ...solStep };
    try {
      if (!st.mint) {
        setStatus("Step 1 of 4: confirm your new coin in your wallet…");
        const rewards = solRw.on && solRwReady ? { reward: solRw.reward, rewardFee: solRw.fee, holderPercent: solRw.share } : {};
        const r = await solLaunchApi<{ tx: string; mint: string }>("instant-mint", { owner, name, symbol, logo: f.logo, ...rewards });
        const sig = await signAndSend(sw, r.tx);
        st = { mint: r.mint, sig }; keepSol(st);
      }
      if (!st.pooled) {
        setStatus("Step 2 of 4: confirm the Raydium pool in your wallet (two quick confirms)…");
        const r = await solLaunchApi<{ txs: string[]; pool: string; nftMint: string }>("instant-pool", { owner, mint: st.mint });
        await signAndSend(sw, r.txs[0]);
        setStatus("Step 3 of 4: confirm putting your coins into the pool…");
        await signAndSend(sw, r.txs[1]);
        st = { ...st, pool: r.pool, nftMint: r.nftMint, pooled: true }; keepSol(st);
      }
      if (!st.locked) {
        setStatus("Step 4 of 4: confirm locking the pool forever…");
        const r = await solLaunchApi<{ tx: string }>("instant-lock", { owner, nftMint: st.nftMint });
        await signAndSend(sw, r.tx);
        st = { ...st, locked: true }; keepSol(st);
      }
      setStatus("Adding it to the Board…");
      const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "solana", style: "instant", token: st.mint, pair: st.pool, nftMint: st.nftMint, txHash: st.sig, description: f.description, website: f.website, x: f.x, telegram: f.telegram }) });
      setDone({ token: st.mint!, pool: st.pool!, hash: st.sig!, listed: res.ok, symbol });
      try { localStorage.removeItem(solKey); } catch { /* private mode */ }
      setSolStep({}); setStatus("");
    } catch (e) { setStatus(solErr(e)); } finally { setBusy(false); }
  }
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
  const customFdv = admin && v2 && Number(adminFdv) > 0 && (!cfg || Number(adminFdv) !== Number(formatEther(cfg.fdv))) ? Number(adminFdv) : 0;
  const fdv = customFdv || (cfg ? Number(formatEther(cfg.fdv)) : Number(dx.startFdv));
  const maxBuy = fdv * 0.05;
  const buys = net === "bsc" ? BUYS : ["0", "0.01", "0.02", "0.05"];

  /** The reward choice for the contract, checked against it first (a token it can't buy is refused before you sign). */
  async function rewardArg(pub: any) {
    if (!rw.on) return { token: zeroAddress, holderBps: 0, fee: 0 };
    const holderBps = rw.share * 100;
    let token: `0x${string}`, fee = 0;
    if (rw.token === "native") token = NATIVE_REWARD;
    else if (rw.token === "custom") {
      if (!isAddress(rw.custom)) throw new Error("Paste the reward token's address, or pick one from the list.");
      token = getAddress(rw.custom);
    } else token = rw.token as `0x${string}`;
    if (token !== NATIVE_REWARD) {
      const listed = picks.find((x) => x.address.toLowerCase() === token.toLowerCase())?.fee;
      if (!listed) {
        const found = await findRewardPool(pub, net as InstantChain, token);
        if (!found) throw new Error("NoRewardPool");
        fee = found.fee;
      }
    }
    await pub.readContract({ address: pad, abi: INSTANT_V2_ABI, functionName: "rewardFeeFor", args: [token, BigInt(holderBps), fee] });
    return { token, holderBps, fee };
  }

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    const name = f.name.trim(), symbol = f.symbol.trim();
    if (!name || !symbol) { setStatus("Add a name and a ticker."); return; }
    if (taken?.name || taken?.symbol) { setStatus(taken.name ? "That name was already launched here. Pick another." : "That ticker was already launched here. Pick another."); return; }
    const buy = Number(f.buy || 0);
    if (!(buy >= 0) || buy > maxBuy) { setStatus(`Your first buy can be up to ${maxBuy.toFixed(2)} ${c.coin} (5% of the coins).`); return; }
    if (!agree) { setStatus("Tick the box to confirm you've read how it works."); return; }
    if (sol) { await launchSol(name, symbol); return; }
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
      const er = await fetch("/api/launchpad/eligibility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: net, wallet: account, name, symbol, style: "instant" }) });
      const permit = await er.json().catch(() => ({}));
      if (!er.ok) { setStatus(permit.error || "Couldn't check your AUTISTIK balance. Try again."); return; }
      const fee = (await pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "launchFee" } as any)) as bigint;
      const base = [name, symbol, permit.salt, BigInt(permit.deadline || 0), (permit.signature || "0x") as `0x${string}`, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)] as const;
      let call: any;
      if (v2 && customFdv) {
        // Your own starting market cap: only works from a team wallet the owner allowed (or the owner).
        const reward = await rewardArg(pub);
        call = { account, address: pad, abi: INSTANT_V2_ABI, functionName: "launchAtFdv", args: [name, symbol, permit.salt, base[5], reward, parseEther(String(customFdv))], value: fee + parseEther(f.buy || "0") };
      } else if (v2) {
        const reward = await rewardArg(pub);
        call = { account, address: pad, abi: INSTANT_V2_ABI, functionName: "launch", args: [...base, reward], value: fee + parseEther(f.buy || "0") };
      } else {
        call = { account, address: pad, abi: INSTANT_ABI, functionName: "launch", args: base, value: fee + parseEther(f.buy || "0") };
      }
      setStatus("Confirm the launch in your wallet…");
      const gas = ((await pub.estimateContractGas(call as any)) * 130n) / 100n;
      const hash = await wallet.writeContract({ ...call, chain, gas } as any);
      setStatus(`Launching on ${dx.dex}… this usually takes under a minute.`);
      const receipt = await pub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") { setStatus("The launch transaction failed. Nothing was created, but the network fee was spent."); return; }
      const ev = parseEventLogs({ abi: INSTANT_ABI, logs: receipt.logs, eventName: "Launched" })[0];
      if (!ev) { setStatus("Launched, but we couldn't read the result. Check your wallet's activity."); return; }
      const res = await fetch("/api/launchpad/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: net, style: "instant", txHash: hash, logo: f.logo, description: f.description, website: f.website, x: f.x, telegram: f.telegram }) });
      setDone({ token: getAddress(ev.args.token), pool: getAddress(ev.args.pool), hash, listed: res.ok, symbol });
      setStatus("");
    } catch (e: any) {
      const r = String(e?.shortMessage || e?.message || "");
      setStatus(/NotEligible|PermitUsed/.test(r) ? `The launch was refused: this wallet must hold at least $${MIN_HOLD_USD} of AUTISTIK. Press Launch again to re-check.`
        : /CreatorBuyTooBig/.test(r) ? "Your first buy is more than 5% of the coins. Make it smaller."
        : /NotCurator/.test(r) ? "Only team wallets can pick the starting market cap. Allow this wallet in Admin: Instant launch (from the team wallet), or clear the market cap box."
        : /NoRewardPool|RewardNotAllowed/.test(r) ? "That reward token can't be bought with the pool fees (no pool with enough liquidity). Pick another reward, or switch rewards off."
        : /PoolTaken/.test(r) ? "Someone tried to set up a pool for this coin first. Nothing was launched. Press Launch again (you'll get a new address)."
        : /TooLate/.test(r) ? "The launch took too long. Nothing was launched. Press Launch again."
        : /insufficient funds/i.test(r) ? `Not enough ${c.coin} in this wallet for the network fee and your first buy.`
        : /reject|denied/i.test(r) ? "You cancelled in your wallet. Nothing was launched." : e?.shortMessage || (r && r.length < 160 ? r : "Something went wrong. Nothing was launched."));
    } finally { setBusy(false); }
  }

  if (done) return (
    <div className="card stack lc-done" style={{ gap: 10 }}>
      <h3 style={{ margin: 0 }}>🎉 ${done.symbol} is live on {dx.dex}</h3>
      <p className="muted" style={{ margin: 0 }}>Anyone can buy it now. DexScreener shows the chart within a few minutes of the first trade. Share your links and start marketing.</p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <Link className="btn primary small" href={`/launchpad/${net}/${done.token}`}>Open your coin page</Link>
        <a className="btn small" href={dx.swap(done.token)} target="_blank" rel="noopener noreferrer">{dx.dex}</a>
        <a className="btn small" href={`https://dexscreener.com/${c.dexscreener}/${done.pool}`} target="_blank" rel="noopener noreferrer">DexScreener</a>
        <a className="btn small" href={`${c.explorer}/tx/${done.hash}`} target="_blank" rel="noopener noreferrer">Transaction</a>
      </div>
      <div className="field"><span>Contract address</span><span className="mono" style={{ overflowWrap: "anywhere" }}>{done.token}</span></div>
      {!done.listed && <small className="muted">Your coin is live, but we couldn&apos;t add it to the Board just now.</small>}
      <button type="button" className="linkish" onClick={() => { setDone(null); setF({ name: "", symbol: "", buy: "0", logo: "", description: "", website: "", x: "", telegram: "" }); setAgree(false); }}>Launch another</button>
    </div>
  );

  return (
    <form className="card stack lc-form" style={{ gap: 14 }} onSubmit={launch}>
      <div><b style={{ fontSize: "1.15em" }}>⚡ Instant launch</b><small className="muted" style={{ display: "block" }}>{c.name} · {dx.dex} v3 · no liquidity · no bonding curve</small></div>
      <div className="field">
        <span>Network</span>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Network">
          {(Object.keys(INSTANT_DEX) as InstantChain[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={net === k} className={"btn small" + (net === k ? " primary" : "")} disabled={!instants[k] || busy || !!solStep.mint}
              onClick={() => { setNet(k); setCfg(null); setRw(RW0); setF((x) => ({ ...x, buy: "0" })); }}>
              {CHAINS[k].name}{!instants[k] ? " (soon)" : ""}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={sol} className={"btn small" + (sol ? " primary" : "")} disabled={busy} onClick={() => { setNet("solana"); setCfg(null); setF((x) => ({ ...x, buy: "0" })); }}>Solana</button>
        </div>
      </div>
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
      <label className="field"><span>Description <small className="muted">optional</small></span>
        <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} rows={2} placeholder="What's your coin about?" />
      </label>
      <details className="lc-links">
        <summary><b>Links</b> <small className="muted">optional: website, X, Telegram</small></summary>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <label className="field"><span>Website</span><input value={f.website} onChange={(e) => setF({ ...f, website: e.target.value.trim() })} placeholder="https://…" inputMode="url" /></label>
          <label className="field"><span>X</span><input value={f.x} onChange={(e) => setF({ ...f, x: e.target.value.trim() })} placeholder="https://x.com/…" inputMode="url" /></label>
          <label className="field"><span>Telegram</span><input value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value.trim() })} placeholder="https://t.me/…" inputMode="url" /></label>
        </div>
      </details>
      {sol && (
        <div className="field">
          <span>Solana wallet</span>
          {picker(busy, setStatus)}
          {solStep.mint && <small className="muted">Continuing your launch: step {solStep.locked ? 4 : solStep.pooled ? 4 : 2} of 4. Press Launch now to carry on.</small>}
        </div>
      )}
      {!dx.noFirstBuy && <div className="field">
        <span>Be the first buyer <small className="muted">optional, up to {maxBuy.toFixed(2)} {c.coin} (5% of the coins)</small></span>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {buys.map((b) => <button key={b} type="button" className={"btn small" + (f.buy === b ? " primary" : "")} onClick={() => setF({ ...f, buy: b })}>{b === "0" ? "No buy" : `${b} ${c.coin}`}</button>)}
          <input style={{ width: 110 }} inputMode="decimal" value={f.buy} onChange={(e) => setF({ ...f, buy: e.target.value.replace(/[^0-9.]/g, "") })} aria-label={`First buy in ${c.coin}`} />
        </div>
        <small className="muted">You buy before anyone else, at the starting price, in the same transaction (so bots can&apos;t jump in front).</small>
      </div>}
      {sol && (
        <div className="field lc-rewards">
          <span>Holder rewards <small className="muted">optional</small></span>
          {solRwReady === false ? <small className="muted">Holder rewards for Solana Instant coins are switching on soon. Your coin launches without them for now.</small> : <>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Holder rewards">
              <button type="button" role="radio" aria-checked={!solRw.on} className={"btn small" + (!solRw.on ? " primary" : "")} disabled={!!solStep.mint} onClick={() => setSolRw({ ...solRw, on: false })}>Off</button>
              <button type="button" role="radio" aria-checked={solRw.on} className={"btn small" + (solRw.on ? " primary" : "")} disabled={!!solStep.mint || !solRwReady} onClick={() => setSolRw({ ...solRw, on: true })}>🎁 Reward my holders</button>
            </div>
            {solRw.on && <>
              <small className="muted">Paid in</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Reward">
                {Object.entries(SOL_REWARD_TOKENS).filter(([, t]) => !t.stock).map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={solRw.reward === k} className={"btn small" + (solRw.reward === k ? " primary" : "")} onClick={() => setSolRw({ ...solRw, reward: k })}>{t.symbol}</button>)}
              </div>
              <small className="muted">or stocks 📈</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Stock reward">
                {Object.entries(SOL_REWARD_TOKENS).filter(([, t]) => t.stock).map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={solRw.reward === k} className={"btn small" + (solRw.reward === k ? " primary" : "")} onClick={() => setSolRw({ ...solRw, reward: k })}>{t.symbol}</button>)}
              </div>
              {SOL_REWARD_TOKENS[solRw.reward]?.stock && <small className="muted">xStocks track the share price; they aren&apos;t shares and aren&apos;t offered to US persons.</small>}
              <small className="muted">Reward fee on every trade</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Reward fee">
                {[1, 2, 3].map((n) => <button key={n} type="button" role="radio" aria-checked={solRw.fee === n} className={"btn small" + (solRw.fee === n ? " primary" : "")} onClick={() => setSolRw({ ...solRw, fee: n })}>{n}%</button>)}
              </div>
              <small className="muted">How much of it goes to holders</small>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Share for holders">
                {[25, 50, 75, 100].map((n) => <button key={n} type="button" role="radio" aria-checked={solRw.share === n} className={"btn small" + (solRw.share === n ? " primary" : "")} onClick={() => setSolRw({ ...solRw, share: n })}>{n}%</button>)}
              </div>
              <small className="muted">Every buy, sell and transfer pays {solRw.fee}% extra: {solRw.share}% of it buys {SOL_REWARD_TOKENS[solRw.reward]?.symbol} for holders (by how much they hold, sent about every 10 minutes) and the rest goes straight to your wallet. Fixed at launch: nobody can change it.</small>
            </>}
          </>}
        </div>
      )}
      {v2 && (
        <div className="field lc-rewards">
          <span>Holder rewards <small className="muted">optional</small></span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Holder rewards">
            <button type="button" role="radio" aria-checked={!rw.on} className={"btn small" + (!rw.on ? " primary" : "")} onClick={() => setRw({ ...rw, on: false })}>Off: keep all my fees</button>
            <button type="button" role="radio" aria-checked={rw.on} className={"btn small" + (rw.on ? " primary" : "")} onClick={() => setRw({ ...rw, on: true })}>🎁 Reward my holders</button>
          </div>
          {rw.on && <>
            <small className="muted">Paid in</small>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Reward">
              <button type="button" role="radio" aria-checked={rw.token === "native"} className={"btn small" + (rw.token === "native" ? " primary" : "")} onClick={() => setRw({ ...rw, token: "native" })}>{c.coin}</button>
              {picks.map((x) => <button key={x.address} type="button" role="radio" aria-checked={rw.token === x.address} className={"btn small" + (rw.token === x.address ? " primary" : "")} onClick={() => setRw({ ...rw, token: x.address })}>{x.symbol}</button>)}
              {canPaste && <button type="button" role="radio" aria-checked={rw.token === "custom"} className={"btn small" + (rw.token === "custom" ? " primary" : "")} onClick={() => setRw({ ...rw, token: "custom" })}>Paste a token</button>}
            </div>
            {rw.token === "custom" && <>
              <input value={rw.custom} onChange={(e) => checkCustom(e.target.value.trim())} placeholder="0x… token address" spellCheck={false} aria-label="Reward token address" />
              {rw.checking ? <small className="muted">Looking for its pool…</small> : rw.found ? <small className="ql-good">✓ {rw.found.symbol}: fees can buy it ({rw.found.fee / 10_000}% pool)</small> : rw.err ? <small className="ql-bad">{rw.err}</small> : null}
            </>}
            {!canPaste && <small className="muted">On {c.name}, rewards are paid in {c.coin}.</small>}
            <small className="muted">How much of your fee share goes to holders</small>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }} role="radiogroup" aria-label="Share for holders">
              {[25, 50, 75, 100].map((n) => <button key={n} type="button" role="radio" aria-checked={rw.share === n} className={"btn small" + (rw.share === n ? " primary" : "")} onClick={() => setRw({ ...rw, share: n })}>{n}%</button>)}
            </div>
            <small className="muted">Holders get {rw.share}% of your share of every trade, paid in {rewardLabel}; you keep {100 - rw.share}%. They claim it any time from your coin page. Fixed at launch: it can&apos;t be changed later.</small>
          </>}
        </div>
      )}
      {admin && v2 && (
        <label className="field lc-admin-fdv">
          <span>🛠️ Admin: starting market cap ({c.coin}) <small className="muted">only you see this · leave empty for the normal {cfg ? formatEther(cfg.fdv) : dx.startFdv} {c.coin}</small></span>
          <input value={adminFdv} inputMode="decimal" placeholder={cfg ? formatEther(cfg.fdv) : dx.startFdv} onChange={(e) => setAdminFdv(e.target.value.replace(/[^0-9.]/g, ""))} />
          {customFdv > 0 && <small className="muted">This coin starts at {customFdv} {c.coin}. Your first buy can be up to {(customFdv * 0.05).toFixed(3)} {c.coin} (5%).</small>}
        </label>
      )}
      <ul className="lc-facts">
        <li><b>1,000,000,000</b> coins, all in the {dx.dex} pool</li>
        <li>Starting market cap <b>{fdv} {c.coin}</b>. The price rises as people buy</li>
        <li>Liquidity <b>locked forever</b>: nobody can remove it, not you and not AUTISTIK</li>
        {sol ? <>
          <li>Minting and freezing switched off. A 0.5% fee on every transfer supports AUTISTIK{solRw.on && solRwReady ? <>, plus your {solRw.fee}% reward fee ({solRw.share}% to holders in {SOL_REWARD_TOKENS[solRw.reward]?.symbol})</> : null}</li>
          <li>The pool charges 1% per trade: <b>most of it is yours</b> (Raydium keeps its 16% share), collected on Raydium with the fee NFT you get</li>
          <li>Four quick confirms in your wallet: the coin, the pool, your coins into the pool, the lock</li>
        </> : <>
          <li>No tax, no owner, no minting. Anti-bot: max 1% per buy for the first 5 minutes</li>
          <li>The pool charges 1% per trade: <b>{INSTANT_CREATOR_BPS / 100}% of it is yours</b>, sent straight to this wallet when fees are collected{rw.on && v2 ? <> ({rw.share}% of that goes to your holders in {rewardLabel})</> : null}</li>
        </>}
        {sol ? <li>Cost: a small launch fee + about 0.1 SOL of Solana network rent for the pool and lock</li> : <li>Cost: {cfg && cfg.fee > 0n ? `${formatEther(cfg.fee)} ${c.coin} + ` : "free + "}the network fee ({net === "ethereum" ? "a few dollars on Ethereum" : net === "robinhood" ? "a few cents on Robinhood Chain" : "about $0.30"}){Number(f.buy) > 0 ? ` + your ${f.buy} ${c.coin} buy` : ""}</li>}
        {!sol && <li>You need ${MIN_HOLD_USD} of AUTISTIK in this wallet to launch</li>}
      </ul>
      <label className="row" style={{ gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><small>I understand the coins go straight into the {dx.dex} pool, the liquidity can never be taken out, and coin prices can go to zero. <Link href="/terms">Terms</Link></small></label>
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Launching…" : "⚡ Launch now"}</button>
      {status && <p className="muted" role="status" style={{ margin: 0 }}>{status}</p>}
    </form>
  );
}

/** Coin page of an Instant coin: the pool's trading fees, collected and split between the creator and AUTISTIK. */
export function InstantFees({ chain = "bsc", pad, token, creator }: { chain?: string; pad: `0x${string}`; token: `0x${string}`; creator: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [owed, setOwed] = useState<bigint>(0n);
  const c = CHAINS[(isInstantChain(chain) ? chain : "bsc") as InstantChain];
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
      // v1 and v2 contracts name the amounts differently; v2 also reports the holders' part.
      const e2 = parseEventLogs({ abi: INSTANT_V2_ABI, logs: r.logs, eventName: "FeesCollected" })[0] as any;
      const e1 = e2 ? null : (parseEventLogs({ abi: INSTANT_ABI, logs: r.logs, eventName: "FeesCollected" })[0] as any);
      const total = e2 ? e2.args.eth : e1?.args.bnb, toCreator = e2 ? e2.args.toCreatorEth : e1?.args.toCreatorBnb;
      setOwed((await pub.readContract({ address: pad, abi: INSTANT_ABI, functionName: "owed", args: [account] } as any)) as bigint);
      const fmt = (v: bigint) => Number(formatEther(v)).toFixed(5);
      setMsg(claim ? "✅ Sent to your wallet." : total !== undefined ? `✅ Collected ${fmt(total)} ${c.coin} of fees: ${fmt(toCreator)} ${c.coin} went to the creator${e2?.args.toHoldersEth > 0n ? `, ${fmt(e2.args.toHoldersEth)} ${c.coin} to holders' rewards` : ""}.` : "✅ Done.");
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : "Couldn't do that right now. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <b>⚡ Instant coin · pool fees</b>
      <small className="muted">Every trade pays the {c.dex} pool a 1% fee. Fees are paid out automatically about every 30 minutes once enough has built up (anyone can also press Collect): {INSTANT_CREATOR_BPS / 100}% goes straight to the creator&apos;s wallet ({creator.slice(0, 6)}…{creator.slice(-4)}), less any share they gave to holders, and the rest to AUTISTIK. The liquidity itself stays in the pool forever.</small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn small primary" disabled={busy} onClick={() => run(false)}>{busy ? "…" : "Collect fees"}</button>
        {owed > 0n && <button type="button" className="btn small" disabled={busy} onClick={() => run(true)}>Claim {formatEther(owed)} {c.coin}</button>}
      </div>
      {msg && <small className="muted" role="status">{msg}</small>}
      <HolderRewards chainKey={(isInstantChain(chain) ? chain : "bsc") as InstantChain} token={token} />
    </div>
  );
}

const ERC20_META = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);

/** An Instant v2 coin whose creator chose holder rewards: what's been paid in, and your share to claim. */
function HolderRewards({ chainKey, token }: { chainKey: InstantChain; token: `0x${string}` }) {
  const c = CHAINS[chainKey];
  const [r, setR] = useState<{ token: string; symbol: string; decimals: number; total: bigint } | null>(null);
  const [mine, setMine] = useState<bigint | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
    (async () => {
      const rt = getAddress(await pub.readContract({ address: token, abi: INSTANT_TOKEN_V2_ABI, functionName: "rewardToken" })); // v1 coins: no such function
      if (rt === zeroAddress) return;
      const total: bigint = await pub.readContract({ address: token, abi: INSTANT_TOKEN_V2_ABI, functionName: "totalRewardsDistributed" });
      if (rt === getAddress(NATIVE_REWARD)) { setR({ token: rt, symbol: c.coin, decimals: 18, total }); return; }
      const [symbol, decimals] = await Promise.all([pub.readContract({ address: rt, abi: ERC20_META, functionName: "symbol" }).catch(() => "tokens"), pub.readContract({ address: rt, abi: ERC20_META, functionName: "decimals" }).catch(() => 18)]);
      setR({ token: rt, symbol: String(symbol), decimals: Number(decimals), total });
    })().catch(() => {});
  }, [c, token]);
  if (!r) return null;
  const show = (v: bigint) => Number(formatUnits(v, r.decimals)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  async function go(claim: boolean) {
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setMsg(claim ? "Check your wallet app…" : "");
    try {
      const chain = viemChain(c);
      const wallet = createWalletClient({ chain, transport: custom(eth) });
      const pub = createPublicClient({ chain, transport: http(c.rpc) });
      const [account] = await wallet.requestAddresses();
      if (claim) {
        try { await wallet.switchChain({ id: c.chainId }); } catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: c.chainId }); }
        const h = await wallet.writeContract({ account, chain, address: token, abi: INSTANT_TOKEN_V2_ABI, functionName: "claim" } as any);
        const rc = await pub.waitForTransactionReceipt({ hash: h });
        if (rc.status !== "success") throw new Error("failed");
        setMsg(`✅ Your ${r!.symbol} rewards were sent to your wallet.`);
      }
      setMine((await pub.readContract({ address: token, abi: INSTANT_TOKEN_V2_ABI, functionName: "withdrawableRewards", args: [account] } as any)) as bigint);
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : "Couldn't do that right now. Try again.");
    } finally { setBusy(false); }
  }
  return (
    <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line, #8883)", paddingTop: 8 }}>
      <b>🎁 Holder rewards in {r.symbol}</b>
      <small className="muted">This coin&apos;s creator gives part of their trading fees to holders, paid in {r.symbol}. The more you hold, the bigger your share. Paid in so far: <b>{show(r.total)} {r.symbol}</b>. Rewards arrive each time fees are collected.</small>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {mine === null ? <button type="button" className="btn small" disabled={busy} onClick={() => go(false)}>Check my rewards</button>
          : <><span>You can claim <b>{show(mine)} {r.symbol}</b></span>{mine > 0n && <button type="button" className="btn small primary" disabled={busy} onClick={() => go(true)}>{busy ? "…" : "Claim"}</button>}</>}
      </div>
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
