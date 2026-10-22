"use client";
import WalletApp from "./WalletApp";
import { disconnectWallet, pickWallet } from "@/lib/connect";
import StakeApp from "@/components/stake/StakeApp";
import SwapApp from "@/components/swap/SwapApp";
import { useSiteWallet } from "./site-wallet";
import type { Start } from "./types";
import type { Signer } from "./types";

/** Before the built-in wallet is switched on: use a wallet the member already has (MetaMask, Trust, OKX…). EVM only. */
export default function BrowserWallet({ start, app }: { start: Start; app?: "wallet" | "stake" | "swap" }) {
  const site = useSiteWallet();
  const signer: Signer = {
    mode: "browser", ready: site.ready, active: !!site.evm, label: null,
    evm: site.evm,
    sol: null,
    loginExternal: undefined,
    login: () => { pickWallet({ fresh: true }); },
    logout: () => { disconnectWallet(); },
  };
  return app === "stake" ? <StakeApp signer={signer} start={start} /> : app === "swap" ? <SwapApp signer={signer} start={start} /> : <WalletApp signer={signer} start={start} />;
}
