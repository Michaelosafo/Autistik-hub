"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, formatEther, getAddress, parseAbi, parseEther, parseEventLogs, toHex, zeroAddress } from "viem";
import { LAUNCHPAD_V4_ABI, LAUNCH_TOKEN_ABI, NATIVE_REWARD, REWARD_TOKEN_ABI } from "@/lib/launchpad";

/**
 * Admin only: a full Launch Pad v4 trial on BNB Chain TESTNET with free test BNB (faucet), before the real upgrade.
 * Deploys a test locker and a test Launch Pad owned by the admin's wallet, launches a coin with BNB holder rewards,
 * buys and sells it, and shows the rewards arriving. Nothing here touches mainnet or the site's saved contracts.
 */
const TESTNET = defineChain({
  id: 97, name: "BNB Chain Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://testnet.bscscan.com" } },
  testnet: true,
});
const EXPLORER = "https://testnet.bscscan.com";
const PANCAKE_TESTNET_ROUTER = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const ROUTER_ABI = parseAbi([
  "function WETH() view returns (address)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address, uint256) returns (bool)"]);
const CONFIG_TYPE = [{ type: "tuple", components: [
  { name: "owner", type: "address" }, { name: "router", type: "address" }, { name: "locker", type: "address" }, { name: "stablecoin", type: "address" },
  { name: "team", type: "address" }, { name: "marketing", type: "address" }, { name: "burner", type: "address" },
  { name: "launchFee", type: "uint256" }, { name: "maxLaunchFee", type: "uint256" }, { name: "platformFee", type: "uint256" },
  { name: "minLiquidity", type: "uint256" }, { name: "maxWhitelistNative", type: "uint256" }, { name: "eligibilitySigner", type: "address" },
  { name: "rewardTokens", type: "address[]" },
] }] as const;
const KEY = "pad-v4-testnet";
type Saved = { locker?: string; pad?: string; token?: string; openedAt?: number };
type Report = { distributed: string; mine: string; paid: string; holders: number; taxWallet: string; tokens: string };

export default function PadTestnetTrial() {
  const [saved, setSaved] = useState<Saved>({});
  const [router, setRouter] = useState(PANCAKE_TESTNET_ROUTER);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {} }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const keep = (s: Saved) => { setSaved(s); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  async function wallet() {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const w = createWalletClient({ chain: TESTNET, transport: custom(eth) }) as any;
    const [account] = await w.requestAddresses();
    try { await w.switchChain({ id: 97 }); } catch { await w.addChain({ chain: TESTNET }); await w.switchChain({ id: 97 }); }
    // Reads go through the wallet's own connection to the testnet.
    return { w, account: getAddress(account), pub: createPublicClient({ chain: TESTNET, transport: custom(eth) }) as any };
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || e);
      setMsg(/reject|denied/i.test(m) ? "You cancelled in your wallet." : /SnipeLimit/.test(m) ? "The first 5 minutes after opening allow only small buys. Wait for the timer, then press Buy & sell again." : /insufficient funds/i.test(m) ? "Not enough test BNB. Get free test BNB from the faucet (link above)." : m.split("\n")[0]);
    } finally { setBusy(false); }
  }
  const sent = async (pub: any, hash: `0x${string}`, what: string) => {
    setMsg(`${what}: waiting for the testnet…`);
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`${what} failed on the testnet.`);
    return r;
  };

  const deployLocker = () => run(async () => {
    const { w, account, pub } = await wallet();
    const { LOCKER_BYTECODE } = await import("@/lib/locker-build");
    setMsg("Confirm in your wallet: deploy the test locker.");
    const r = await sent(pub, await w.sendTransaction({ account, chain: TESTNET, data: LOCKER_BYTECODE }), "Test locker");
    keep({ locker: r.contractAddress });
    return `✅ Test locker at ${r.contractAddress}. Next: deploy the test Launch Pad v4.`;
  });

  const deployPad = () => run(async () => {
    const { w, account, pub } = await wallet();
    if (!/^0x[0-9a-fA-F]{40}$/.test(router)) throw new Error("The router must be a 0x… address.");
    const weth = await pub.readContract({ address: router, abi: ROUTER_ABI, functionName: "WETH" }).catch(() => null);
    if (!weth) throw new Error("That router doesn't answer on the testnet. Check the address.");
    const { PAD_BYTECODE } = await import("@/lib/launchpad-build");
    const cfg = {
      owner: account, router: router as `0x${string}`, locker: saved.locker as `0x${string}`, stablecoin: weth, team: account, marketing: account, burner: account,
      launchFee: parseEther("0.001"), maxLaunchFee: parseEther("0.01"), platformFee: 30n, minLiquidity: parseEther("0.01"), maxWhitelistNative: parseEther("0.01"),
      eligibilitySigner: zeroAddress, rewardTokens: [] as `0x${string}`[],
    };
    setMsg("Confirm in your wallet: deploy the test Launch Pad v4 (a big contract, so a higher test fee).");
    const r = await sent(pub, await w.sendTransaction({ account, chain: TESTNET, data: concat([PAD_BYTECODE, encodeAbiParameters(CONFIG_TYPE, [cfg])]) }), "Test Launch Pad");
    keep({ ...saved, pad: r.contractAddress, token: undefined, openedAt: undefined });
    return `✅ Test Launch Pad v4 at ${r.contractAddress}. Next: launch a test coin with BNB rewards.`;
  });

  const launch = () => run(async () => {
    const { w, account, pub } = await wallet();
    const p = {
      name: "Reward Test", symbol: "RTEST", supply: 1_000_000_000n * 10n ** 18n, creatorBps: 500n, devBuyNative: 0n,
      buyTax: 500n, sellTax: 500n, taxWallet: account, whitelist: [] as `0x${string}`[], whitelistNative: 0n, lockOption: 0,
      rewardToken: NATIVE_REWARD as `0x${string}`, holderBps: 5000n, permitDeadline: 0n, maxFeeAccepted: parseEther("0.01"),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1200), salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
    };
    setMsg("Confirm in your wallet: launch RTEST (5% tax, half of it to holders as BNB) with 0.05 test BNB of liquidity.");
    const call = { account, chain: TESTNET, address: saved.pad, abi: LAUNCHPAD_V4_ABI, functionName: "launch", args: [p, "0x"], value: parseEther("0.05") };
    const gas = ((await pub.estimateContractGas(call)) * 125n) / 100n;
    const r = await sent(pub, await w.writeContract({ ...call, gas }), "Launch");
    const ev = parseEventLogs({ abi: LAUNCHPAD_V4_ABI, logs: r.logs, eventName: "Launched" })[0] as any;
    const token = getAddress(ev.args.token);
    setMsg("Confirm in your wallet: open trading.");
    await sent(pub, await w.writeContract({ account, chain: TESTNET, address: token, abi: LAUNCH_TOKEN_ABI, functionName: "openTrading", args: [] }), "Open trading");
    keep({ ...saved, token, openedAt: Date.now() });
    return `✅ RTEST launched at ${token} and trading is open. In 5 minutes (anti-sniper window), press Buy & sell.`;
  });

  const trade = () => run(async () => {
    const { w, account, pub } = await wallet();
    const token = saved.token as `0x${string}`;
    const weth = await pub.readContract({ address: router, abi: ROUTER_ABI, functionName: "WETH" });
    const dl = () => BigInt(Math.floor(Date.now() / 1000) + 600);
    setMsg("Confirm in your wallet: buy RTEST for 0.01 test BNB.");
    await sent(pub, await w.writeContract({ account, chain: TESTNET, address: router, abi: ROUTER_ABI, functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens", args: [0n, [weth, token], account, dl()], value: parseEther("0.01") }), "Buy");
    const bal: bigint = await pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account] });
    const half = bal / 2n;
    setMsg("Confirm in your wallet: allow the router to sell RTEST.");
    await sent(pub, await w.writeContract({ account, chain: TESTNET, address: token, abi: ERC20, functionName: "approve", args: [router, half] }), "Approve");
    setMsg("Confirm in your wallet: sell half your RTEST. This sale also sells the collected tax and pays holder rewards.");
    await sent(pub, await w.writeContract({ account, chain: TESTNET, address: router, abi: ROUTER_ABI, functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens", args: [half, 0n, [token, weth], account, dl()] }), "Sell");
    await check(pub, account);
    return "✅ Bought and sold. The numbers below come straight from the testnet.";
  });

  async function check(pub: any, account: `0x${string}`) {
    const token = saved.token as `0x${string}`;
    const r = (fn: string, args: any[] = []) => pub.readContract({ address: token, abi: REWARD_TOKEN_ABI, functionName: fn, args });
    const [distributed, mine, earned, holders, tokens] = await Promise.all([r("totalRewardsDistributed"), r("withdrawableRewards", [account]), r("totalRewardsEarned", [account]), r("rewardHolders"), pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [token] })]);
    setReport({ distributed: formatEther(distributed), mine: formatEther(mine), paid: formatEther(earned - mine), holders: Number(holders), taxWallet: account, tokens: formatEther(tokens) });
  }
  const refresh = () => run(async () => { const { account, pub } = await wallet(); await check(pub, account); return "Updated."; });
  const claim = () => run(async () => {
    const { w, account, pub } = await wallet();
    await sent(pub, await w.writeContract({ account, chain: TESTNET, address: saved.token, abi: REWARD_TOKEN_ABI, functionName: "claimRewards", args: [] }), "Claim");
    await check(pub, account);
    return "✅ Claimed. Your claimable rewards should now be 0.";
  });

  const wait = saved.openedAt ? Math.max(0, Math.ceil((saved.openedAt + 5 * 60_000 + 15_000 - now) / 1000)) : 0;
  const link = (a?: string) => a ? <a href={`${EXPLORER}/address/${a}`} target="_blank" rel="noreferrer" className="mono">{a.slice(0, 8)}…{a.slice(-6)}</a> : null;
  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>🧪 Admin: try Launch Pad v4 on testnet first</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Runs the whole holder-rewards flow on BNB Chain Testnet with free test BNB. Nothing here touches real money, mainnet or the site&apos;s saved contracts. Get about 0.3 test BNB from the <a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noreferrer">BNB Chain faucet</a> first.</p>
      <label className="field"><span>PancakeSwap testnet router</span><input value={router} onChange={(e) => setRouter(e.target.value.trim())} spellCheck={false} /></label>
      <ol className="stack" style={{ gap: 8, margin: 0, paddingLeft: 18 }}>
        <li>Test locker {saved.locker ? <>✅ {link(saved.locker)}</> : <button className="btn small" type="button" disabled={busy} onClick={deployLocker}>Deploy</button>}</li>
        <li>Test Launch Pad v4 {saved.pad ? <>✅ {link(saved.pad)}</> : <button className="btn small" type="button" disabled={busy || !saved.locker} onClick={deployPad}>Deploy</button>}</li>
        <li>Test coin RTEST with BNB rewards {saved.token ? <>✅ {link(saved.token)}</> : <button className="btn small" type="button" disabled={busy || !saved.pad} onClick={launch}>Launch</button>}</li>
        <li>Buy &amp; sell {wait > 0 ? <small className="muted">ready in {Math.floor(wait / 60)}:{String(wait % 60).padStart(2, "0")} (anti-sniper window)</small> : <button className="btn small" type="button" disabled={busy || !saved.token} onClick={trade}>Buy &amp; sell</button>}</li>
      </ol>
      {report && (
        <table><tbody>
          <tr><th>BNB shared with holders</th><td className="num">{report.distributed} tBNB</td></tr>
          <tr><th>Sent to you automatically</th><td className="num">{report.paid} tBNB</td></tr>
          <tr><th>You can claim</th><td className="num">{report.mine} tBNB</td></tr>
          <tr><th>Holders earning</th><td className="num">{report.holders}</td></tr>
          <tr><th>Tax tokens waiting to sell</th><td className="num">{report.tokens}</td></tr>
        </tbody></table>
      )}
      {saved.token && (
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn small" type="button" disabled={busy} onClick={refresh}>Refresh numbers</button>
          <button className="btn small" type="button" disabled={busy} onClick={claim}>Claim my rewards</button>
          <button className="btn small" type="button" disabled={busy} onClick={() => { keep({ locker: saved.locker, pad: saved.pad }); setReport(null); setMsg("Start again from step 3."); }}>New test coin</button>
        </div>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
