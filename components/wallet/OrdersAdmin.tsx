"use client";
import { pickWallet } from "@/lib/connect";
import { useEffect, useState } from "react";
import { concat, createPublicClient, createWalletClient, custom, encodeAbiParameters, getAddress, getContractAddress, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { KYBER_ROUTER, WCHAIN_LIST, type WChain } from "@/lib/wallet-chains";

const CREATE2 = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
const SALT = keccak256(toHex("AUTISTIK Orders v1"));
type Info = { keeper: string | null; treasury: string; contracts: Record<string, string> };

/**
 * Admin only: turn on limit and stop-loss orders. 1) Make a keeper key and put it in Vercel. 2) Send the keeper a
 * little gas money. 3) Deploy the Orders contract on each network from the team wallet (it becomes the owner).
 */
export default function OrdersAdmin() {
  const [info, setInfo] = useState<Info | null>(null);
  const [fresh, setFresh] = useState<{ key: string; address: string } | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/orders/admin", { cache: "no-store" }).then((r) => r.json()).then((d) => !d.error && setInfo(d)).catch(() => {});
  useEffect(() => { load(); }, []);

  async function deploy(c: WChain) {
    setBusy(true); setMsg("");
    try {
      if (!info?.keeper) throw new Error("Add the keeper key in Vercel first (step 1), then redeploy the site.");
      const eth = await pickWallet();
      if (!eth) throw new Error("No wallet chosen.");
      const w = createWalletClient({ chain: c.viem, transport: custom(eth) }) as any;
      const pub = createPublicClient({ chain: c.viem, transport: custom(eth) }) as any;
      const [account] = await w.requestAddresses();
      try { await w.switchChain({ id: c.chainId }); } catch { await w.addChain({ chain: c.viem }); await w.switchChain({ id: c.chainId }); }
      const { ORDERS_BYTECODE } = await import("@/lib/orders-build");
      const routers = [KYBER_ROUTER, ...(c.v2Router ? [c.v2Router] : [])].map((a) => getAddress(a));
      const args = encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }, { type: "address[]" }, { type: "address[]" }],
        [getAddress(info.treasury), getAddress(info.treasury), 50n, getAddress(c.wrapped!), [getAddress(info.keeper)], routers],
      );
      const initcode = concat([ORDERS_BYTECODE, args]);
      const address = getContractAddress({ opcode: "CREATE2", from: CREATE2, salt: SALT, bytecode: initcode });
      const code = await pub.getCode({ address });
      if (!code || code === "0x") {
        setMsg(`Confirm in your wallet: this puts the AUTISTIK Orders contract on ${c.name}.`);
        const hash = await w.sendTransaction({ account, chain: c.viem, to: CREATE2, data: concat([SALT, initcode]) });
        setMsg("Sent. Waiting for the network…");
        await pub.waitForTransactionReceipt({ hash, timeout: 180_000 }).catch(() => null);
      }
      const r = await fetch("/api/orders/contracts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain: c.key, address }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't save.");
      setMsg(`Orders are live on ${c.name}: ${address}`); load();
    } catch (e: any) { setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : e?.shortMessage || String(e?.message || e).split("\n")[0]); }
    setBusy(false);
  }

  if (!info) return null;
  return (
    <div className="card stack" style={{ gap: 10, borderStyle: "dashed" }}>
      <h3 style={{ margin: 0 }}>Admin: limit and stop-loss orders</h3>
      <p className="muted" style={{ margin: 0, fontSize: ".9em" }}>Only you see this. The keeper is a small wallet that only pays gas to fill orders when their price is reached. It can never move anyone&apos;s tokens: the contract only pays the order&apos;s own wallet, at or above their minimum. Fee: 0.5% of each filled order to {info.treasury.slice(0, 8)}…</p>
      <div className="stack" style={{ gap: 6, fontSize: ".92em" }}>
        <b>1. Keeper key {info.keeper ? <span className="up">(set: {info.keeper})</span> : <span className="down">(not set)</span>}</b>
        {!info.keeper && (
          <>
            <button type="button" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => { const key = generatePrivateKey(); setFresh({ key, address: privateKeyToAccount(key).address }); }}>Make a new keeper key</button>
            {fresh && <div className="notice warn" style={{ wordBreak: "break-all" }}>
              Copy this key into Vercel → Settings → Environment Variables as <b>ORDERS_KEEPER_KEY</b> (mark it Sensitive), then redeploy. It&apos;s shown only here, once, in your own browser; never paste it in a chat.<br /><code>{fresh.key}</code><br />Keeper address: <code>{fresh.address}</code>
            </div>}
          </>
        )}
        <b>2. Gas money</b>
        <span className="muted">Send about $5 of BNB (and a little ETH on Base/Arbitrum if you open those) to the keeper address. Each fill costs a few cents.</span>
        <b>3. Deploy on each network (from the team wallet {info.treasury.slice(0, 8)}…)</b>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {WCHAIN_LIST.filter((c) => c.kind === "evm").map((c) => info.contracts[c.key]
            ? <span key={c.key} className="badge">{c.name}: live</span>
            : <button key={c.key} type="button" className="btn small primary" disabled={busy || !info.keeper} onClick={() => deploy(c)}>Deploy on {c.name}</button>)}
        </div>
      </div>
      {msg && <small className="muted" style={{ wordBreak: "break-all" }}>{msg}</small>}
    </div>
  );
}
