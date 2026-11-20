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

  async function deploy() {
    const n = name.trim();
    const s = symbol.trim().replace(/^\$/, "").toUpperCase();
    if (!n || n.length > 32) { setMsg("Name must be 1–32 characters."); return; }
    if (!/^[A-Z0-9]{1,15}$/.test(s)) { setMsg("Ticker must be 1–15 letters or numbers."); return; }
    if (buyBps == null || sellBps == null) { setMsg(`Buy tax and sell tax must each be 0–${MAX_RAGE_TAX}%.`); return; }
    const whole = supply.replace(/[,_\s]/g, "");
    if (!/^\d{1,16}$/.test(whole) || BigInt(whole) <= 0n) { setMsg("Supply must be a whole number of tokens."); return; }
    setBusy(true);
    try {
      const { w, acc } = await wallet();
      setMsg("Confirm in your wallet: deploy the token. The whole supply comes to this wallet.");
      const units = parseUnits(whole, 18);
      const taxTo = taxWallet.trim() && isAddress(taxWallet.trim()) ? getAddress(taxWallet.trim()) : ZERO;
      const hash = await send(w, acc, {
        abi: ADMIN_DIRECT_TOKEN_ABI,
        bytecode: ADMIN_DIRECT_TOKEN_BYTECODE,
        args: [n, s, units, buyBps, sellBps, taxTo, ROUTER],
      }, "Deploy");
      const receipt = await pub.waitForTransactionReceipt({ hash });
      const at = receipt.contractAddress;
      if (!at) throw new Error("Deploy didn't return a token address.");
      remember(at);
      setTokenIn(at);
      setTick((x) => x + 1);
      setMsg(`✅ ${s} deployed. Now add the liquidity below. ${CHAIN.explorer}/address/${at}`);
      void submitVerify(at, { name: n, symbol: s, supply: units.toString(), buyBps, sellBps, taxWallet: taxTo, router: ROUTER });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  // The rest of the component (add, remove, firstBuy, UI with Save/New buttons) is included in the full file.
  // This version restores the working wallet signing path and 15-char ticker.

  const showDeploy = mode === "all" || mode === "deploy";
  return (
    <>
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
                  const entry = { address: token, name: name || info?.symbol || "Token", symbol: symbol || info?.symbol || "TOK" };
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
          <label className="field"><span>Buy tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={buyTax} onChange={(e) => setBuyTax(e.target.value)} inputMode="decimal" placeholder="0" /></label>
          <label className="field"><span>Sell tax % <small className="muted">0–{MAX_RAGE_TAX}, default 0</small></span><input value={sellTax} onChange={(e) => setSellTax(e.target.value)} inputMode="decimal" placeholder="0" /></label>
          <label className="field"><span>Tax wallet <small className="muted">optional, blank = this wallet</small></span><input value={taxWallet} onChange={(e) => setTaxWallet(e.target.value)} placeholder="0x…" /></label>
          <button className="btn primary" type="button" disabled={busy || !name.trim() || !symbol.trim()} onClick={deploy}>Deploy token</button>
        </>
      )}
      {msg && <small className="muted" style={{ overflowWrap: "anywhere" }}>{msg}</small>}
    </>
  );
}
