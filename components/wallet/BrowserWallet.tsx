"use client";
import WalletApp from "./WalletApp";
import { useEffect, useSyncExternalStore } from "react";
import { disconnectSol, disconnectWallet, getState, pickWallet, restoreSol, signSol, subscribe } from "@/lib/connect";
import StakeApp from "@/components/stake/StakeApp";
import SwapApp from "@/components/swap/SwapApp";
import { useSiteWallet } from "./site-wallet";
import type { Start } from "./types";
import type { Signer } from "./types";

/** Before the built-in wallet is switched on: use a wallet the member already has (MetaMask, Trust, OKX… and Phantom, Solflare on Solana). */
export default function BrowserWallet({ start, app }: { start: Start; app?: "wallet" | "stake" | "swap" }) {
  const site = useSiteWallet();
  const sol = useSyncExternalStore(subscribe, getState, getState).sol;
  useEffect(() => { restoreSol().catch(() => {}); }, []);
  const signer: Signer = {
    mode: "browser", ready: site.ready, active: !!site.evm || !!sol, label: null,
    evm: site.evm,
    sol: sol ? { address: sol.account.address, sign: signSol } : null,
    loginExternal: undefined,
    login: () => { pickWallet({ fresh: true }); },
    logout: () => { disconnectWallet(); disconnectSol(); },
  };
  return app === "stake" ? <StakeApp signer={signer} start={start} /> : app === "swap" ? <SwapApp signer={signer} start={start} /> : <WalletApp signer={signer} start={start} />;
}
