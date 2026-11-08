"use client";
import { useEffect, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { pickWallet } from "@/lib/connect";
import { linkMessage } from "@/lib/wallet";

/**
 * Before joining a live: everyone needs a wallet linked to their account so the host can send them tokens. If they have
 * one (or their free AUTISTIK wallet can be linked) they go straight in. Otherwise: create the free wallet, or connect
 * their own (one signature, no fee). The address is never shown to anyone in the room.
 */
export default function WalletGate({ roomId, meId, isHost, onReady }: { roomId: string; meId: string; isHost: boolean; onReady: (short: string, address: string | null) => void }) {
  const [state, setState] = useState<"checking" | "need" | "busy">("checking");
  const [canCreate, setCanCreate] = useState(false);
  const [msg, setMsg] = useState("");

  async function check() {
    const r = await fetch(`/api/rooms/${roomId}/me`, { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.wallet) { onReady(r.short, r.address ?? null); return true; }
    if (r?.error) setMsg(r.error);
    setCanCreate(!!r?.canCreate);
    setState("need");
    return false;
  }
  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setState("busy"); setMsg("");
    const r = await fetch("/api/wallet/auto", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (!r?.address) { setMsg(r?.error || "Couldn't create your wallet. Connect your own instead."); setState("need"); return; }
    await check();
  }
  async function connect() {
    setState("busy"); setMsg("");
    try {
      const eth = await pickWallet();
      if (!eth) { setState("need"); return; }
      const w = createWalletClient({ transport: custom(eth) });
      const [a] = await w.requestAddresses();
      const address = getAddress(a);
      const issued = new Date().toISOString();
      setMsg("Sign the message in your wallet (free, no fee) to prove it's yours…");
      const signature = await w.signMessage({ account: address, message: linkMessage(meId, issued) });
      const r = await fetch("/api/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issued, signature }) }).then((x) => x.json()).catch(() => null);
      if (!r?.address) { setMsg(r?.error || "Couldn't link that wallet. Try again."); setState("need"); return; }
      await check();
    } catch (e: any) {
      setMsg(/reject|denied/i.test(String(e?.message)) ? "You cancelled in your wallet." : "Couldn't link that wallet. Try again.");
      setState("need");
    }
  }

  if (state === "checking") return <div className="lv-gate"><span className="lv-spin" aria-hidden="true" /><b>Getting your seat ready…</b></div>;
  return (
    <div className="lv-gate">
      <div className="lv-gate-ic" aria-hidden="true">🎁</div>
      <b>{isHost ? "Link a wallet to host" : "One step to join: your wallet"}</b>
      <p>Everyone in a live has a wallet, so the host can drop tokens straight to you, even by tapping your picture. <b>🔒 Your address stays private:</b> nobody in the room ever sees it.</p>
      <div className="lv-gate-btns">
        {canCreate && <button type="button" className="btn primary" disabled={state === "busy"} onClick={create}>✨ Create my free wallet</button>}
        <button type="button" className={"btn" + (canCreate ? "" : " primary")} disabled={state === "busy"} onClick={connect}>🔗 Connect my wallet</button>
      </div>
      {!canCreate && <small className="muted">Confirm your email to get a free AUTISTIK wallet made for you.</small>}
      {msg && <small className="muted" role="status">{msg}</small>}
    </div>
  );
}
