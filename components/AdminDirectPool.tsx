"use client";
import { pickWallet } from "@/lib/connect";
import { reportActivity } from "@/lib/activity-client";
import { ADMIN_DIRECT_TOKEN_ABI, ADMIN_DIRECT_TOKEN_BYTECODE } from "@/lib/admin-direct-token";
import { EvmRageChain, MAX_RAGE_TAX, RAGE_GAS, rageTaxBps } from "@/lib/admin-rage";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { useEffect, useMemo, useState } from "react";
import { createPublicClient, createWalletClient, custom, encodeDeployData, formatUnits, getAddress, http, isAddress, parseAbi, parseEther, parseUnits } from "viem";

/**
 * Any admin (after their 2-step code). One flow: deploy, add liquidity, then ask to remove it.
 * Does not touch LP that a normal launch burned or locked.
 * BNB Chain only (PancakeSwap V2). The wallet is asked to switch to BNB Chain before each step.
 */
const ROUTER_ABI = parseAbi([
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
  "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);
/** USDT on BNB Chain (BEP20, 18 decimals). Rage spends USDT; BNB only pays gas. */
const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
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
const RECORD = "autistik-rage-deploy";

type CtorArgs = {
  name: string;
  symbol: string;
  supply: string;
  buyBps: number;
  sellBps: number;
  taxWallet: string;
  router: string;
};
type VerifyState = "verifying" | "verified" | "failed" | "unsupported" | "";
type DeployRecord = CtorArgs & {
  address: string;
  chain: string;
  verifyStatus: VerifyState;
  verifyMessage: string;
  guid: string;
  url: string;
};

function recordKey(chain: string, address: string) {
  return `${RECORD}:${chain}:${address.toLowerCase()}`;
}
function loadRecord(chain: string, address: string): DeployRecord | null {
  try {
    const raw = localStorage.getItem(recordKey(chain, address));
    if (!raw) return null;
    const j = JSON.parse(raw) as DeployRecord;
    if (!j || String(j.address || "").toLowerCase() !== address.toLowerCase()) return null;
    return j;
  } catch {
    return null;
  }
}
function saveRecord(r: DeployRecord) {
  try { localStorage.setItem(recordKey(r.chain, r.address), JSON.stringify(r)); } catch { /* private mode */ }
}
const fmt = (v: bigint, d: number) => Number(formatUnits(v, d)).toLocaleString("en-US", { maximumFractionDigits: 6 });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
const slip = (v: bigint) => (v * 9500n) / 10_000n;

type Info = {
  symbol: string; decimals: number; pair: `0x${string}` | null;
  rToken: bigint; rCoin: bigint; lp: bigint; lpTotal: bigint; tokenBal: bigint; coinBal: bigint;
  /** This wallet's USDT, and USDT for 1 BNB right now (both 18 decimals). */
  usdtBal: bigint; bnbUsdt: bigint;
  /** Rage tokens: false while trading is closed (liquidity in, first buy / open trading still to do). null: not a Rage token. */
  live: boolean | null;
  buyTaxBps: number | null;
  sellTaxBps: number | null;
};

/** Rage is BNB Chain only: deploy, add liquidity on PancakeSwap V2, open trading with a first buy, then remove. */
export default function AdminDirectPool({ mode = "all" }: { mode?: "deploy" | "add" | "remove" | "all" }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="notice" style={{ fontWeight: 700 }}>Network: {CHAINS.bsc.name} · {CHAINS.bsc.coin} (BNB Chain only)</div>
      <AdminEvmPool mode={mode} chainKey="bsc" />
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
  const [verify, setVerify] = useState<DeployRecord | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
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
    if (!token) { setVerify(null); return; }
    setVerify(loadRecord(chainKey, token));
  }, [token, chainKey]);

  useEffect(() => {
    if (!token || !verify || verify.address.toLowerCase() !== token.toLowerCase()) return;
    if (verify.verifyStatus !== "verifying" || !verify.guid) return;
    let gone = false;
    let n = 0;
    const tickStatus = async () => {
      n += 1;
      if (n > 40) {
        const stalled: DeployRecord = { ...verify, verifyStatus: "failed", verifyMessage: "The explorer didn't finish in time. Tap Retry verify.", guid: "" };
        if (!gone) { saveRecord(stalled); setVerify(stalled); }
        return;
      }
      try {
        const res = await fetch("/api/admin/rage-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chain: chainKey, address: token, guid: verify.guid }),
        });
        const j = await res.json().catch(() => null);
        if (gone || !j?.status || j.status === "verifying") return;
        const next: DeployRecord = {
          ...verify,
          verifyStatus: j.status,
          verifyMessage: String(j.message || ""),
          guid: String(j.guid || ""),
          url: String(j.url || verify.url),
        };
        saveRecord(next);
        setVerify(next);
      } catch { /* the next check tries again */ }
    };
    const id = setInterval(tickStatus, 4000);
    return () => { gone = true; clearInterval(id); };
  }, [token, chainKey, verify]);

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
        let usdtBal = 0n;
        if (account) {
          [tokenBal, coinBal, usdtBal] = await Promise.all([
            pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] }),
            pub.getBalance({ address: account }),
            pub.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [account] }).catch(() => 0n),
          ]) as [bigint, bigint, bigint];
        }
        const bnbUsdt = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [10n ** 18n, [weth, USDT]] })
          .then((a: readonly bigint[]) => BigInt(a[a.length - 1])).catch(() => 0n);
        const live = await pub.readContract({ address: token, abi: parseAbi(["function tradingLive() view returns (bool)"]), functionName: "tradingLive" }).then((x: unknown) => Boolean(x)).catch(() => null);
        const buyTaxBps = await pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "buyTaxBps" }).then((x: unknown) => Number(x)).catch(() => null);
        const sellTaxBps = await pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "sellTaxBps" }).then((x: unknown) => Number(x)).catch(() => null);
        if (!gone) setInfo({ symbol: String(sym), decimals: Number(decimals), pair: pair === ZERO ? null : pair, rToken, rCoin, lp, lpTotal, tokenBal, coinBal, usdtBal, bnbUsdt, live, buyTaxBps, sellTaxBps });
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

  async function submitVerify(address: string, args: CtorArgs): Promise<DeployRecord> {
    const pending: DeployRecord = {
      ...args,
      address,
      chain: chainKey,
      verifyStatus: "verifying",
      verifyMessage: "Verifying…",
      guid: "",
      url: `${CHAIN.explorer}/address/${address}#code`,
    };
    saveRecord(pending);
    setVerify(pending);
    setVerifyBusy(true);
    try {
      const res = await fetch("/api/admin/rage-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chain: chainKey, address, args }),
      });
      const j = await res.json().catch(() => null);
      const next: DeployRecord = {
        ...pending,
        verifyStatus: j?.status || "failed",
        verifyMessage: String(j?.message || j?.error || "Verification failed."),
        guid: String(j?.guid || ""),
        url: String(j?.url || pending.url),
      };
      saveRecord(next);
      setVerify(next);
      return next;
    } catch (e) {
      const next: DeployRecord = { ...pending, verifyStatus: "failed", verifyMessage: e instanceof Error ? e.message : "Verification failed.", guid: "" };
      saveRecord(next);
      setVerify(next);
      return next;
    } finally {
      setVerifyBusy(false);
    }
  }

  async function verifyExisting() {
    if (!token || !ROUTER) { setMsg(`${CHAIN.name} has no exchange router set.`); return; }
    const saved = loadRecord(chainKey, token);
    try {
      if (saved?.name && saved.supply && saved.router) {
        await submitVerify(token, {
          name: saved.name, symbol: saved.symbol, supply: saved.supply,
          buyBps: saved.buyBps, sellBps: saved.sellBps, taxWallet: saved.taxWallet, router: saved.router,
        });
        return;
      }
      const [n, sym, supplyRaw, buy, sell, tax, router] = await Promise.all([
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "name" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "symbol" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "totalSupply" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "buyTaxBps" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "sellTaxBps" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "taxWallet" }),
        pub.readContract({ address: token, abi: ADMIN_DIRECT_TOKEN_ABI, functionName: "router" }),
      ]);
      const onChainTax = getAddress(tax as string);
      const typed = taxWallet.trim() && isAddress(taxWallet.trim()) ? getAddress(taxWallet.trim()) : null;
      // A blank tax wallet is sent as the zero address. The contract then stores the deployer, so a failed match is tried once with that address.
      const primary = typed ?? ZERO;
      const alt = primary.toLowerCase() === onChainTax.toLowerCase() ? null : onChainTax;
      const args: CtorArgs = {
        name: String(n),
        symbol: String(sym),
        supply: (supplyRaw as bigint).toString(),
        buyBps: Number(buy),
        sellBps: Number(sell),
        taxWallet: primary,
        router: getAddress(router as string),
      };
      const first = await submitVerify(token, args);
      if (alt && first.verifyStatus === "failed" && /match|constructor|unable to verify|bytecode/i.test(first.verifyMessage)) {
        await submitVerify(token, { ...args, taxWallet: alt });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't read that token.";
      setVerify({
        name: "", symbol: "", supply: "0", buyBps: 0, sellBps: 0, taxWallet: ZERO, router: ROUTER,
        address: token, chain: chainKey, verifyStatus: "failed", verifyMessage: message, guid: "",
        url: `${CHAIN.explorer}/address/${token}#code`,
      });
    }
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

  async function sendR(w: any, acc: `0x${string}`, req: any, what: string) {
    setMsg(`${what}: confirm in your wallet…`);
    const hash = await w.writeContract({ account: acc, chain: vc, ...req });
    setMsg(`${what}: waiting on ${CHAIN.name}…`);
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${what} failed.`);
    return { hash: hash as string, fee: BigInt(r.gasUsed) * BigInt(r.effectiveGasPrice || 0n) };
  }
  const wethOf = async () => (await pub.readContract({ address: ROUTER!, abi: ROUTER_ABI, functionName: "WETH" })) as `0x${string}`;
  const usdtOf = async (acc: `0x${string}`) => (await pub.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [acc] })) as bigint;
  /** BNB that must stay in the wallet for gas (BNB is never spent on the token, only on gas). */
  const gasWei = (steps: number) => parseEther((gasNative * steps).toFixed(18));

  /** Swap USDT → BNB on PancakeSwap and return the BNB that arrived (for the BNB side of the pool). */
  async function usdtToBnb(w: any, acc: `0x${string}`, usdtAmt: bigint): Promise<bigint> {
    const weth = await wethOf();
    await approveIfNeeded(w, acc, USDT, usdtAmt, `Allow ${CHAIN.dex} to use your USDT`);
    const q = (await pub.readContract({ address: ROUTER!, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [usdtAmt, [USDT, weth]] })) as bigint[];
    const minOut = slip(q[q.length - 1] ?? 0n);
    const before = (await pub.getBalance({ address: acc })) as bigint;
    const { fee } = await sendR(w, acc, { address: ROUTER, abi: ROUTER_ABI, functionName: "swapExactTokensForETH", args: [usdtAmt, minOut, [USDT, weth], acc, deadline()] }, `Swap ${fmt(usdtAmt, 18)} USDT to BNB for the pool`);
    const after = (await pub.getBalance({ address: acc })) as bigint;
    const got = after + fee - before;
    return got > 0n ? got : minOut;
  }
  /** Swap BNB → USDT (after removing liquidity), keeping gas in the wallet. Returns the USDT tx hash or null. */
  async function bnbToUsdt(w: any, acc: `0x${string}`, bnbAmt: bigint): Promise<string | null> {
    const bal = (await pub.getBalance({ address: acc })) as bigint;
    const room = bal > gasWei(1) ? bal - gasWei(1) : 0n;
    const value = bnbAmt < room ? bnbAmt : room;
    if (value <= 0n) return null;
    const weth = await wethOf();
    const q = (await pub.readContract({ address: ROUTER!, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [value, [weth, USDT]] })) as bigint[];
    const { hash } = await sendR(w, acc, { address: ROUTER, abi: ROUTER_ABI, functionName: "swapExactETHForTokens", value, args: [slip(q[q.length - 1] ?? 0n), [weth, USDT], acc, deadline()] }, `Swap ${fmt(value, 18)} BNB back to USDT`);
    return hash;
  }

  async function deploy() {
    const n = name.trim();
    const s = symbol.trim().replace(/^\$/, "").toUpperCase();
    if (!n || n.length > 32) { setMsg("Name must be 1–32 characters."); return; }
    if (!/^[A-Z0-9]{1,15}$/.test(s)) { setMsg("Ticker must be 1–15 letters or numbers."); return; }
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
      void submitVerify(at, { name: n, symbol: s, supply: units.toString(), buyBps, sellBps, taxWallet: taxTo, router: ROUTER });
      setTick((x) => x + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function add() {
    if (!info || !token || !ROUTER) return;
    let tokens: bigint, usdtLiq: bigint;
    try { tokens = parseUnits(amtToken, info.decimals); usdtLiq = parseUnits(amtCoin, 18); } catch { setMsg("Type both amounts as numbers."); return; }
    if (tokens <= 0n || usdtLiq <= 0n) { setMsg("Type both amounts."); return; }
    if (!buyAmt.trim()) { setMsg(`Set the first-buy amount (USDT) first. That buy is sent right after the liquidity, before any other trade.`); return; }
    let buyUsdt: bigint;
    try { buyUsdt = parseUnits(buyAmt, 18); } catch { setMsg("Type the first-buy amount in USDT."); return; }
    if (buyUsdt <= 0n) { setMsg("Type the first-buy amount in USDT."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      const [usdt, bnb] = await Promise.all([usdtOf(acc), pub.getBalance({ address: acc }) as Promise<bigint>]);
      if (usdt < usdtLiq + buyUsdt) {
        setMsg(`Not enough USDT: you have ${fmt(usdt, 18)} USDT, and this needs ${fmt(usdtLiq + buyUsdt, 18)} (${amtCoin} for the liquidity + ${buyAmt} for the first buy). Add USDT (BEP20), or lower the amounts.`);
        return;
      }
      if (bnb < gasWei(6)) {
        setMsg(`Keep about ${(gasNative * 6).toFixed(4)} BNB in this wallet for gas (you have ${fmt(bnb, 18)}). BNB is only used for gas; the liquidity and first buy are paid in USDT.`);
        return;
      }
      const priced = info.rToken > 0n && info.rCoin > 0n;
      await approveIfNeeded(w, acc, token, tokens, `Allow ${CHAIN.dex} to use your ${info.symbol}`);
      const bnbForPool = await usdtToBnb(w, acc, usdtLiq);
      const hash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "addLiquidityETH", value: bnbForPool,
        args: [token, tokens, priced ? (tokens * 85n) / 100n : 0n, priced ? slip(bnbForPool) : 0n, acc, deadline()],
      }, "Add liquidity");
      reportActivity("liquidity", CHAIN.key, hash, `Admin added ${amtToken} ${info.symbol} + ${amtCoin} USDT (as ${fmt(bnbForPool, 18)} BNB)`);
      setAmtToken(""); setAmtCoin(""); setTick((x) => x + 1);
      setMsg("Liquidity is in. Approve the first buy (USDT) in your wallet. It goes out before any other trade.");
      const ok = await firstBuyWith(w, acc, buyUsdt);
      if (!ok) return;
      if (mode === "all" && confirm("Done. Remove the liquidity now?")) setAskRemove(true);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  /** The first buy, then open trading. Returns false if a step didn't go through (the Continue panel stays up). */
  async function firstBuyWith(w: any, acc: `0x${string}`, buyUsdt: bigint): Promise<boolean> {
    if (!token || !info || !ROUTER) return false;
    try {
      const [usdt, bnb] = await Promise.all([usdtOf(acc), pub.getBalance({ address: acc }) as Promise<bigint>]);
      if (usdt < buyUsdt) {
        setMsg(`The first buy needs ${fmt(buyUsdt, 18)} USDT, but this wallet has ${fmt(usdt, 18)} USDT. Add USDT and tap "Sign first buy" again${usdt > 0n ? `, or tap "Buy with what's left" (${fmt(usdt, 18)} USDT)` : ""}. The liquidity is safe in the pool.`);
        return false;
      }
      if (bnb < gasWei(2)) { setMsg(`Add a little BNB for gas (about ${(gasNative * 2).toFixed(4)} BNB), then tap "Sign first buy" again. The liquidity is safe in the pool.`); return false; }
      const weth = await wethOf();
      const path = [USDT, weth, token] as `0x${string}`[];
      await approveIfNeeded(w, acc, USDT, buyUsdt, `Allow ${CHAIN.dex} to use your USDT`);
      const amounts = (await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "getAmountsOut", args: [buyUsdt, path] })) as bigint[];
      const outMin = slip(amounts[amounts.length - 1] ?? 0n);
      const buyHash = await send(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "swapExactTokensForTokensSupportingFeeOnTransferTokens",
        args: [buyUsdt, outMin, path, acc, deadline()],
      }, "First buy (USDT)");
      reportActivity("swap", CHAIN.key, buyHash, `First buy ${fmt(buyUsdt, 18)} USDT of ${info.symbol}`);
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
        const bal = await usdtOf(acc);
        if (bal <= 0n) { setMsg("This wallet has no USDT for the first buy. Add USDT (BEP20) first."); return; }
        amt = bal;
      } else {
        try { amt = parseUnits(buyAmt || "0", 18); } catch { setMsg("Type the first-buy amount in USDT."); return; }
        if (amt <= 0n) { setMsg("Type the first-buy amount in USDT."); return; }
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
    if (!confirm(`Remove ${pct}% of the LP in this wallet? The tokens come back here, and the BNB side is swapped back to USDT. Liquidity that was burned or locked on a normal launch is not touched.`)) return;
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
      const before = (await pub.getBalance({ address: acc })) as bigint;
      const { hash, fee } = await sendR(w, acc, {
        address: ROUTER, abi: ROUTER_ABI, functionName: "removeLiquidityETHSupportingFeeOnTransferTokens",
        args: [token, amount, loose(shareToken), loose(shareCoin), acc, deadline()],
      }, `Remove ${pct}% of your liquidity`);
      reportActivity("liquidity", CHAIN.key, hash, `Admin removed ${pct}% of ${info.symbol} liquidity`);
      setTick((x) => x + 1);
      const after = (await pub.getBalance({ address: acc })) as bigint;
      const gotBnb = after + fee - before;
      let swapHash: string | null = null;
      try { if (gotBnb > 0n) swapHash = await bnbToUsdt(w, acc, gotBnb); }
      catch (e) { fail(e); setMsg((m) => `✅ Liquidity removed (${CHAIN.explorer}/tx/${hash}), but the swap back to USDT didn't go through: ${m} The BNB is in your wallet.`); return; }
      setMsg(`✅ Removed ${pct}% of the liquidity${swapHash ? ` and swapped the BNB back to USDT (${CHAIN.explorer}/tx/${swapHash})` : ""}. ${CHAIN.explorer}/tx/${hash}`);
      setTick((x) => x + 1);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  const priced = !!info && info.rToken > 0n && info.rCoin > 0n;
  function onToken(v: string) {
    setAmtToken(v);
    if (!priced || !info) return;
    if (!(info.bnbUsdt > 0n)) return;
    try { setAmtCoin(formatUnits((parseUnits(v || "0", info.decimals) * info.rCoin * info.bnbUsdt) / info.rToken / 10n ** 18n, 18).replace(/\.?0+$/, "")); } catch { setAmtCoin(""); }
  }
  const share = info && info.lpTotal > 0n ? { token: (info.rToken * info.lp) / info.lpTotal, coin: (info.rCoin * info.lp) / info.lpTotal } : null;

  const shownVerify = token && verify?.address.toLowerCase() === token.toLowerCase() ? verify : null;
  const verifyPolling = shownVerify?.verifyStatus === "verifying" && !!shownVerify.guid;
  const showDeploy = mode === "all" || mode === "deploy";
  const showAdd = mode === "all" || mode === "add";
  const showRemove = mode === "all" || mode === "remove";
  const title = mode === "add" ? "Add LP" : mode === "remove" ? "Remove LP" : "Rage";
  const blurb = mode === "all"
    ? `Deploy the token on ${CHAIN.name}, add liquidity and the first buy paid in USDT, then it asks if you want to remove that liquidity. BNB is only used for gas. The LP stays in this wallet.`
    : mode === "deploy"
    ? `Deploy the token on ${CHAIN.name}. The whole supply comes to this wallet.`
    : mode === "add"
    ? `Add tokens and USDT on ${CHAIN.dex} (the USDT is swapped to BNB for the token/BNB pool). BNB is only used for gas. The LP stays in this wallet.`
    : `Remove LP sitting in this wallet. The tokens come back here and the BNB side is swapped back to USDT. Liquidity that was burned or locked on a normal launch cannot be pulled.`;
  const usdtLeft = account && info ? info.usdtBal : 0n;
  const asUsdt = (bnbWei: bigint) => (info && info.bnbUsdt > 0n ? (bnbWei * info.bnbUsdt) / 10n ** 18n : 0n);
  return (
    <>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>{blurb}</p>
      {!account && <button className="btn small" type="button" disabled={busy} onClick={() => wallet().catch(fail)}>Connect wallet</button>}
      {account && <small className="muted">Wallet <span className="mono">{account.slice(0, 6)}…{account.slice(-4)}</span> on {CHAIN.name}</small>}

      {showDeploy && (
        <>
          <div className="notice" style={{ display: "grid", gap: 8 }}>
            <b>CA management</b>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className="btn small" type="button" disabled={!token || busy} onClick={() => {
                if (!token) return;
                const listKey = `autistik-admin-direct-tokens:${chainKey}`;
                try {
                  const raw = localStorage.getItem(listKey) || "[]";
                  const list = JSON.parse(raw);
                  const entry = { address: token, name: name || (info?.symbol) || "Token", symbol: symbol || (info?.symbol) || "TOK" };
                  const next = [entry, ...list.filter((x: any) => x.address !== token)].slice(0, 50);
                  localStorage.setItem(listKey, JSON.stringify(next));
                  setMsg(`CA saved: ${token}`);
                } catch { setMsg("Couldn't save CA."); }
              }}>Save current CA</button>
              <button className="btn small" type="button" onClick={() => {
                setName(""); setSymbol(""); setSupply("1000000000"); setBuyTax("0"); setSellTax("0");
                setTokenIn(""); setInfo(null); setAmtToken(""); setAmtCoin(""); setBuyAmt(""); setAskRemove(false);
                setMsg("Ready for another deployment. Previous token cleared.");
                try { localStorage.removeItem(`${SAVED}:${chainKey}`); if (chainKey === "bsc") localStorage.removeItem(SAVED); } catch {}
              }}>Start another deployment</button>
              {busy && <button className="btn small ghost" type="button" onClick={() => { setBusy(false); setMsg("Stopped waiting. Reject any pending wallet prompt if shown."); }}>Stop waiting</button>}
            </div>
          </div>
          <b className="rg-step s1"><i>1</i>Deploy the token</b>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Token" maxLength={32} /></label>
          <label className="field"><span>Ticker</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="TOK" maxLength={15} /></label>
          <label className="field"><span>Supply (whole tokens)</span><input value={supply} onChange={(e) => setSupply(e.target.value)} inputMode="decimal" placeholder="1000000000" /></label>
          <label className="field"><span>Buy tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={buyTax} onChange={(e) => setBuyTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Buy tax percent" /></label>
          <label className="field"><span>Sell tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={sellTax} onChange={(e) => setSellTax(e.target.value)} inputMode="decimal" placeholder="0" aria-label="Sell tax percent" /></label>
          {(buyBps != null && sellBps != null && (buyBps > 0 || sellBps > 0)) && (
            <label className="field"><span>Tax wallet <small className="muted">optional, blank uses the wallet you deploy with</small></span><input value={taxWallet} onChange={(e) => setTaxWallet(e.target.value)} placeholder="0x…" spellCheck={false} aria-label="Tax wallet" /></label>
          )}
          <button className="btn primary" type="button" disabled={busy || !name.trim() || !symbol.trim()} onClick={deploy}>Deploy token</button>
        </>
      )}

      <b className="rg-step s2"><i>2</i>Token</b>
      <input value={tokenIn} onChange={(e) => { setTokenIn(e.target.value); try { if (isAddress(e.target.value.trim())) remember(getAddress(e.target.value.trim())); } catch { /* ignore */ } }} placeholder="Paste any token address (CA)" spellCheck={false} aria-label="Token address" />
      {token && (
        <div className="stack" style={{ gap: 4 }}>
          {(shownVerify?.verifyStatus === "verifying" || verifyBusy) && <small>Verifying source on the explorer…</small>}
          {shownVerify?.verifyStatus === "verified" && (
            <small>Verified · <a href={shownVerify.url || `${CHAIN.explorer}/address/${token}#code`} target="_blank" rel="noreferrer">View source</a></small>
          )}
          {shownVerify?.verifyStatus === "failed" && <small>Verification failed: {shownVerify.verifyMessage}</small>}
          {shownVerify?.verifyStatus === "unsupported" && <small>{shownVerify.verifyMessage}</small>}
          {shownVerify?.verifyStatus !== "verified" && shownVerify?.verifyStatus !== "unsupported" && (
            <button className="btn small" type="button" disabled={busy || verifyBusy || verifyPolling} onClick={() => { void verifyExisting(); }}>
              {shownVerify?.verifyStatus === "failed" || shownVerify?.verifyStatus === "verifying" ? "Retry verify" : "Verify"}
            </button>
          )}
        </div>
      )}
      {info && (
        <>
          <div className="notice">
            🪙 <b>{info.symbol}</b>
            {info.buyTaxBps != null && info.sellTaxBps != null && <> · tax {info.buyTaxBps / 100}% buy · {info.sellTaxBps / 100}% sell</>}
            {" "}· {priced ? <>pool: {fmt(info.rToken, info.decimals)} {info.symbol} + {fmt(info.rCoin, 18)} BNB{info.bnbUsdt > 0n ? <> (≈ {fmt(asUsdt(info.rCoin), 18)} USDT)</> : null}</> : <>no pool yet: the amounts you add set the starting price</>}
            {account && <><br /><small>You have {fmt(info.tokenBal, info.decimals)} {info.symbol}, <b>{fmt(info.usdtBal, 18)} USDT</b> and {fmt(info.coinBal, 18)} BNB (gas)</small></>}
            {info.pair && <><br /><small>Pool <a href={`${CHAIN.explorer}/address/${info.pair}`} target="_blank" rel="noreferrer">{info.pair.slice(0, 8)}…{info.pair.slice(-4)}</a></small></>}
          </div>
          {showAdd && info.live === false && info.rToken > 0n && (
            <div className="notice stack" style={{ gap: 6, borderColor: "#f0b90b" }}>
              <b>▶ Continue: liquidity is in, trading is still closed</b>
              <small>Finish with the first buy (it goes out before anyone else can trade), then trading opens. If a step fails, just sign it again here: nothing is lost.</small>
              <label className="field"><span>First buy (USDT)</span><input value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.trim())} inputMode="decimal" placeholder="10" aria-label="First buy amount in USDT" /></label>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <button className="btn primary" type="button" disabled={busy || !buyAmt} onClick={() => continueBuy(false)}>Sign first buy</button>
                <button className="btn" type="button" disabled={busy} onClick={() => continueBuy(true)}>Buy with all my USDT{usdtLeft > 0n ? ` (${fmt(usdtLeft, 18)} USDT)` : ""}</button>
                <button className="btn ghost" type="button" disabled={busy} onClick={continueOpen}>Skip the buy, just open trading</button>
              </div>
            </div>
          )}
          {showAdd && (
            <>
              <b className="rg-step sb"><i>⚡</i>First buy</b>
              <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Set this before you add liquidity. It&apos;s paid in USDT. Trading stays closed until this wallet&apos;s buy is in, then it opens. You approve each step in the wallet.</p>
              <label className="field"><span>Amount (USDT)</span><input value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.trim())} inputMode="decimal" placeholder="10" aria-label="First buy amount in USDT" /></label>
              <b className="rg-step s3"><i>3</i>Add liquidity</b>
              <label className="field"><span>{info.symbol}</span><input value={amtToken} onChange={(e) => onToken(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <label className="field"><span>USDT <small className="muted">swapped to BNB for the {info.symbol}/BNB pool</small></span><input value={amtCoin} onChange={(e) => setAmtCoin(e.target.value.trim())} inputMode="decimal" placeholder="0" /></label>
              <button className="btn primary" type="button" disabled={busy || !amtToken || !amtCoin || !buyAmt} onClick={add}>Add liquidity</button>
            </>
          )}
          {showRemove && (askRemove || mode !== "all" || info.lp > 0n) && (
            info.pair ? (
              account ? (
                info.lp > 0n ? (
                  <>
                    <b className="rg-step s4"><i>4</i>Remove liquidity?</b>
                    <small>LP in this wallet: {fmt(info.lp, 18)}{share ? <> (about {fmt(share.token, info.decimals)} {info.symbol} + {fmt(share.coin, 18)} BNB{info.bnbUsdt > 0n ? <>, ≈ {fmt(asUsdt(share.coin), 18)} USDT back</> : null})</> : null}</small>
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

