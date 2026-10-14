"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createWalletClient, custom, getAddress } from "viem";
import { bsc } from "viem/chains";
import { supabaseBrowser } from "@/lib/supabase/client";
import { linkMessage } from "@/lib/wallet";

const AIRDROP = process.env.NEXT_PUBLIC_AIRDROP_CONTRACT as `0x${string}` | undefined;
const CLAIM_ABI = [
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "round", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" }], outputs: [] },
] as const;

type Claim = { round: number; amount: string; display: string; proof: `0x${string}`[] };

export default function WalletLink({ uid, initial }: { uid: string; initial: string | null }) {
  const router = useRouter();
  const [wallet, setWallet] = useState(initial);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [claim, setClaim] = useState<Claim | null>(null);

  useEffect(() => {
    if (!wallet || !AIRDROP) return;
    fetch("/airdrops/current.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const c = d?.claims?.[wallet.toLowerCase()];
      if (c) setClaim({ round: d.round, amount: c.amount, display: c.display || c.amount, proof: c.proof });
    }).catch(() => {});
  }, [wallet]);

  async function link() {
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("No wallet found. Open this page in the browser inside Trust Wallet or MetaMask, or install MetaMask."); return; }
    setBusy(true); setStatus("Check your wallet app…");
    try {
      const client = createWalletClient({ chain: bsc, transport: custom(eth) });
      const [address] = await client.requestAddresses();
      const issued = new Date().toISOString();
      const signature = await client.signMessage({ account: address, message: linkMessage(uid, issued) });
      const res = await fetch("/api/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issued, signature }) });
      const data = await res.json();
      if (!res.ok) { setStatus(data.error || "Couldn't link your wallet."); return; }
      setWallet(data.address); setStatus("Wallet linked."); router.refresh();
    } catch (e: any) {
      setStatus(e?.shortMessage || "You cancelled in your wallet. Nothing was linked.");
    } finally { setBusy(false); }
  }
  async function unlink() {
    await supabaseBrowser().from("wallets").delete().eq("user_id", uid);
    setWallet(null); setClaim(null); setStatus("Wallet unlinked."); router.refresh();
  }
  async function doClaim() {
    if (!claim || !AIRDROP) return;
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("Open this page in your wallet's browser to claim."); return; }
    setBusy(true); setStatus("Confirm the claim in your wallet…");
    try {
      const client = createWalletClient({ chain: bsc, transport: custom(eth) });
      const [account] = await client.requestAddresses();
      if (getAddress(account) !== getAddress(wallet!)) { setStatus("Switch your wallet to the linked address first."); return; }
      try { await client.switchChain({ id: bsc.id }); } catch {}
      const hash = await client.writeContract({ account, address: AIRDROP, abi: CLAIM_ABI, functionName: "claim", args: [BigInt(claim.round), BigInt(claim.amount), claim.proof] });
      setStatus(`Claim sent. Transaction: ${hash.slice(0, 10)}…`);
    } catch (e: any) {
      setStatus(e?.shortMessage || "The claim didn't go through. You may have claimed already.");
    } finally { setBusy(false); }
  }

  return (
    <div className="card stack">
      <h2>Your BNB Chain wallet</h2>
      {wallet ? (
        <>
          <div className="notice"><span className="mono" style={{ overflowWrap: "anywhere" }}>{wallet}</span></div>
          <p className="muted" style={{ fontSize: ".92em" }}>Airdrops for this account go to this wallet. Only you and the admins can see it.</p>
          {claim && (
            <div className="notice warn stack" style={{ gap: 8 }}>
              <b>You have {claim.display} $AUTISTIK to claim from round {claim.round}.</b>
              <button className="btn primary small" type="button" disabled={busy} onClick={doClaim}>Claim now</button>
            </div>
          )}
          <div className="row"><button className="btn small" type="button" onClick={unlink}>Unlink wallet</button></div>
        </>
      ) : (
        <>
          <p className="muted" style={{ fontSize: ".92em" }}>Link the wallet where you want airdrops sent. You&apos;ll sign a free message to prove it&apos;s yours. It costs nothing and moves no funds.</p>
          <div className="row"><button className="btn primary" type="button" disabled={busy} onClick={link}>Connect &amp; link wallet</button></div>
        </>
      )}
      {status && <span className="muted">{status}</span>}
      <div className="notice alert" style={{ fontSize: ".86em" }}><b>Never</b> type your seed phrase or private key anywhere. No admin, practitioner, Believer or Purity will ever ask for it.</div>
    </div>
  );
}
