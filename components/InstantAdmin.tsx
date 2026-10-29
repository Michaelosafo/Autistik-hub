"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, defineChain, encodeAbiParameters, formatEther, getAddress, parseAbi, parseEther, parseEventLogs, toHex, zeroAddress } from "viem";
import { CHAINS, viemChain } from "@/lib/launchpad";
import { INSTANT_ABI, INSTANT_CONSTRUCTOR, INSTANT_CREATOR_BPS, INSTANT_START_FDV_BNB, PANCAKE_V3, V3_ROUTER_ABI } from "@/lib/instant";

/**
 * Admin only: Instant launch (no liquidity, no bonding curve, PancakeSwap v3).
 * 1) A full trial on BNB Chain TESTNET with free test BNB: deploy, launch a coin, buy it, collect the pool fees.
 * 2) The real deploy on BNB Chain, owned by and paying the AUTISTIK team wallet, then saved so the Create page offers it.
 */
const TESTNET = defineChain({
  id: 97, name: "BNB Chain Testnet", nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://testnet.bscscan.com" } },
  testnet: true,
});
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const KEY = "instant-testnet";
type Saved = { pad?: string; token?: string; pool?: string };

export default function InstantAdmin() {
  const [saved, setSaved] = useState<Saved>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<any>(null);
  const [fdv, setFdv] = useState(INSTANT_START_FDV_BNB);
  const [report, setReport] = useState<string>("");
  useEffect(() => { try { setSaved(JSON.parse(localStorage.getItem(KEY) || "{}")); } catch {} }, []);
  useEffect(() => { fetch("/api/launchpad/contracts?chain=bsc").then((r) => r.json()).then(setInfo).catch(() => {}); }, []);
  const keep = (s: Saved) => { setSaved(s); try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };

  async function wallet(test: boolean) {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const chain = test ? TESTNET : viemChain(CHAINS.bsc);
    const w = createWalletClient({ chain, transport: custom(eth) }) as any;
    const [account] = await w.requestAddresses();
    try { await w.switchChain({ id: chain.id }); } catch { await w.addChain({ chain }); await w.switchChain({ id: chain.id }); }
    return { w, chain, account: getAddress(account), pub: createPublicClient({ chain, transport: custom(eth) }) as any };
  }
  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); } catch (e: any) {
      const m = String(e?.shortMessage || e?.message || e);
      setMsg(/reject|denied/i.test(m) ? "You cancelled in your wallet." : /SnipeLimit/.test(m) ? "Anti-bot window: buys over 1% are blocked for the first 5 minutes. Try a smaller buy." : /insufficient funds/i.test(m) ? "Not enough (test) BNB in this wallet." : m.split("\n")[0]);
    } finally { setBusy(false); }
  }
  const sent = async (pub: any, hash: `0x${string}`, what: string) => {
    setMsg(`${what}: waiting for the network…`);
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (r.status !== "success") throw new Error(`${what} failed.`);
    return r;
  };
  const deployData = async (owner: `0x${string}`, feeTo: `0x${string}`, signer: `0x${string}`) => {
    const { INSTANT_BYTECODE } = await import("@/lib/instant-build");
    if (!(Number(fdv) > 0)) throw new Error("Set a starting market cap in BNB.");
    return concat([INSTANT_BYTECODE, encodeAbiParameters(INSTANT_CONSTRUCTOR, [PANCAKE_V3.positions, PANCAKE_V3.router, owner, feeTo, parseEther(fdv), BigInt(INSTANT_CREATOR_BPS), signer])]);
  };

  // ---- testnet trial
  const tDeploy = () => run(async () => {
    const { w, chain, account, pub } = await wallet(true);
    setMsg("Confirm in your wallet: deploy the test Instant Launch.");
    const r = await sent(pub, await w.sendTransaction({ account, chain, data: await deployData(account, account, zeroAddress) }), "Deploy");
    keep({ pad: r.contractAddress });
    return `✅ Test Instant Launch at ${r.contractAddress}. Next: launch a test coin.`;
  });
  const tLaunch = () => run(async () => {
    const { w, chain, account, pub } = await wallet(true);
    const call = { account, chain, address: saved.pad, abi: INSTANT_ABI, functionName: "launch", args: ["Instant Test", "ITEST", toHex(crypto.getRandomValues(new Uint8Array(32))), 0n, "0x", BigInt(Math.floor(Date.now() / 1000) + 1200)], value: parseEther("0.05") };
    setMsg("Confirm in your wallet: launch ITEST with a 0.05 tBNB first buy (no liquidity).");
    const gas = ((await pub.estimateContractGas(call)) * 130n) / 100n;
    const r = await sent(pub, await w.writeContract({ ...call, gas }), "Launch");
    const ev = parseEventLogs({ abi: INSTANT_ABI, logs: r.logs, eventName: "Launched" })[0] as any;
    keep({ ...saved, token: getAddress(ev.args.token), pool: getAddress(ev.args.pool) });
    return `✅ ITEST is live in its PancakeSwap v3 pool. You got ${Number(formatEther(ev.args.creatorTokens)).toLocaleString()} ITEST from the first buy. Next: buy as someone else would.`;
  });
  const tBuy = () => run(async () => {
    const { w, chain, account, pub } = await wallet(true);
    setMsg("Confirm in your wallet: buy ITEST for 0.01 tBNB through the PancakeSwap v3 router.");
    await sent(pub, await w.writeContract({ account, chain, address: PANCAKE_V3.router, abi: V3_ROUTER_ABI, functionName: "exactInputSingle", value: parseEther("0.01"),
      args: [{ tokenIn: PANCAKE_V3.wbnb[97], tokenOut: saved.token, fee: 10000, recipient: account, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), amountIn: parseEther("0.01"), amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] }), "Buy");
    const bal: bigint = await pub.readContract({ address: saved.token, abi: ERC20, functionName: "balanceOf", args: [account] });
    return `✅ Bought through PancakeSwap. You now hold ${Number(formatEther(bal)).toLocaleString()} ITEST. Next: collect the pool fees.`;
  });
  const tCollect = () => run(async () => {
    const { w, chain, account, pub } = await wallet(true);
    const r = await sent(pub, await w.writeContract({ account, chain, address: saved.pad, abi: INSTANT_ABI, functionName: "collectFees", args: [saved.token] }), "Collect");
    const ev = parseEventLogs({ abi: INSTANT_ABI, logs: r.logs, eventName: "FeesCollected" })[0] as any;
    setReport(ev ? `Pool fees collected: ${formatEther(ev.args.bnb)} tBNB (creator ${formatEther(ev.args.toCreatorBnb)}, AUTISTIK ${formatEther(ev.args.toAutistikBnb)}) and ${Number(formatEther(ev.args.tokens)).toLocaleString()} ITEST.` : "");
    return "✅ Fees collected and split. The whole flow works on testnet.";
  });

  // ---- mainnet
  const deploy = () => run(async () => {
    if (!info?.team) throw new Error("The AUTISTIK team wallet isn't set on the site.");
    const { w, chain, account, pub } = await wallet(false);
    setMsg(`Confirm in your wallet: deploy Instant Launch on BNB Chain (owner and fees: team wallet ${String(info.team).slice(0, 8)}…).`);
    const hash = await w.sendTransaction({ account, chain, data: await deployData(info.team, info.team, info.signer || zeroAddress) });
    const r = await sent(pub, hash, "Deploy");
    const res = await fetch("/api/launchpad/contracts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: "bsc", kind: "instant", address: r.contractAddress, txHash: hash }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Deployed, but couldn't save it. Paste the address into the save box.");
    setInfo({ ...info, instant: r.contractAddress });
    return `✅ Instant Launch is live on BNB Chain at ${r.contractAddress}. The Create page now offers Instant launch.`;
  });

  const link = (a?: string, test = true) => a ? <a href={`${test ? "https://testnet.bscscan.com" : "https://bscscan.com"}/address/${a}`} target="_blank" rel="noreferrer" className="mono">{a.slice(0, 8)}…{a.slice(-6)}</a> : null;
  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>⚡ Admin: Instant launch (no liquidity, no bonding curve)</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Each coin goes one-sided into a PancakeSwap v3 pool (1% fee) starting at the market cap below. The pool position stays in the contract forever; {INSTANT_CREATOR_BPS / 100}% of pool fees go to the creator, the rest to the team wallet. Try it on testnet first (free test BNB from the <a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noreferrer">faucet</a>).</p>
      <label className="field" style={{ maxWidth: 260 }}><span>Starting market cap (BNB)</span><input value={fdv} inputMode="decimal" onChange={(e) => setFdv(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
      <b>1 · Testnet trial</b>
      <ol className="stack" style={{ gap: 8, margin: 0, paddingLeft: 18 }}>
        <li>Test Instant Launch {saved.pad ? <>✅ {link(saved.pad)}</> : <button className="btn small" type="button" disabled={busy} onClick={tDeploy}>Deploy</button>}</li>
        <li>Launch ITEST (0.05 tBNB first buy) {saved.token ? <>✅ {link(saved.token)}</> : <button className="btn small" type="button" disabled={busy || !saved.pad} onClick={tLaunch}>Launch</button>}</li>
        <li>Buy on PancakeSwap v3 <button className="btn small" type="button" disabled={busy || !saved.token} onClick={tBuy}>Buy 0.01 tBNB</button></li>
        <li>Collect pool fees <button className="btn small" type="button" disabled={busy || !saved.token} onClick={tCollect}>Collect</button></li>
      </ol>
      {saved.pad && <button type="button" className="linkish" style={{ alignSelf: "flex-start" }} onClick={() => { keep({}); setReport(""); setMsg("Testnet trial reset."); }}>Start the trial again</button>}
      {report && <p style={{ margin: 0 }}>{report}</p>}
      <b>2 · BNB Chain (real)</b>
      {info?.instant ? <p style={{ margin: 0 }}>✅ Live at {link(info.instant, false)}. The Create page offers Instant launch.</p>
        : <div><button className="btn primary small" type="button" disabled={busy || !info} onClick={deploy}>Deploy on BNB Chain</button> <small className="muted">Costs about 0.01 BNB of gas. Do the testnet trial first.</small></div>}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
