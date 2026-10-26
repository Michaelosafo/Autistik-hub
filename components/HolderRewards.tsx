"use client";
import { pickWallet } from "@/lib/connect";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatUnits, http, parseAbi } from "viem";
import { CHAINS, NATIVE_REWARD, REWARD_TOKEN_ABI, viemChain, type ChainKey } from "@/lib/launchpad";

const META = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
type Info = { reward: string; symbol: string; decimals: number; holderBps: number; total: bigint; holders: number };

/** Holder rewards on a Launch Pad v4 coin: what holders have been paid, and the connected wallet's own rewards + Claim. */
export default function HolderRewards({ chain, token }: { chain: ChainKey; token: `0x${string}` }) {
  const c = CHAINS[chain];
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<`0x${string}` | null>(null);
  const [mine, setMine] = useState<{ claimable: bigint; earned: bigint } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
  const read = (functionName: string, args: any[] = []) => pub.readContract({ address: token, abi: REWARD_TOKEN_ABI, functionName, args });

  const load = useCallback(async () => {
    try {
      const reward = String(await read("rewardToken"));
      if (/^0x0{40}$/i.test(reward)) return; // launched without holder rewards
      const native = reward.toLowerCase() === NATIVE_REWARD.toLowerCase();
      const [holderBps, total, holders, symbol, decimals] = await Promise.all([
        read("holderBps"), read("totalRewardsDistributed"), read("rewardHolders"),
        native ? c.coin : pub.readContract({ address: reward, abi: META, functionName: "symbol" }).catch(() => "tokens"),
        native ? 18 : pub.readContract({ address: reward, abi: META, functionName: "decimals" }).catch(() => 18),
      ]);
      setInfo({ reward, symbol: String(symbol), decimals: Number(decimals), holderBps: Number(holderBps), total, holders: Number(holders) });
    } catch { /* coins from older Launch Pads have no holder rewards */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, token]);
  useEffect(() => { load(); }, [load]);

  const loadMine = useCallback(async (a: `0x${string}`) => {
    const [claimable, earned] = await Promise.all([read("withdrawableRewards", [a]), read("totalRewardsEarned", [a])]);
    setMine({ claimable, earned });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, token]);

  async function connect() {
    const eth = await pickWallet();
    if (!eth) return;
    const [a] = await createWalletClient({ chain: viemChain(c), transport: custom(eth) }).requestAddresses().catch(() => [null as any]);
    if (!a) return;
    setMe(a); setMsg("");
    await loadMine(a).catch(() => setMsg("Couldn't read your rewards. Try again."));
  }

  async function claim() {
    const eth = await pickWallet();
    if (!eth || !me) return;
    setBusy(true); setMsg("Confirm in your wallet…");
    try {
      const vc = viemChain(c);
      const w = createWalletClient({ chain: vc, transport: custom(eth) }) as any;
      const [account] = await w.requestAddresses();
      try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: vc }); await w.switchChain({ id: c.chainId }); }
      const hash = await w.writeContract({ account, chain: vc, address: token, abi: REWARD_TOKEN_ABI, functionName: "claimRewards", args: [] });
      setMsg("Claiming…");
      await createPublicClient({ chain: vc, transport: custom(eth) }).waitForTransactionReceipt({ hash });
      setMsg("✅ Rewards sent to your wallet.");
      await Promise.all([loadMine(account), load()]);
    } catch (e: any) {
      setMsg(e?.shortMessage && !/reject|denied/i.test(e.shortMessage) ? e.shortMessage : "You cancelled in your wallet.");
    } finally { setBusy(false); }
  }

  if (!info) return null;
  const f = (v: bigint) => {
    const n = Number(formatUnits(v, info.decimals));
    return n === 0 ? "0" : n < 0.000001 ? "<0.000001" : n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 8 : 4 });
  };
  return (
    <section className="card stack hr-card" style={{ gap: 10 }} aria-label="Holder rewards">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>Holder rewards in {info.symbol}</h3>
        <small className="muted">{info.holderBps / 100}% of the tax goes to holders</small>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Hold this coin and earn {info.symbol}. Part of every taxed trade buys {info.symbol} and shares it with all holders by how much they hold. It&apos;s sent automatically a few holders at a time, and you can claim yours any time.</p>
      <div className="hr-stats">
        <div><small>Paid to holders so far</small><b className="num">{f(info.total)} {info.symbol}</b></div>
        <div><small>Holders earning</small><b className="num">{info.holders.toLocaleString("en-US")}</b></div>
      </div>
      {!me ? (
        <button className="btn primary" type="button" onClick={connect}>Connect wallet to see your rewards</button>
      ) : mine && (
        <div className="hr-mine">
          <span className="stack" style={{ gap: 2 }}>
            <small className="muted">Your rewards: {f(mine.earned)} {info.symbol} earned</small>
            <b className="num">{f(mine.claimable)} {info.symbol} ready to claim</b>
          </span>
          <button className="btn primary" type="button" disabled={busy || mine.claimable === 0n} onClick={claim}>{mine.claimable === 0n ? "Nothing to claim yet" : "Claim"}</button>
        </div>
      )}
      {msg && <small className="muted" role="status">{msg}</small>}
    </section>
  );
}
