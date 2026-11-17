"use client";
import { pickWallet } from "@/lib/connect";
import { reportActivity } from "@/lib/activity-client";
import { ADMIN_DIRECT_TOKEN_ABI, ADMIN_DIRECT_TOKEN_BYTECODE } from "@/lib/admin-direct-token";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeDeployData, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";

/**
 * Owner admin session only. One flow: deploy, add liquidity, then ask to remove it.
 * Does not touch LP that a normal launch burned or locked.
 */
const CHAIN = CHAINS.bsc;
const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as const;
const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256)",
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
const ZERO = "0x0000000000000000000000000000000000000000";
const SAVED = "autistik-admin-direct-token";
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const slip = (v: bigint) => (v * 9500n) / 10_000n;

type Info = {
  symbol: string; decimals: number; pair: `0x${string}` | null;
  rToken: bigint; rCoin: bigint; lp: bigint; lpTotal: bigint; tokenBal: bigint; coinBal: bigint;
};

export default function AdminDirectPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  const vc = useMemo(() => viemChain(CHAIN), []);
  const pub = useMemo(() => createPublicClient({ chain: vc, transport: http(CHAIN.rpc) }) as any, [vc]);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("1000000000");
  const [tokenIn, setTokenIn] = useState("");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [amtToken, setAmtToken] = useState("");
  const [amtCoin, setAmtCoin] = useState("");
  const [pct, setPct] = useState(100);
  const [askRemove, setAskRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const token = isAddress(tokenIn.trim()) ? getAddress(tokenIn.trim()) : null;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED);
      if (saved && isAddress(saved)) setTokenIn(saved);
    } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    setInfo(null);
    if (!token) return;
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
        if (!gone) setInfo({ symbol: String(sym), decimals: Number(decimals), pair: pair === ZERO ? null : pair, rToken, rCoin, lp, lpTotal, tokenBal, coinBal });
      } catch {
        if (!gone) setMsg("Couldn't read that token on BNB Chain. Check the address.");
      }
    })();
    return () => { gone = true; };
  }, [token, account, tick, pub]);

  function fail(e: any) {
    const m = String(e?.shortMessage || e?.message || "");
    setMsg(/rejected|denied|cancel/i.test(m) ? "You cancelled in your wallet." : /INSUFFICIENT_\w*_AMOUNT/.test(m) ? "The price moved. Try again." : m || "Something went wrong.");
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
    setMsg(`${what}: waiting on BNB Chain…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed.`);
    return hash as string;
  }

  async function approveIfNeeded(w: any, acc: `0x${string}`, address: `0x${string}`, amount: bigint, what: string) {
    const allowance = (await pub.readContract({ address, abi: ERC20, functionName: "allowance", args: [acc, ROUTER] })) as bigint;
    if (allowance < amount) await send(w, acc, { address, abi: ERC20, functionName: "approve", args: [ROUTER, amount] }, what);
  }

  async function deploy() {
    const n = name.trim();
    const s = symbol.trim().replace(/^\$/, "").toUpperCase();
    if (!n || n.length > 32) { setMsg("Name must be 1–32 characters."); return; }
    if (!/^[A-Z0-9]{1,12}$/.test(s)) { setMsg("Ticker must be 1–12 letters or numbers."); return; }
    let units: bigint;
    try { units = parseUnits(supply.replace(/[,_\s]/g, ""), 18); } catch { setMsg("Supply must be a number."); return; }
    if (units <= 0n) { setMsg("Supply must be more than zero."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const data = encodeDeployData({ abi: ADMIN_DIRECT_TOKEN_ABI, bytecode: ADMIN_DIRECT_TOKEN_BYTECODE, args: [n, s, units] });
      setMsg("Confirm in your wallet: deploy the token. The whole supply comes to this wallet.");
      const hash = await w.sendTransaction({ account: acc, chain: vc, data });
      setMsg("Waiting for the deploy…");
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success" || !r.contractAddress) throw new Error("The deploy failed.");
      const at = getAddress(r.contractAddress);
      try { localStorage.setItem(SAVED, at); } catch { /* ignore */ }
      setTokenIn(at);
      setMsg(`✅ ${s} deployed. Now add the liquidity below. ${CHAIN.explorer}/token/${at}`);
      setTick((x) => x + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function add() {
    if (!info || !token || !ROUTER) return;
    let tokens: bigint, coin: bigint;
    try { tokens = parseUnits(amtToken, info.decimals); coin = parseEther(amtCoin); } catch { setMsg("Type both amounts as numbers."); return; }
    if (tokens <= 0n || coin <= 0n) { setMsg("Type both amounts."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const priced = info.rToken > 0n && info.rCoin > 0n;
      await approveIfNeeded(w, acc, token, tokens, `Allow ${CHAIN.dex} to use your ${info.symbol}`);
      const hash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "addLiquidityETH", value: coin,
        args: [token, tokens, priced ? slip(tokens) : 0n, priced ? slip(coin) : 0n, acc, deadline()],
      }, "Add liquidity");
      reportActivity("liquidity", CHAIN.key, hash, `Admin added ${amtToken} ${info.symbol} + ${amtCoin} ${CHAIN.coin}`);
      setMsg(`✅ Liquidity added. The LP stayed in this wallet. ${CHAIN.explorer}/tx/${hash}`);
      setAmtToken(""); setAmtCoin(""); setTick((x) => x + 1);
      if (mode === "all" && confirm("Liquidity is in. Remove it now?")) setAskRemove(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function remove() {
    if (!info?.pair || !token || info.lp <= 0n) return;
    const amount = (info.lp * BigInt(pct)) / 100n;
    if (amount <= 0n) return;
    if (!confirm(`Remove ${pct}% of the LP in this wallet? The tokens and ${CHAIN.coin} come back here. Liquidity that was burned or locked on a normal launch is not touched.`)) return;
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const shareToken = info.lpTotal > 0n ? (info.rToken * amount) / info.lpTotal : 0n;
      const shareCoin = info.lpTotal > 0n ? (info.rCoin * amount) / info.lpTotal : 0n;
      await approveIfNeeded(w, acc, info.pair, amount, `Allow ${CHAIN.dex} to use your LP tokens`);
      const hash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens",
        args: [token, amount, slip(shareToken), slip(shareCoin), acc, deadline()],
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
    ? "Deploy the token, add the liquidity, then it asks if you want to remove that liquidity. The LP stays in this wallet."
    : mode === "deploy"
    ? "Deploy the token on live BNB Chain. The whole supply comes to this wallet."
    : mode === "add"
    ? "Add BNB and tokens on PancakeSwap. The LP stays in this wallet."
    : "Remove LP sitting in this wallet. The tokens and BNB come back here. Liquidity that was burned or locked on a normal launch cannot be pulled.";
  return (
    <div className="card stack" style={{ gap: 10 }}>
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
          <button className="btn primary" type="button" disabled={busy || !name.trim() || !symbol.trim()} onClick={deploy}>Deploy token</button>
        </>
      )}

      <b>2. Token</b>
      <input value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); try { if (isAddress(e.target.value.trim())) localStorage.setItem(SAVED, getAddress(e.target.value.trim())); } catch { /* ignore */ } }} placeholder="Token address (filled in after deploy)" spellCheck={false} aria-label="Token address" />
      {info && (
        <>
          <div className="notice">
            🪙 <b>{info.symbol}</b> · {priced ? <>pool: {fmt(info.rToken, info.decimals)} {info.symbol} + {fmt(info.rCoin, 18)} {CHAIN.coin}</> : <>no pool yet: the amounts you add set the starting price</>}
            {account && <><br /><small>You have {fmt(info.tokenBal, info.decimals)} {info.symbol} and {fmt(info.coinBal, 18)} {CHAIN.coin}</small></>}
            {info.pair && <><br /><small>Pool <a href={`${CHAIN.explorer}/address/${info.pair}`} target="_blank" rel="noreferrer">{info.pair.slice(0, 8)}…{info.pair.slice(-4)}</a></small></>}
          </div>
          {showAdd && (
            <>
              <b>3. Add liquidity</b>
              <label className="field"><span>{info.symbol}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>{CHAIN.coin}</span><input value={amtCoin} onChange={(e) => setAmtCoin(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <button className="btn primary" type="button" disabled={busy || !amtToken || !amtCoin} onClick={add}>Add liquidity</button>
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
    </div>
  );
}
