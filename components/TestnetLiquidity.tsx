"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, defineChain, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";

/**
 * Admin only: add AND remove liquidity on BNB Chain TESTNET (free test BNB from the faucet), so a token's whole
 * liquidity cycle can be tried quickly before anything goes on mainnet. Talks straight to the PancakeSwap v2 testnet
 * router from the connected wallet. Mainnet liquidity stays add-only here: on mainnet it's locked or burned.
 */
const TESTNET = defineChain({
  id: 97, name: "BNB Chain Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://testnet.bscscan.com" } },
  testnet: true,
});
const EXPLORER = "https://testnet.bscscan.com";
const ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1" as const;
const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256)",
]);
const FACTORY_ABI = parseAbi(["function getPair(address, address) view returns (address)"]);
const PAIR_ABI = parseAbi(["function token0() view returns (address)", "function getReserves() view returns (uint112, uint112, uint32)", "function totalSupply() view returns (uint256)"]);
const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

type Info = { symbol: string; decimals: number; pair: `0x${string}` | null; rToken: bigint; rCoin: bigint; lp: bigint; lpTotal: bigint; tokenBal: bigint; coinBal: bigint };

export default function TestnetLiquidity() {
  const pub = useMemo(() => createPublicClient({ chain: TESTNET, transport: http() }) as any, []);
  const [tokenIn, setTokenIn] = useState("");
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [amtToken, setAmtToken] = useState("");
  const [amtCoin, setAmtCoin] = useState("");
  const [pct, setPct] = useState(100);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const token = isAddress(tokenIn.trim()) ? getAddress(tokenIn.trim()) : null;

  useEffect(() => {
    setInfo(null);
    if (!token) return;
    let gone = false;
    (async () => {
      try {
        const [symbol, decimals, factory, weth] = await Promise.all([
          pub.readContract({ address: token, abi: ERC20, functionName: "symbol" }),
          pub.readContract({ address: token, abi: ERC20, functionName: "decimals" }),
          pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "factory" }),
          pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "WETH" }),
        ]);
        const pair = (await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [token, weth] })) as `0x${string}`;
        let rToken = 0n, rCoin = 0n, lp = 0n, lpTotal = 0n, tokenBal = 0n, coinBal = 0n;
        if (pair !== ZERO) {
          const [t0, [r0, r1], total] = await Promise.all([
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }),
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }),
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "totalSupply" }),
          ]);
          [rToken, rCoin] = getAddress(t0) === token ? [r0, r1] : [r1, r0];
          lpTotal = total;
          if (account) lp = await pub.readContract({ address: pair, abi: ERC20, functionName: "balanceOf", args: [account] });
        }
        if (account) [tokenBal, coinBal] = await Promise.all([pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] }), pub.getBalance({ address: account })]);
        if (!gone) setInfo({ symbol: String(symbol), decimals: Number(decimals), pair: pair === ZERO ? null : pair, rToken, rCoin, lp, lpTotal, tokenBal, coinBal });
      } catch {
        if (!gone) setMsg("Couldn't read that token on BNB Chain Testnet. Check the address.");
      }
    })();
    return () => { gone = true; };
  }, [token, account, tick, pub]);

  async function wallet() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const w = createWalletClient({ chain: TESTNET, transport: custom(eth) }) as any;
    const [acc] = await w.requestAddresses();
    try { await w.switchChain({ id: 97 }); } catch { await w.addChain({ chain: TESTNET }); await w.switchChain({ id: 97 }); }
    setAccount(acc);
    return { w, acc: acc as `0x${string}` };
  }

  async function send(w: any, acc: `0x${string}`, req: any, what: string) {
    setMsg(`${what}: confirm in your wallet…`);
    const hash = await w.writeContract({ account: acc, chain: TESTNET, ...req });
    setMsg(`${what}: waiting for the testnet…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed.`);
    return hash as string;
  }

  async function approveIfNeeded(w: any, acc: `0x${string}`, address: `0x${string}`, amount: bigint, what: string) {
    const allowance = (await pub.readContract({ address, abi: ERC20, functionName: "allowance", args: [acc, ROUTER] })) as bigint;
    if (allowance < amount) await send(w, acc, { address, abi: ERC20, functionName: "approve", args: [ROUTER, amount] }, what);
  }

  function fail(e: any) {
    const m = String(e?.shortMessage || e?.message || "");
    setMsg(/rejected|denied|cancel/i.test(m) ? "You cancelled in your wallet." : /INSUFFICIENT_\w*_AMOUNT/.test(m) ? "The price moved. Try again." : m || "Something went wrong.");
  }

  async function add() {
    if (!info || !token) return;
    let tokens: bigint, coin: bigint;
    try { tokens = parseUnits(amtToken, info.decimals); coin = parseEther(amtCoin); } catch { setMsg("Type both amounts as numbers."); return; }
    if (tokens <= 0n || coin <= 0n) { setMsg("Type both amounts."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      await approveIfNeeded(w, acc, token, tokens, `Allow PancakeSwap to use your ${info.symbol}`);
      const hash = await send(w, acc, { address: ROUTER, abi: ROUTER_ABI, functionName: "addLiquidityETH", value: coin, args: [token, tokens, 0n, 0n, acc, deadline()] }, "Add liquidity");
      setMsg(`✅ Liquidity added on testnet. ${EXPLORER}/tx/${hash}`);
      setAmtToken(""); setAmtCoin(""); setTick((t) => t + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function remove() {
    if (!info?.pair || !token || info.lp <= 0n) return;
    const amount = (info.lp * BigInt(pct)) / 100n;
    if (amount <= 0n) return;
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      await approveIfNeeded(w, acc, info.pair, amount, "Allow PancakeSwap to use your LP tokens");
      const hash = await send(w, acc, { address: ROUTER, abi: ROUTER_ABI, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens", args: [token, amount, 0n, 0n, acc, deadline()] }, `Remove ${pct}% of your liquidity`);
      setMsg(`✅ Removed ${pct}% of your liquidity on testnet. ${EXPLORER}/tx/${hash}`);
      setTick((t) => t + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const priced = !!info && info.rToken > 0n && info.rCoin > 0n;
  function onToken(v: string) {
    setAmtToken(v);
    if (!priced || !info) return;
    try { setAmtCoin(formatUnits((parseUnits(v || "0", info.decimals) * info.rCoin) / info.rToken, 18)); } catch { setAmtCoin(""); }
  }
  const share = info && info.lpTotal > 0n ? { token: (info.rToken * info.lp) / info.lpTotal, coin: (info.rCoin * info.lp) / info.lpTotal } : null;

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h3 style={{ margin: 0 }}>🧪 Test liquidity: add and remove (BNB Chain Testnet)</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>
        Try the whole cycle with free test BNB before going live: add liquidity, then take it back out. Straight through the PancakeSwap testnet router from your wallet. Get test BNB from the <a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noreferrer">BNB Chain faucet</a>. Mainnet liquidity is locked or burned, so it has no remove button.
      </p>
      <input value={tokenIn} onChange={(e) => setTokenIn(e.target.value)} placeholder="Testnet token address (0x…)" spellCheck={false} aria-label="Testnet token address" />
      {!account && <button className="btn small" type="button" disabled={busy} onClick={() => wallet().catch(fail)}>Connect wallet</button>}
      {account && <small className="muted">Wallet <span className="mono">{account.slice(0, 6)}…{account.slice(-4)}</span> on BNB Chain Testnet</small>}
      {info && (
        <>
          <div className="notice">
            🪙 <b>{info.symbol}</b> · {priced ? <>pool: {fmt(info.rToken, info.decimals)} {info.symbol} + {fmt(info.rCoin, 18)} tBNB</> : <>no pool yet: the amounts you add set the starting price</>}
            {account && <><br /><small>You have {fmt(info.tokenBal, info.decimals)} {info.symbol} and {fmt(info.coinBal, 18)} tBNB</small></>}
          </div>
          <b>Add</b>
          <label className="field"><span>{info.symbol}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          <label className="field"><span>tBNB</span><input value={amtCoin} onChange={(e) => setAmtCoin(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          <button className="btn primary" type="button" disabled={busy || !amtToken || !amtCoin} onClick={add}>Add liquidity</button>
          {info.pair && (
            <>
              <b>Remove</b>
              {account ? (
                info.lp > 0n ? (
                  <>
                    <small>Your LP: {fmt(info.lp, 18)}{share ? <> (about {fmt(share.token, info.decimals)} {info.symbol} + {fmt(share.coin, 18)} tBNB)</> : null}</small>
                    <label className="field"><span>Remove <b>{pct}%</b></span><input type="range" min={1} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Share of liquidity to remove" /></label>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                      {[25, 50, 100].map((p) => <button key={p} type="button" className={"btn small" + (pct === p ? " primary" : "")} onClick={() => setPct(p)}>{p}%</button>)}
                    </div>
                    <button className="btn" type="button" disabled={busy} onClick={remove}>Remove liquidity</button>
                  </>
                ) : <small className="muted">This wallet has no LP tokens in this pool.</small>
              ) : <small className="muted">Connect your wallet to see your LP tokens.</small>}
            </>
          )}
        </>
      )}
      {msg && <small className="muted" style={{ overflowWrap: "anywhere" }}>{msg}</small>}
    </div>
  );
}
