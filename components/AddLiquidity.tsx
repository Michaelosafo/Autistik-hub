"use client";
import { pickWallet } from "@/lib/connect";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";
import { CHAINS, LAUNCH_TOKEN_ABI, isSolana, liveChains, viemChain, type ChainKey, type Pads } from "@/lib/launchpad";
import { SolAddLiquidity } from "@/components/SolanaLaunch";
import { reportActivity } from "@/lib/activity-client";

const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)",
]);
const FACTORY_ABI = parseAbi(["function getPair(address, address) view returns (address)"]);
const PAIR_ABI = parseAbi(["function token0() view returns (address)", "function getReserves() view returns (uint112, uint112, uint32)"]);
const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function transfer(address, uint256) returns (bool)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dEaD";

type Pool = {
  symbol: string; decimals: number; pair: `0x${string}` | null;
  /** Pool reserves, token side and coin side (0 when there's no pool yet). */
  rToken: bigint; rCoin: bigint;
  /** Launch Pad tokens only: sell tax + platform fee in percent, and whether trading is open. */
  fee: number | null; open: boolean | null;
};

const trim = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * Add liquidity to a token's pool on the chain's V2 DEX (PancakeSwap / Uniswap), straight from the member's wallet.
 * Type how many tokens to add and the matching coin amount is worked out from the pool's price (or set both when
 * there's no pool yet). The LP tokens come back to the wallet; after that they can be burned or locked.
 */
export default function AddLiquidity({ pads, chain: fixedChain, token: fixedToken, pair }: { pads: Pads; chain?: ChainKey; token?: string; pair?: string }) {
  const chains = liveChains(pads).filter((c) => c.router || isSolana(c));
  const [chain, setChain] = useState<ChainKey>(fixedChain ?? chains[0]?.key ?? "bsc");
  const c = CHAINS[chain];
  const [tokenIn, setTokenIn] = useState(fixedToken ?? "");
  const [pool, setPool] = useState<Pool | null>(null);
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [bal, setBal] = useState<{ token: bigint; coin: bigint } | null>(null);
  const [amtToken, setAmtToken] = useState("");
  const [amtCoin, setAmtCoin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [lp, setLp] = useState<{ pair: `0x${string}`; amount: bigint; hash: string } | null>(null);

  const pub = useMemo(() => createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any, [c]);
  // Paste any token address: Solana or EVM is told apart by its shape, and an 0x token's network is found by
  // looking for its contract on each network (the one already picked first).
  const [paste, setPaste] = useState("");
  const [finding, setFinding] = useState("");
  useEffect(() => {
    const v = paste.trim();
    if (fixedToken || !v) return;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v) && chains.some((x) => isSolana(x))) { setChain("solana" as ChainKey); return; }
    if (!isAddress(v)) return;
    setTokenIn(v);
    let gone = false;
    const order = [CHAINS[chain], ...chains.filter((x) => x.key !== chain)].filter((x) => x.router && !isSolana(x));
    setFinding("Finding the token's network…");
    (async () => {
      for (const x of order) {
        const code = await (createPublicClient({ chain: viemChain(x), transport: http(x.rpc) }) as any).getBytecode({ address: getAddress(v) }).catch(() => null);
        if (gone) return;
        if (code && code !== "0x") { setChain(x.key); setFinding(`Found on ${x.name}.`); return; }
      }
      if (!gone) setFinding("Couldn't find this token on our networks. Pick the network above.");
    })();
    return () => { gone = true; };
  }, [paste]);
  const token = isAddress(tokenIn.trim()) ? getAddress(tokenIn.trim()) : null;

  // Read the token and its pool as soon as a full address is there.
  useEffect(() => {
    setPool(null); setLp(null); setMsg("");
    if (!token || !c.router) return;
    let gone = false;
    (async () => {
      try {
        const [symbol, decimals, factory, weth] = await Promise.all([
          pub.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
          pub.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
          pub.readContract({ address: c.router, abi: ROUTER_ABI, functionName: "factory" }),
          pub.readContract({ address: c.router, abi: ROUTER_ABI, functionName: "WETH" }),
        ]);
        const pair = (await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [token, weth] })) as `0x${string}`;
        let rToken = 0n, rCoin = 0n;
        if (pair !== ZERO) {
          const [t0, [r0, r1]] = await Promise.all([
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }),
            pub.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" }),
          ]);
          [rToken, rCoin] = getAddress(t0) === token ? [r0, r1] : [r1, r0];
        }
        // Launch Pad tokens charge their sell tax + platform fee when tokens go into the pool, and refuse it before trading opens.
        let fee: number | null = null, open: boolean | null = null;
        try {
          const [sellTax, platformFee, isOpen] = await Promise.all(["sellTax", "platformFee", "tradingOpen"].map((fn) => pub.readContract({ address: token, abi: LAUNCH_TOKEN_ABI, functionName: fn })));
          fee = (Number(sellTax) + Number(platformFee)) / 100; open = !!isOpen;
        } catch { /* any other token */ }
        if (!gone) setPool({ symbol: String(symbol), decimals: Number(decimals), pair: pair === ZERO ? null : pair, rToken, rCoin, fee, open });
      } catch {
        if (!gone) setMsg(`Couldn't read that token on ${c.name}. Check the address and the chain.`);
      }
    })();
    return () => { gone = true; };
  }, [token, c, pub]);

  // Balances once a wallet is connected.
  useEffect(() => {
    setBal(null);
    if (!account || !token) return;
    Promise.all([pub.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [account] }), pub.getBalance({ address: account })])
      .then(([t, n]) => setBal({ token: t as bigint, coin: n as bigint })).catch(() => {});
  }, [account, token, pub, lp]);

  const priced = !!pool && pool.rToken > 0n && pool.rCoin > 0n;
  // With a pool, the coin side follows the pool's price.
  function onToken(v: string) {
    setAmtToken(v);
    if (!priced || !pool) return;
    try { setAmtCoin(trim(formatUnits((parseUnits(v || "0", pool.decimals) * pool.rCoin) / pool.rToken, 18))); } catch { setAmtCoin(""); }
  }
  function onCoin(v: string) {
    setAmtCoin(v);
    if (!priced || !pool) return;
    try { setAmtToken(trim(formatUnits((parseEther(v || "0") * pool.rToken) / pool.rCoin, pool.decimals))); } catch { setAmtToken(""); }
  }

  async function wallet() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const vc = viemChain(c);
    const w = createWalletClient({ chain: vc, transport: custom(eth) }) as any;
    const [acc] = await w.requestAddresses();
    try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: vc }); await w.switchChain({ id: c.chainId }); }
    setAccount(acc);
    return { w, acc: acc as `0x${string}`, vc };
  }

  async function add() {
    if (!pool || !token || !c.router) return;
    let tokens: bigint, coin: bigint;
    try { tokens = parseUnits(amtToken, pool.decimals); coin = parseEther(amtCoin); } catch { setMsg("Type both amounts as numbers."); return; }
    if (tokens <= 0n || coin <= 0n) { setMsg("Type both amounts."); return; }
    if (pool.open === false) { setMsg("Trading hasn't opened for this token yet. Press Start trading first (or wait for it to open by itself)."); return; }
    setBusy(true); setLp(null);
    try {
      const { w, acc, vc } = await wallet();
      const [tBal, nBal] = await Promise.all([pub.readContract({ address: token, abi: ERC20_ABI, functionName: "balanceOf", args: [acc] }), pub.getBalance({ address: acc })]);
      if ((tBal as bigint) < tokens) { setMsg(`This wallet has ${fmt(tBal as bigint, pool.decimals)} ${pool.symbol}, less than you typed.`); return; }
      if ((nBal as bigint) < coin) { setMsg(`This wallet has ${fmt(nBal as bigint, 18)} ${c.coin}, less than you typed (keep a little for gas too).`); return; }
      const allowance = (await pub.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [acc, c.router] })) as bigint;
      if (allowance < tokens) {
        setMsg(`Step 1 of 2: allow ${c.dex} to use your ${pool.symbol}. Confirm in your wallet…`);
        const h = await w.writeContract({ account: acc, chain: vc, address: token, abi: ERC20_ABI, functionName: "approve", args: [c.router, tokens] });
        await pub.waitForTransactionReceipt({ hash: h });
      }
      setMsg(`${allowance < tokens ? "Step 2 of 2: a" : "A"}dd ${amtToken} ${pool.symbol} + ${amtCoin} ${c.coin}. Confirm in your wallet…`);
      // 5% room for the price moving, plus the token's own fee for Launch Pad tokens.
      const room = 500n + BigInt(Math.round((pool.fee ?? 0) * 100));
      const min = (v: bigint) => (priced ? (v * (10_000n - room)) / 10_000n : 0n);
      const before = pool.pair ? ((await pub.readContract({ address: pool.pair, abi: ERC20_ABI, functionName: "balanceOf", args: [acc] })) as bigint) : 0n;
      const hash = await w.writeContract({
        account: acc, chain: vc, address: c.router, abi: ROUTER_ABI, functionName: "addLiquidityETH", value: coin,
        args: [token, tokens, min(tokens), min(coin), acc, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
      });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("The transaction failed.");
      const factory = await pub.readContract({ address: c.router, abi: ROUTER_ABI, functionName: "factory" });
      const weth = await pub.readContract({ address: c.router, abi: ROUTER_ABI, functionName: "WETH" });
      const pair = (await pub.readContract({ address: factory, abi: FACTORY_ABI, functionName: "getPair", args: [token, weth] })) as `0x${string}`;
      const after = (await pub.readContract({ address: pair, abi: ERC20_ABI, functionName: "balanceOf", args: [acc] })) as bigint;
      setLp({ pair, amount: after - before, hash });
      reportActivity("liquidity", c.key, hash, `Added ${amtToken} ${pool.symbol} + ${amtCoin} ${c.coin} on ${c.name}`);
      setMsg("✅ Liquidity added. The LP tokens are in your wallet.");
      setAmtToken(""); setAmtCoin("");
      setPool((p) => (p ? { ...p, pair } : p));
    } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || "");
      setMsg(/TradingNotOpen/.test(m) ? "Trading hasn't opened for this token yet." : /INSUFFICIENT_\w*_AMOUNT/.test(m) ? "The price moved. Type the amounts again and retry." : /rejected|denied|cancel/i.test(m) ? "You cancelled in your wallet." : m || "Something went wrong.");
    } finally { setBusy(false); }
  }

  async function burnLp() {
    if (!lp) return;
    if (!confirm("Burn these LP tokens? The liquidity stays in the pool forever and nobody can take it out, including you.")) return;
    setBusy(true); setMsg("Confirm the burn in your wallet…");
    try {
      const { w, acc, vc } = await wallet();
      const hash = await w.writeContract({ account: acc, chain: vc, address: lp.pair, abi: ERC20_ABI, functionName: "transfer", args: [DEAD, lp.amount] });
      await pub.waitForTransactionReceipt({ hash });
      reportActivity("lp-burn", c.key, hash, `Burned LP tokens on ${c.name}`);
      setMsg("🔥 LP tokens burned. This liquidity can never be removed.");
      setLp(null);
    } catch (e: any) {
      setMsg(e?.shortMessage || "You cancelled in your wallet.");
    } finally { setBusy(false); }
  }

  if (!fixedChain && !chains.length) return null;
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <b>💧 Add liquidity</b>
      <small className="muted">Paste your token&apos;s address: we find its network, then you add {c.coin} and tokens to its pool on {c.dex} (or create the pool if there isn&apos;t one), straight from your wallet. You get LP tokens back, which you can burn{isSolana(c) ? "" : " or lock"}.</small>
      {!fixedToken && (
        <>
          <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste your token address (any network, Solana too)" spellCheck={false} aria-label="Token address" />
          {finding && <small className="muted">{finding}</small>}
        </>
      )}
      {!fixedChain && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {chains.map((x) => <button key={x.key} type="button" className={"btn small" + (x.key === chain ? " primary" : "")} onClick={() => setChain(x.key)}>{x.name}</button>)}
        </div>
      )}
      {isSolana(c) ? <SolAddLiquidity key={fixedToken ?? (paste.trim() || "any")} mint={fixedToken ?? (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(paste.trim()) ? paste.trim() : undefined)} pool={pair} /> : <>
      {pool && (
        <>
          <div className="notice">
            🪙 <b>{pool.symbol}</b> · {priced ? <>pool price 1 {pool.symbol} = {Number(formatUnits((pool.rCoin * 10n ** BigInt(pool.decimals)) / pool.rToken, 18)).toPrecision(4)} {c.coin}</> : <>no pool yet: the amounts you add set the starting price</>}
            {bal && <><br /><small>You have {fmt(bal.token, pool.decimals)} {pool.symbol} and {fmt(bal.coin, 18)} {c.coin}</small></>}
          </div>
          {pool.open === false && <div className="notice warn">Trading hasn&apos;t opened for this token yet, so liquidity can&apos;t be added. The creator can press Start trading first.</div>}
          {!!pool.fee && <div className="notice warn">This token charges {pool.fee}% (its sell tax plus the platform fee) on tokens going into the pool, so about {pool.fee}% of the {pool.symbol} you add is taken as fee.</div>}
          <label className="field"><span>{pool.symbol}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          <label className="field"><span>{c.coin}</span><input value={amtCoin} onChange={(e) => onCoin(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {!account && <button className="btn small" type="button" disabled={busy} onClick={() => wallet().catch(() => {})}>Connect wallet</button>}
            <button className="btn primary" type="button" disabled={busy || !amtToken || !amtCoin || pool.open === false} onClick={add}>Add liquidity</button>
          </div>
        </>
      )}
      {lp && (
        <div className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <small>You received {fmt(lp.amount, 18)} LP tokens (pool <span className="mono">{lp.pair.slice(0, 8)}…</span>). <a href={`${c.explorer}/tx/${lp.hash}`} target="_blank" rel="noopener noreferrer">View transaction</a></small>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <Link className="btn small" href="/lockers">🔒 Lock them in the Locker</Link>
            <button className="btn small" type="button" disabled={busy} onClick={burnLp}>🔥 Burn them</button>
          </div>
          <small className="muted">To lock: open Lockers, choose Liquidity (LP) and paste the pool address <span className="mono" style={{ overflowWrap: "anywhere" }}>{lp.pair}</span>.</small>
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}
      </>}
    </div>
  );
}
