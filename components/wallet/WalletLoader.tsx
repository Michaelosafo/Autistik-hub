"use client";
import { Component, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Start } from "./types";

const loading = () => <div className="card muted">Loading your wallet…</div>;
// Wallet code runs only in the browser, and only on this page.
const PrivyWallet = dynamic(() => import("./PrivyWallet"), { ssr: false, loading });
const BrowserWallet = dynamic(() => import("./BrowserWallet"), { ssr: false, loading });

/** If the built-in wallet can't start (e.g. a wrong app ID in the settings), fall back to outside wallets instead of a blank page. */
class Fallback extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("Built-in wallet failed to start:", e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function WalletLoader({ appId, start, app }: { appId: string | null; start: Start; app?: "wallet" | "stake" }) {
  if (!appId) return <BrowserWallet start={start} app={app} />;
  return (
    <Fallback fallback={<><div className="notice warn">The built-in wallet is unavailable right now. You can still connect a wallet like MetaMask or Trust Wallet.</div><BrowserWallet start={start} app={app} /></>}>
      <PrivyWallet appId={appId} start={start} app={app} />
    </Fallback>
  );
}
