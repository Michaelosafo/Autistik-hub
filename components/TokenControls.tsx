"use client";
import { pickWallet } from "@/lib/connect";
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, formatEther, http, isAddress } from "viem";
import { CHAINS, LAUNCH_TOKEN_ABI, viemChain, type ChainKey } from "@/lib/launchpad";

type State = { owner: string; open: boolean; openTime: number; buyTax: number; sellTax: number; platformFee: number; taxWallet: string; owed: bigint };
const ZERO = "0x0000000000000000000000000000000000000000";

/** A Launch Pad token's tax and trading status, plus the creator's controls (all one-way and buyer-safe). */
export default function TokenControls({ chain, token, unlockAt, lock }: { chain: ChainKey; token: string; unlockAt: string | null; lock: string }) {
  const c = CHAINS[chain];
  const [s, setS] = useState<State | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [wallet, setWallet] = useState("");

  const load = useCallback(async () => {
    try {
      const pub = createPublicClient({ chain: viemChain(c), transport: http(c.rpc) }) as any;
      const r = (fn: string) => pub.readContract({ address: token, abi: LAUNCH_TOKEN_ABI, functionName: fn });
      const [owner, open, openTime, buyTax, sellTax, platformFee, taxWallet, owed] = await Promise.all(["owner", "tradingOpen", "openTime", "buyTax", "sellTax", "platformFee", "taxWallet", "owedToTaxWallet"].map(r));
      setS({ owner, open, openTime: Number(openTime), buyTax: Number(buyTax) / 100, sellTax: Number(sellTax) / 100, platformFee: Number(platformFee) / 100, taxWallet, owed });
    } catch { /* older tokens without these functions: show nothing */ }
  }, [c, token]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: string, args: any[] = [], done = "✅ Done.") {
    const eth = await pickWallet();
    if (!eth) return;
    setBusy(true); setMsg("Confirm in your wallet…");
    try {
      const vc = viemChain(c);
      const w = createWalletClient({ chain: vc, transport: custom(eth) }) as any;
      const [account] = await w.requestAddresses();
      try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: vc }); await w.switchChain({ id: c.chainId }); }
      const pub = createPublicClient({ chain: vc, transport: custom(eth) });
      const hash = await w.writeContract({ account, chain: vc, address: token, abi: LAUNCH_TOKEN_ABI, functionName: fn, args });
      await pub.waitForTransactionReceipt({ hash });
      setMsg(done); await load();
    } catch (e: any) {
      const m = String(e?.message || "");
      setMsg(/NotOwner/.test(m) ? "Only the creator's wallet can do that." : /TaxTooHigh/.test(m) ? "Tax can only be lowered, never raised." : /AlreadyOpen/.test(m) ? "Trading is already open." : e?.shortMessage || "You cancelled in your wallet.");
    } finally { setBusy(false); }
  }

  async function connect() {
    const eth = await pickWallet();
    if (!eth) return;
    const [a] = await createWalletClient({ chain: viemChain(c), transport: custom(eth) }).requestAddresses().catch(() => [null as any]);
    setMe(a || null);
    if (a && s && a.toLowerCase() !== s.owner.toLowerCase()) setMsg("This wallet isn't the token's creator.");
  }

  if (!s) return null;
  const isOwner = !!me && me.toLowerCase() === s.owner.toLowerCase();
  const renounced = s.owner === ZERO;
  return (
    <div className="card stack" style={{ gap: 8, fontSize: ".92em" }}>
      <b>🛡️ Token safety</b>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="chip-flag ok">✓ No blacklist</span>
        <span className="chip-flag ok">✓ No minting</span>
        <span className={"chip-flag " + (s.buyTax + s.sellTax > 0 ? "bad" : "ok")}>Tax {s.buyTax}% buy · {s.sellTax}% sell</span>
        <span className={"chip-flag " + (s.open ? "ok" : "bad")}>{s.open ? "✓ Trading open" : `Opens by ${new Date(s.openTime * 1000).toLocaleString()}`}</span>
        <span className="chip-flag ok">{renounced ? "✓ Renounced" : "Tax can only go down"}</span>
      </div>
      <small className="muted">Plus a {s.platformFee}% platform fee on buys and sells that supports AUTISTIK.{lock !== "burn" && unlockAt ? ` Liquidity is locked in the AUTISTIK Locker until ${new Date(unlockAt).toLocaleDateString()}; after that the creator asks the AUTISTIK team (team@autistik.io) to release it to them.` : ""}</small>
      {!renounced && !me && <button className="btn small" type="button" onClick={connect}>I&apos;m the creator: manage</button>}
      {isOwner && (
        <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {!s.open && <button className="btn primary" type="button" disabled={busy} onClick={() => act("openTrading", [], "✅ Trading is open.")}>▶ Start trading</button>}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input value={buy} onChange={(e) => setBuy(e.target.value)} placeholder={`Buy % (now ${s.buyTax})`} inputMode="decimal" style={{ width: 130 }} />
            <input value={sell} onChange={(e) => setSell(e.target.value)} placeholder={`Sell % (now ${s.sellTax})`} inputMode="decimal" style={{ width: 130 }} />
            <button className="btn small" type="button" disabled={busy || buy === "" || sell === ""} onClick={() => act("lowerTaxes", [BigInt(Math.round(Number(buy) * 100)), BigInt(Math.round(Number(sell) * 100))], "✅ Tax lowered.")}>Lower tax</button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <input value={wallet} onChange={(e) => setWallet(e.target.value.trim())} placeholder={`Tax wallet (now ${s.taxWallet.slice(0, 6)}…)`} spellCheck={false} style={{ flex: 1, minWidth: 180 }} />
            <button className="btn small" type="button" disabled={busy || !isAddress(wallet)} onClick={() => act("setTaxWallet", [wallet], "✅ Tax wallet changed.")}>Change</button>
          </div>
          {s.owed > 0n && <button className="btn small" type="button" disabled={busy} onClick={() => act("claimTax", [], "✅ Sent to the tax wallet.")}>Collect {formatEther(s.owed)} {c.coin} of tax</button>}
          <button className="btn small" type="button" disabled={busy} onClick={() => { if (confirm("Give up creator control forever? You won't be able to start trading early, lower tax or change the tax wallet again.")) act("renounceOwnership", [], "✅ Renounced."); }}>Renounce ownership</button>
        </div>
      )}
      {msg && <small className="muted">{msg}</small>}
    </div>
  );
}
