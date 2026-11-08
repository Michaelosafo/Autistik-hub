"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Fallback } from "./WalletLoader";
import type { Member, Signer } from "./types";

const loading = () => <small className="muted">Loading your wallet…</small>;
// Wallet code runs only in the browser, and only when it's needed.
const PrivySigner = dynamic(() => import("./PrivyWallet").then((m) => m.PrivySigner), { ssr: false, loading });
const BrowserSigner = dynamic(() => import("./BrowserWallet").then((m) => m.BrowserSigner), { ssr: false, loading });

/**
 * The member's wallet (the built-in AUTISTIK wallet, or one they connected) for screens outside the wallet page,
 * like the live rooms: it hands a Signer to its children so they can ask the member to approve a transaction.
 */
export default function SignerScope({ appId, member, children }: { appId: string | null; member: Member | null; children: (s: Signer) => ReactNode }) {
  if (!appId) return <BrowserSigner>{children}</BrowserSigner>;
  return (
    <Fallback fallback={<BrowserSigner>{children}</BrowserSigner>}>
      <PrivySigner appId={appId} member={member}>{children}</PrivySigner>
    </Fallback>
  );
}
