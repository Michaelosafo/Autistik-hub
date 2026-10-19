"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, encodeAbiParameters, formatEther, getContractAddress, keccak256, parseEther, toHex } from "viem";
import { CHAINS, LAUNCHPAD_ABI, deployable, viemChain, type ChainKey, type LaunchChain } from "@/lib/launchpad";

const CREATE2 = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
const PAD_SALT = keccak256(toHex("AUTISTIK Launchpad v2"));
const BURNER_SALT = keccak256(toHex("AUTISTIK Burner v1"));
// The dollar amounts the team keeps: free launches with a small contribution from the liquidity, and the whitelist cap.
const USD = { launchFee: 3, maxLaunchFee: 15, minLiquidity: 25, maxWhitelist: 40 };
const CONFIG_TYPE = [{ type: "tuple", components: [
  { name: "owner", type: "address" }, { name: "router", type: "address" }, { name: "locker", type: "address" }, { name: "stablecoin", type: "address" },
  { name: "team", type: "address" }, { name: "marketing", type: "address" }, { name: "burner", type: "address" },
  { name: "launchFee", type: "uint256" }, { name: "maxLaunchFee", type: "uint256" }, { name: "platformFee", type: "uint256" },
  { name: "minLiquidity", type: "uint256" }, { name: "maxWhitelistNative", type: "uint256" }, { name: "eligibilitySigner", type: "address" },
] }] as const;

type Info = { coin: string; priceUsd: number | null; router: `0x${string}`; stablecoin: `0x${string}`; team: `0x${string}` | null; autistik: `0x${string}`; locker: `0x${string}` | null; signer: `0x${string}`; pad: string | null; burner: string | null };
const coinFor = (usd: number, price: number) => parseEther((usd / price).toFixed(9));

/** Admin only: put the Launch Pad v2 on a chain (and the AUTISTIK burner on BNB Chain), and keep its $ amounts right. */
export default function PadDeploy() {
  const chains = Object.values(CHAINS).filter(deployable);
  const [chain, setChain] = useState<ChainKey>(chains[0]?.key ?? "bsc");
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const c = CHAINS[chain];

  const load = () => { setInfo(null); fetch(`/api/launchpad/contracts?chain=${chain}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setInfo(d.error ? null : d)).catch(() => {}); };
  useEffect(load, [chain]);

  async function wallet(c: LaunchChain) {
    const eth = await pickWallet();
    if (!eth) throw new Error("No wallet chosen.");
    const vc = viemChain(c);
    const w = createWalletClient({ chain: vc, transport: custom(eth) }) as any;
    const [account] = await w.requestAddresses();
    try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: vc }); await w.switchChain({ id: c.chainId }); }
    return { w, account, vc, pub: createPublicClient({ chain: vc, transport: custom(eth) }) as any };
  }

  async function create2(c: LaunchChain, salt: `0x${string}`, initcode: `0x${string}`, label: string) {
    const { w, account, vc, pub } = await wallet(c);
    const address = getContractAddress({ opcode: "CREATE2", from: CREATE2, salt, bytecode: initcode });
    const existing = await pub.getCode({ address });
    if (!existing || existing === "0x") {
      setMsg(`Confirm in your wallet: this puts the ${label} on ${c.name}.`);
      const hash = await w.sendTransaction({ account, chain: vc, to: CREATE2, data: concat([salt, initcode]) });
      setMsg("Sent. Waiting for the network…");
      await pub.waitForTransactionReceipt({ hash, timeout: 180_000 }).catch(() => null);
    }
    return address;
  }

  async function save(kind: "pad" | "burner", address: string) {
    const r = await fetch("/api/launchpad/contracts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, kind, address }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Couldn't save.");
  }

  async function run(fn: () => Promise<string>) {
    setBusy(true); setMsg("");
    try { setMsg(await fn()); load(); } catch (e: any) { setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : e?.shortMessage || String(e?.message || e).split("\n")[0]); } finally { setBusy(false); }
  }

  const deployBurner = () => run(async () => {
    const { BURNER_BYTECODE } = await import("@/lib/launchpad-build");
    const initcode = concat([BURNER_BYTECODE, encodeAbiParameters([{ type: "address" }, { type: "address" }], [info!.router, info!.autistik])]);
    const at = await create2(c, BURNER_SALT, initcode, "AUTISTIK burner");
    await save("burner", at);
    return `✅ Burner live at ${at}. Next: deploy the launchpad.`;
  });

  const deployPad = () => run(async () => {
    const i = info!;
    if (!i.priceUsd) throw new Error(`Couldn't get the ${c.coin} price. Try again in a minute.`);
    if (!i.team) throw new Error("The team wallet isn't set (NEXT_PUBLIC_TREASURY_WALLET).");
    if (!i.locker) throw new Error(`Deploy the AUTISTIK Locker on ${c.name} first (Lockers page).`);
    const burner = chain === "bsc" ? i.burner : i.team;
    if (!burner) throw new Error("Deploy the AUTISTIK burner first.");
    const { PAD_BYTECODE } = await import("@/lib/launchpad-build");
    const cfg = {
      owner: i.team, router: i.router, locker: i.locker, stablecoin: i.stablecoin, team: i.team, marketing: i.team, burner: burner as `0x${string}`,
      launchFee: coinFor(USD.launchFee, i.priceUsd), maxLaunchFee: coinFor(USD.maxLaunchFee, i.priceUsd), platformFee: 30n,
      minLiquidity: coinFor(USD.minLiquidity, i.priceUsd), maxWhitelistNative: coinFor(USD.maxWhitelist, i.priceUsd), eligibilitySigner: i.signer,
    };
    const initcode = concat([PAD_BYTECODE, encodeAbiParameters(CONFIG_TYPE, [cfg])]);
    const at = await create2(c, keccak256(concat([PAD_SALT, toHex(c.chainId, { size: 32 })])), initcode, "AUTISTIK Launch Pad");
    await save("pad", at);
    return `✅ Launch Pad live on ${c.name} at ${at}. Launches are open on this chain.`;
  });

  const sync = () => run(async () => {
    const i = info!;
    if (!i.priceUsd || !i.pad) throw new Error("Nothing to sync yet.");
    const { w, account, vc, pub } = await wallet(c);
    const fee = coinFor(USD.launchFee, i.priceUsd), wl = coinFor(USD.maxWhitelist, i.priceUsd);
    setMsg(`Confirm in your wallet: launch contribution ${formatEther(fee)} ${c.coin} (≈$${USD.launchFee}), whitelist ${formatEther(wl)} ${c.coin} (≈$${USD.maxWhitelist}).`);
    const hash = await w.writeContract({ account, chain: vc, address: i.pad, abi: LAUNCHPAD_ABI, functionName: "syncPrices", args: [fee, wl] });
    await pub.waitForTransactionReceipt({ hash });
    return "✅ Dollar amounts updated.";
  });

  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>🛠️ Admin: Launch Pad</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Only you see this. Fees: free launch with ≈${USD.launchFee} from the liquidity, 0.3% trade fee (30% marketing, 30% $AUTISTIK burn, 40% team), all to the team wallet. Owner: the team wallet.</p>
      <select value={chain} onChange={(e) => setChain(e.target.value as ChainKey)} aria-label="Chain">
        {chains.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
      </select>
      {!info ? <small className="muted">Loading…</small> : (
        <div className="stack" style={{ gap: 6, fontSize: ".9em" }}>
          <span>{c.coin} price: <b>{info.priceUsd ? `$${info.priceUsd.toLocaleString("en-US")}` : "unknown"}</b> · Locker: {info.locker ? "✅" : "❌ deploy it on the Lockers page first"}{chain === "bsc" ? <> · Burner: {info.burner ? "✅" : "not yet"}</> : null} · Launch Pad: {info.pad ? "✅ live" : "not yet"}</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {chain === "bsc" && !info.burner && <button className="btn primary" type="button" disabled={busy} onClick={deployBurner}>1. Deploy AUTISTIK burner</button>}
            {!info.pad && <button className="btn primary" type="button" disabled={busy || (chain === "bsc" && !info.burner) || !info.locker} onClick={deployPad}>{chain === "bsc" ? "2. " : ""}Deploy Launch Pad</button>}
            {info.pad && <button className="btn small" type="button" disabled={busy} onClick={sync}>Sync $ amounts (≈${USD.launchFee} launch, ≈${USD.maxWhitelist} whitelist)</button>}
          </div>
          {info.pad && <small className="muted">Launch Pad: <a href={`${c.explorer}/address/${info.pad}`} target="_blank" rel="noreferrer">{info.pad}</a>. Press &quot;Sync $ amounts&quot; when {c.coin}&apos;s price moves a lot.</small>}
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
