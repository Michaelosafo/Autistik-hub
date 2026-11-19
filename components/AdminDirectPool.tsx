"use client";
import { getState, netOf, pickWallet, setNetwork, switchEvm } from "@/lib/connect";
import { reportActivity } from "@/lib/activity-client";
import { ADMIN_DIRECT_TOKEN_ABI, ADMIN_DIRECT_TOKEN_BYTECODE } from "@/lib/admin-direct-token";
import { EvmRageChain, MAX_RAGE_TAX, RAGE_CHAINS, RAGE_GAS, RageChain, rageTaxBps } from "@/lib/admin-rage";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeDeployData, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import AdminSolPool from "@/components/AdminSolPool";

/**
 * Any admin (after their 2-step code). One flow: deploy, add liquidity, then ask to remove it.
 * Does not touch LP that a normal launch burned or locked.
 * BNB Chain is the default. The network control switches the wallet, RPC, explorer and native coin.
 */
const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
]);
const FACTORY_ABI = parseAbi(["function getPair(address, address) view returns (address)"]);
const PAIR_ABI = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function totalSupply() view returns (uint256)",
]);
const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const SAVED = "autistik-admin-direct-token";
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const slip = (v: bigint) => (v * 9500n) / 10_000n;

type Info = {
  symbol: string; decimals: number; pair: `0x${string}` | null;
  rToken: bigint; rCoin: bigint; lp: bigint; lpTotal: bigint; tokenBal: bigint; coinBal: bigint;
  /** Rage tokens: false while trading is closed (liquidity in, first buy / open trading still to do). null: not a Rage token. */
  live: boolean | null;
  buyTaxBps: number | null;
  sellTaxBps: number | null;
};

function RageNetworkPicker({ value, onChange }: { value: RageChain; onChange: (k: RageChain) => void }) {
  const [open, setOpen] = useState(false);
  const chain = CHAINS[value];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="muted" style={{ fontSize: ".85em" }}>Network</span>
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="listbox" aria-label={`${chain.name}. Choose a network.`} onClick={() => setOpen((v) => !v)}>
        {chain.name} · {chain.coin} ▾
      </button>
      {open && (
        <div role="listbox" aria-label="Choose a network" className="stack" style={{ gap: 4 }}>
          {RAGE_CHAINS.map((k) => {
            const c = CHAINS[k];
            const on = k === value;
            return (
              <button key={k} type="button" role="option" aria-selected={on} className={"btn small" + (on ? " primary" : "")} onClick={() => { onChange(k); setOpen(false); }}>
                {c.name}{k === "bsc" ? " · default" : ""} · {c.coin}
              </button>
            );
          })}
        </div>
      )}
      <small className="muted">{value === "bsc" ? "BNB Chain is the default. Open this to deploy on another network." : `Deploying on ${chain.name}. The wallet is asked to switch.`}</small>
    </div>
  );
}

export default function AdminDirectPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  const [chainKey, setChainKey] = useState<RageChain>("bsc");
  async function choose(k: RageChain) {
    setChainKey(k);
    const want = CHAINS[k].chainId;
    const known = netOf(k).chainId;
    try {
      if (!want || !known || want === known) await setNetwork(k);
      else {
        const eth = getState().current?.provider;
        if (eth) await switchEvm(eth, want);
      }
    } catch { /* the next step asks the wallet again */ }
  }
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <RageNetworkPicker value={chainKey} onChange={choose} />
      {chainKey === "solana" ? <AdminSolPool mode={mode} /> : <AdminEvmPool key={chainKey} mode={mode} chainKey={chainKey} />}
    </div>
  );
}

function AdminEvmPool({ mode, chainKey }: { mode: "deploy" | "add" | "remove" | "all"; chainKey: EvmRageChain }) {
  const CHAIN = CHAINS[chainKey];
  const ROUTER = CHAIN.router ? getAddress(CHAIN.router) : undefined;
  const gasNative = RAGE_GAS[chainKey];
  const vc = useMemo(() => viemChain(CHAIN), [CHAIN]);
  const pub = useMemo(() => createPublicClient({ chain: vc, transport: http(CHAIN.rpc) }) as any, [vc, CHAIN.rpc]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [buyTax, setBuyTax] = useState("0");
  const [sellTax, setSellTax] = useState("0");
  const [taxWallet, setTaxWallet] = useState("");
  const [tokenIn, setTokenIn] = useState("");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [amtToken, setAmtToken] = useState("");
  const [amtCoin, setAmtCoin] = useState("");
  const [buyAmt, setBuyAmt] = useState("");
  const [pct, setPct] = useState(100);
  const [askRemove, setAskRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const token = isAddress(tokenIn.trim()) ? getAddress(tokenIn.trim()) : null;
  const buyBps = rageTaxBps(buyTax);
  const sellBps = rageTaxBps(sellTax);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${SAVED}:${chainKey}`) || (chainKey === "bsc" ? localStorage.getItem(SAVED) : null);
      if (saved && isAddress(saved)) setTokenIn(getAddress(saved));
    } catch { /* private mode */ }
  }, [chainKey]);

  useEffect(() => {
    setInfo(null);
    if (!token || !ROUTER) return;
    let gone = false;
    (async () => {
      try {
        const [sym, decimals, factory, weth] = await Promise.all([
          pub.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
          pub.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
          pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "factory" }),
          pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "WETH" }),
        ]);
        const pair = (await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [token, weth] })) as `0x${string}`;
        let rToken = 0n, rCoin = 0n, lp = 0n, lpTotal = 0n, tokenBal = 0n, coinBal = 0n;
        if (pair !== ZERO) {
          const [t0, reserves, total] = await Promise.all([
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }),
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }),
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "totalSupply" }),
          ]);
          const [r0, r1] = reserves as [bigint, bigint, number];
          [rToken, rCoin] = getAddress(t0 as string) === token ? [r0, r1] : [r1, r0];
          lpTotal = total as bigint;
          if (account) lp = (await pub.readContract({ address: pair, abi: ERC20, functionName: "balanceOf", args: [account] })) as bigint;
        }
        if (account) {
          [tokenBal, coinBal] = await Promise.all([
            pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] }),
            pub.getBalance({ address: account }),
          ]) as [bigint, bigint];
        }
        const live = await pub.readContract({ address: token, abi: parseAbi(["function tradingLive() view returns (bool)"]), functionName: "tradingLive" }).then((x: unknown) => Boolean(x)).catch(() => null);
        const buyTaxBps = await pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "buyTaxBps" }).then((x: unknown) => Number(x)).catch(() => null);
        const sellTaxBps = await pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "sellTaxBps" }).then((x: unknown) => Number(x)).catch(() => null);
        if (!gone) setInfo({ symbol: String(sym), decimals: Number(decimals), pair: pair === ZERO ? null : pair, rToken, rCoin, lp, lpTotal, tokenBal, coinBal, live, buyTaxBps, sellTaxBps });
      } catch {
        if (!gone) setMsg(`Couldn't read that token on ${CHAIN.name}. Check the address.`);
      }
    })();
    return () => { gone = true; };
  }, [token, account, tick, pub, ROUTER, CHAIN.name]);

  function fail(e: any) {
    const m = String(e?.shortMessage || e?.message || "");
    setMsg(/rejected|denied|cancel/i.test(m) ? "You cancelled in your wallet." : /INSUFFICIENT_\w*_AMOUNT|not live/i.test(m) ? (/not live/i.test(m) ? "Trading is still closed, so the pool can't send the tokens back yet. Tap Remove liquidity again." : "The price moved. Try again.") : m || "Something went wrong.");
  }

  function remember(at: string) {
    try {
      localStorage.setItem(`${SAVED}:${chainKey}`, at);
      if (chainKey === "bsc") localStorage.setItem(SAVED, at);
    } catch { /* ignore */ }
  }

  async function wallet() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const w = createWalletClient({ chain: vc, transport: custom(eth) }) as any;
    const [acc] = await w.requestAddresses();
    try { await w.switchChain({ id: CHAIN.chainId }); } catch { await w.addChain({ chain: vc }); await w.switchChain({ id: CHAIN.chainId }); }
    setAccount(acc);
    return { w, acc: acc as `0x${string}` };
  }

  async function send(w: any, acc: `0x${string}`, req: any, what: string) {
    setMsg(`${what}: confirm in your wallet…`);
    const hash = await w.writeContract({ account: acc, chain: vc, ...req });
    setMsg(`${what}: waiting on ${CHAIN.name}…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed.`);
    return hash as string;
  }

  async function approveIfNeeded(w: any, acc: `0x${string}`, address: `0x${string}`, amount: bigint, what: string) {
    if (!ROUTER) return;
    const allowance = (await pub.readContract({ address, abi: ERC20, functionName: "allowance", args: [acc, ROUTER] })) as bigint;
    if (allowance < amount) await send(w, acc, { address, abi: ERC20, functionName: "approve", args: [ROUTER, amount] }, what);
  }

  async function deploy() {
    const n = name.trim();
    const s = symbol.trim().replace(/^\$/, "").toUpperCase();
    if (!n || n.length > 32) { setMsg("Name must be 1–32 characters."); return; }
    if (!/^[A-Z0-9]{1,12}$/.test(s)) { setMsg("Ticker must be 1–12 letters or numbers."); return; }
    if (buyBps == null || sellBps == null) { setMsg(`Buy tax and sell tax must each be 0–${MAX_RAGE_TAX}%.`); return; }
    let taxTo: `0x${string}` = ZERO;
    if ((buyBps > 0 || sellBps > 0) && taxWallet.trim()) {
      if (!isAddress(taxWallet.trim())) { setMsg("Tax wallet must be a 0x address, or leave it blank to use this wallet."); return; }
      taxTo = getAddress(taxWallet.trim());
    }
    if (!ROUTER) { setMsg(`${CHAIN.name} has no exchange router set.`); return; }
    let units: bigint;
    try { units = parseUnits(supply.replace(/[,_\s]/g, ""), 18); } catch { setMsg("Supply must be a number."); return; }
    if (units <= 0n) { setMsg("Supply must be more than zero."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const data = encodeDeployData({ abi: ADMIN_DIRECT_TOKEN_ABI, bytecode: ADMIN_DIRECT_TOKEN_BYTECODE, args: [n, s, units, BigInt(buyBps), BigInt(sellBps), taxTo, ROUTER] });
      const taxNote = buyBps || sellBps ? ` Buy tax ${buyBps / 100}%, sell tax ${sellBps / 100}%.` : "";
      setMsg(`Confirm in your wallet: deploy the token on ${CHAIN.name}.${taxNote} The whole supply comes to this wallet.`);
      const hash = await w.sendTransaction({ account: acc, chain: vc, data });
      setMsg("Waiting for the deploy…");
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success" || !r.contractAddress) throw new Error("The deploy failed.");
      const at = getAddress(r.contractAddress);
      remember(at);
      setTokenIn(at);
      setMsg(`✅ ${s} deployed on ${CHAIN.name}. Now add the liquidity below. ${CHAIN.explorer}/token/${at}`);
      setTick((x) => x + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function add() {
    if (!info || !token || !ROUTER) return;
    let tokens: bigint, coin: bigint;
    try { tokens = parseUnits(amtToken, info.decimals); coin = parseEther(amtCoin); } catch { setMsg("Type both amounts as numbers."); return; }
    if (tokens <= 0n || coin <= 0n) { setMsg("Type both amounts."); return; }
    if (!buyAmt.trim()) { setMsg(`Set the first-buy amount first. That buy is sent right after the liquidity, before any other trade.`); return; }
    let parsedBuy: bigint;
    try { parsedBuy = parseEther(buyAmt); } catch { setMsg(`Type the first-buy amount in ${CHAIN.coin}.`); return; }
    const buyCoin: bigint = parsedBuy;
    if (buyCoin <= 0n) { setMsg(`Type the first-buy amount in ${CHAIN.coin}.`); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const bal = (await pub.getBalance({ address: acc })) as bigint;
      const need = coin + buyCoin + parseEther(String(gasNative * 3));
      if (bal < need) {
        setMsg(`Not enough ${CHAIN.coin}: you have ${fmt(bal, 18)} ${CHAIN.coin}, and this needs about ${fmt(need, 18)} (${amtCoin} for the liquidity + ${buyAmt} for the first buy + ~${(gasNative * 3).toFixed(4)} for gas). Add ${CHAIN.coin}, or lower the liquidity or first-buy amount.`);
        return;
      }
      const priced = info.rToken > 0n && info.rCoin > 0n;
      await approveIfNeeded(w, acc, token, tokens, `Allow ${CHAIN.dex} to use your ${info.symbol}`);
      const hash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "addLiquidityETH", value: coin,
        args: [token, tokens, priced ? slip(tokens) : 0n, priced ? slip(coin) : 0n, acc, deadline()],
      }, "Add liquidity");
      reportActivity("liquidity", CHAIN.key, hash, `Admin added ${amtToken} ${info.symbol} + ${amtCoin} ${CHAIN.coin}`);
      setAmtToken(""); setAmtCoin(""); setTick((x) => x + 1);
      setMsg("Liquidity is in. Approve the first buy in your wallet. It goes out before any other trade.");
      const ok = await firstBuyWith(w, acc, buyCoin);
      if (!ok) return;
      if (mode === "all" && confirm("Done. Remove the liquidity now?")) setAskRemove(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** The first buy, then open trading. Returns false if a step didn't go through (the Continue panel stays up). */
  async function firstBuyWith(w: any, acc: `0x${string}`, buyCoin: bigint): Promise<boolean> {
    if (!token || !info || !ROUTER) return false;
    try {
      const bal = (await pub.getBalance({ address: acc })) as bigint;
      const gas = parseEther(String(gasNative));
      if (bal < buyCoin + gas) {
        const fit = bal > gas ? bal - gas : 0n;
        setMsg(`The first buy needs ${fmt(buyCoin, 18)} ${CHAIN.coin} + gas, but this wallet has ${fmt(bal, 18)} ${CHAIN.coin} left. Add ${CHAIN.coin} and tap "Sign first buy" again${fit > 0n ? `, or tap "Buy with what's left" (${fmt(fit, 18)} ${CHAIN.coin})` : ""}. The liquidity is safe in the pool.`);
        return false;
      }
      const weth = (await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "WETH" })) as `0x${string}`;
      const amounts = (await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [buyCoin, [weth, token]] })) as bigint[];
      const outMin = slip(amounts[amounts.length - 1] ?? 0n);
      const buyHash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", value: buyCoin,
        args: [outMin, [weth, token], acc, deadline()],
      }, "First buy");
      reportActivity("swap", CHAIN.key, buyHash, `First buy ${fmt(buyCoin, 18)} ${CHAIN.coin} of ${info.symbol}`);
      setTick((x) => x + 1);
      const opened = await openTradingWith(w, acc);
      if (!opened) { setMsg(`✅ First buy is in (${CHAIN.explorer}/tx/${buyHash}). Now tap "Open trading" to finish.`); return false; }
      setMsg(`✅ First buy is in, and trading is open now. ${CHAIN.explorer}/tx/${buyHash}`);
      setBuyAmt("");
      return true;
    } catch (e) { fail(e); setMsg((m) => `${m} The liquidity is safe in the pool: tap "Sign first buy" to try again.`); return false; }
  }
  async function openTradingWith(w: any, acc: `0x${string}`): Promise<boolean> {
    if (!token) return false;
    const live = await pub.readContract({ address: token, abi: parseAbi(["function tradingLive() view returns (bool)"]), functionName: "tradingLive" }).catch(() => null);
    if (live !== false) return true;
    try {
      await send(w, acc, { address: token, abi: parseAbi(["function enableTrading()"]), functionName: "enableTrading" }, "Open trading");
      setTick((x) => x + 1);
      return true;
    } catch (e) { fail(e); return false; }
  }
  /** Continue panel buttons: sign the first buy (typed amount or all that's left), or just open trading. */
  async function continueBuy(useAll: boolean) {
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      let amt: bigint;
      if (useAll) {
        const bal = (await pub.getBalance({ address: acc })) as bigint, gas = parseEther(String(gasNative));
        if (bal <= gas) { setMsg(`This wallet has ${fmt(bal, 18)} ${CHAIN.coin}: not enough for a buy plus gas. Add ${CHAIN.coin} first.`); return; }
        amt = bal - gas;
      } else {
        try { amt = parseEther(buyAmt || "0"); } catch { setMsg(`Type the first-buy amount in ${CHAIN.coin}.`); return; }
        if (amt <= 0n) { setMsg(`Type the first-buy amount in ${CHAIN.coin}.`); return; }
      }
      const ok = await firstBuyWith(w, acc, amt);
      if (ok && mode === "all" && confirm("Done. Remove the liquidity now?")) setAskRemove(true);
    } finally { setBusy(false); }
  }
  async function continueOpen() {
    if (!confirm("Open trading without the first buy? Anyone can buy straight away.")) return;
    setBusy(true);
    try { const { w, acc } = await wallet(); if (await openTradingWith(w, acc)) setMsg("✅ Trading is open."); } finally { setBusy(false); }
  }

  async function remove() {
    if (!info?.pair || !token || !ROUTER) return;
    if (!confirm(`Remove ${pct}% of the LP in this wallet? The tokens and ${CHAIN.coin} come back here. Liquidity that was burned or locked on a normal launch is not touched.`)) return;
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const [t0, reserves, total, lpBal] = await Promise.all([
        pub.readContract({ address: info.pair, abi: PAIR_ABI, functionName: "token0" }),
        pub.readContract({ address: info.pair, abi: PAIR_ABI, functionName: "getReserves" }),
        pub.readContract({ address: info.pair, abi: PAIR_ABI, functionName: "totalSupply" }),
        pub.readContract({ address: info.pair, abi: ERC20, functionName: "balanceOf", args: [acc] }),
      ]);
      const lpNow = lpBal as bigint;
      const amount = (lpNow * BigInt(pct)) / 100n;
      if (amount <= 0n) { setMsg("This wallet has no LP to remove."); return; }
      const [r0, r1] = reserves as [bigint, bigint, number];
      const rToken = getAddress(t0 as string) === token ? r0 : r1;
      const rCoin = getAddress(t0 as string) === token ? r1 : r0;
      const supply = total as bigint;
      const shareToken = supply > 0n ? (rToken * amount) / supply : 0n;
      const shareCoin = supply > 0n ? (rCoin * amount) / supply : 0n;
      await approveIfNeeded(w, acc, info.pair, amount, `Allow ${CHAIN.dex} to use your LP tokens`);
      const closed = await pub.readContract({ address: token, abi: parseAbi(["function tradingLive() view returns (bool)"]), functionName: "tradingLive" }).catch(() => null);
      if (closed === false) {
        let blocked = false;
        try {
          await pub.simulateContract({
            address: ROUTER, abi: ROUTER_ABI, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens",
            args: [token, amount, 0n, 0n, acc, deadline()], account: acc,
          });
        } catch (e: any) {
          blocked = /not live/i.test(String(e?.shortMessage || e?.message || e?.cause?.shortMessage || ""));
        }
        if (blocked) await send(w, acc, { address: token, abi: parseAbi(["function enableTrading()"]), functionName: "enableTrading" }, "Open trading so the pool can send the tokens back");
      }
      const loose = (v: bigint) => (v * 5000n) / 10_000n;
      const hash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens",
        args: [token, amount, loose(shareToken), loose(shareCoin), acc, deadline()],
      }, `Remove ${pct}% of your liquidity`);
      reportActivity("liquidity", CHAIN.key, hash, `Admin removed ${pct}% of ${info.symbol} liquidity`);
      setMsg(`✅ Removed ${pct}% of the liquidity in this wallet. ${CHAIN.explorer}/tx/${hash}`);
      setTick((x) => x + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const priced = !!info && info.rToken > 0n && info.rCoin > 0n;
  function onToken(v: string) {
    setAmtToken(v);
    if (!priced || !info) return;
    try { setAmtCoin(formatUnits((parseUnits(v || "0", info.decimals) * info.rCoin) / info.rToken, 18).replace(/\.?0+$/, "")); } catch { setAmtCoin(""); }
  }
  const share = info && info.lpTotal > 0n ? { token: (info.rToken * info.lp) / info.lpTotal, coin: (info.rCoin * info.lp) / info.lpTotal } : null;

  const showDeploy = mode === "all" || mode === "deploy";
  const showAdd = mode === "all" || mode === "add";
  const showRemove = mode === "all" || mode === "remove";
  const title = mode === "add" ? "Add LP" : mode === "remove" ? "Remove LP" : "Rage";
  const blurb = mode === "all"
    ? `Deploy the token on ${CHAIN.name}, add the liquidity, then it asks if you want to remove that liquidity. The LP stays in this wallet.`
    : mode === "deploy"
    ? `Deploy the token on ${CHAIN.name}. The whole supply comes to this wallet.`
    : mode === "add"
    ? `Add ${CHAIN.coin} and tokens on ${CHAIN.dex}. The LP stays in this wallet.`
    : `Remove LP sitting in this wallet. The tokens and ${CHAIN.coin} come back here. Liquidity that was burned or locked on a normal launch cannot be pulled.`;
  const gasLeft = account && info && info.coinBal > parseEther(String(gasNative)) ? info.coinBal - parseEther(String(gasNative)) : 0n;
  return (
    <>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>{blurb}</p>
      {!account && <button className="btn small" type="button" disabled={busy} onClick={() => wallet().catch(fail)}>Connect wallet</button>}
      {account && <small className="muted">Wallet <span className="mono">{account.slice(0, 6)}…{account.slice(-4)}</span> on {CHAIN.name}</small>}

      {showDeploy && (
        <>
          <b>1. Deploy the token</b>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" maxLength={32} /></label>
          <label className="field"><span>Ticker</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="TOK" maxLength={12} /></label>
          <label className="field"><span>Supply (whole tokens)</span><input value={supply} onChange={(e) => setSupply(e.target.value)} inputMode="decimal" placeholder="1000000000" /></label>
          <label className="field"><span>Buy tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={buyTax} onChange={(e) => setBuyTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Buy tax percent" /></label>
          <label className="field"><span>Sell tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={sellTax} onChange={(e) => setSellTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Sell tax percent" /></label>
          {(buyBps != null && sellBps != null && (buyBps > 0 || sellBps > 0)) && (
            <label className="field"><span>Tax wallet <small className="muted">optional, blank uses the wallet you deploy with</small></span><input value={taxWallet} onChange={(e) => setTaxWallet(e.target.value)} placeholder="0x…" spellCheck={false} aria-label="Tax wallet" /></label>
          )}
          <button className="btn primary" type="button" disabled={busy || !name.trim() || !symbol.trim()} onClick={deploy}>Deploy token</button>
        </>
      )}

      <b>2. Token</b>
      <input value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); try { if (isAddress(e.target.value.trim())) remember(getAddress(e.target.value.trim())); } catch { /* ignore */ } }} placeholder="Token address (filled in after deploy)" spellCheck={false} aria-label="Token address" />
      {info && (
        <>
          <div className="notice">
            🪙 <b>{info.symbol}</b>
            {info.buyTaxBps != null && info.sellTaxBps != null && <> · tax {info.buyTaxBps / 100}% buy · {info.sellTaxBps / 100}% sell</>}
            {" "}· {priced ? <>pool: {fmt(info.rToken, info.decimals)} {info.symbol} + {fmt(info.rCoin, 18)} {CHAIN.coin}</> : <>no pool yet: the amounts you add set the starting price</>}
            {account && <><br /><small>You have {fmt(info.tokenBal, info.decimals)} {info.symbol} and {fmt(info.coinBal, 18)} {CHAIN.coin}</small></>}
            {info.pair && <><br /><small>Pool <a href={`${CHAIN.explorer}/address/${info.pair}`} target="_blank" rel="noreferrer">{info.pair.slice(0, 8)}…{info.pair.slice(-4)}</a></small></>}
          </div>
          {showAdd && info.live === false && info.rToken > 0n && (
            <div className="notice stack" style={{ gap: 6, borderColor: "#f0b90b" }}>
              <b>▶ Continue: liquidity is in, trading is still closed</b>
              <small>Finish with the first buy (it goes out before anyone else can trade), then trading opens. If a step fails, just sign it again here: nothing is lost.</small>
              <label className="field"><span>First buy ({CHAIN.coin})</span><input value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.trim())} inputMode="decimal" placeholder="0.01" aria-label={`First buy amount in ${CHAIN.coin}`} /></label>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="btn primary" type="button" disabled={busy || !buyAmt} onClick={() => continueBuy(false)}>Sign first buy</button>
                <button className="btn" type="button" disabled={busy} onClick={() => continueBuy(true)}>Buy with what&apos;s left{gasLeft > 0n ? ` (${fmt(gasLeft, 18)} ${CHAIN.coin})` : ""}</button>
                <button className="btn ghost" type="button" disabled={busy} onClick={continueOpen}>Skip the buy, just open trading</button>
              </div>
            </div>
          )}
          {showAdd && (
            <>
              <b>First buy</b>
              <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Set this before you add liquidity. Trading stays closed until this wallet&apos;s buy is in, then it opens. You approve each step in the wallet.</p>
              <label className="field"><span>Amount ({CHAIN.coin})</span><input value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.trim())} inputMode="decimal" placeholder="0.01" aria-label={`First buy amount in ${CHAIN.coin}`} /></label>
              <b>3. Add liquidity</b>
              <label className="field"><span>{info.symbol}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>{CHAIN.coin}</span><input value={amtCoin} onChange={(e) => setAmtCoin(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <button className="btn primary" type="button" disabled={busy || !amtToken || !amtCoin || !buyAmt} onClick={add}>Add liquidity</button>
            </>
          )}
          {showRemove && (askRemove || mode !== "all" || info.lp > 0n) && (
            info.pair ? (
              account ? (
                info.lp > 0n ? (
                  <>
                    <b>4. Remove liquidity?</b>
                    <small>LP in this wallet: {fmt(info.lp, 18)}{share ? <> (about {fmt(share.token, info.decimals)} {info.symbol} + {fmt(share.coin, 18)} {CHAIN.coin})</> : null}</small>
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
