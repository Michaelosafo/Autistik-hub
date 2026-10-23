"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { linkWallet } from "@/lib/wallet-link-client";

const SKIP = /^\/(login|auth|reset-password|security|privacy|safety)(\/|$)/;

/** Every member connects a wallet: it ties their name to an address, so live sessions can send and receive tokens by name. */
export default function WalletGate({ uid }: { uid: string }) {
  const path = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [trying, setTrying] = useState(true);
  // First, link the member's free AUTISTIK wallet automatically. Only if that isn't ready do we ask them to connect one.
  useEffect(() => {
    let tried = false;
    try { tried = sessionStorage.getItem("aw-auto-wallet") === "1"; } catch { /* private mode */ }
    if (tried) { setTrying(false); return; }
    fetch("/api/wallet/auto", { method: "POST" })
      .then((r) => { try { sessionStorage.setItem("aw-auto-wallet", "1"); } catch { /* private mode */ } if (r.ok) { router.refresh(); return; } setTrying(false); })
      .catch(() => setTrying(false));
  }, [router]);
  if (trying) return null;
  if (SKIP.test(path || "")) return null;
  async function go() {
    setBusy(true); setMsg("Check your wallet app: you'll sign a free message. No funds move.");
    try { await linkWallet(uid); setMsg(""); router.refresh(); }
    catch (e: any) { setMsg(e.message === "No wallet chosen." ? "" : e.message); }
    setBusy(false);
  }
  return (
    <div className="notice warn" role="region" aria-label="Connect your wallet" style={{ margin: 0, borderRadius: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
      <span><b>Connect a wallet to receive tokens.</b> It links your name to a wallet, so others can send you tokens by name in live sessions.</span>
      <button className="btn primary small" type="button" disabled={busy} onClick={go}>Connect wallet</button>
      {msg && <span className="muted">{msg}</span>}
    </div>
  );
}
