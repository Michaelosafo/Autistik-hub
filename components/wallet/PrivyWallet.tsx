"use client";
import { useState } from "react";
import { PrivyProvider, useConnectWallet, useExportWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useExportWallet as useSolExport, useSignTransaction, useWallets as useSolWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { WCHAINS } from "@/lib/wallet-chains";
import { WALLETCONNECT_ID } from "@/lib/connect";
import WalletApp from "./WalletApp";
import StakeApp from "@/components/stake/StakeApp";
import SwapApp from "@/components/swap/SwapApp";
import type { Start } from "./types";
import type { Signer } from "./types";

const toB64 = (u8: Uint8Array) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const SOL_RPC = WCHAINS.solana.rpc;

/**
 * The built-in AUTISTIK wallet, run by Privy: sign in with email or a passkey (Face ID / fingerprint) and get an
 * EVM wallet and a Solana wallet. Keys are split and kept in secure hardware; neither AUTISTIK nor anyone else can
 * use them without the member signing in.
 */
export default function PrivyWallet({ appId, start, app }: { appId: string; start: Start; app?: "wallet" | "stake" | "swap" }) {
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["email", "google", "apple", "passkey", "wallet"],
      appearance: {
        theme: "dark", accentColor: "#F0B90B", logo: "/icon.svg", landingHeader: "AUTISTIK Wallet", walletChainType: "ethereum-and-solana",
        // "Connect my wallet": wallets on this device first, then the top wallets, then WalletConnect for the rest.
        walletList: ["detected_ethereum_wallets", "metamask", "binance", "okx_wallet", "coinbase_wallet", "bitget_wallet", "rainbow", "phantom", "detected_solana_wallets", "wallet_connect"],
      },
      ...(WALLETCONNECT_ID ? { walletConnectCloudProjectId: WALLETCONNECT_ID } : {}),
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, solana: { createOnLogin: "users-without-wallets" }, showWalletUIs: true },
      supportedChains: [bsc, base, mainnet, arbitrum],
      defaultChain: bsc,
      solana: { rpcs: { "solana:mainnet": { rpc: createSolanaRpc(SOL_RPC), rpcSubscriptions: createSolanaRpcSubscriptions(SOL_RPC.replace(/^http/, "ws")), blockExplorerUrl: "https://solscan.io" } } },
    }}>
      <Inner start={start} app={app} />
    </PrivyProvider>
  );
}

const typedJson = (typed: { domain: any; types: any; primaryType: string; message: any }) => JSON.stringify({
  types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...typed.types },
  domain: typed.domain, primaryType: typed.primaryType, message: typed.message,
}, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const hexMsg = (m: string) => "0x" + Array.from(new TextEncoder().encode(m), (b) => b.toString(16).padStart(2, "0")).join("");

function Inner({ start, app }: { start: Start; app?: "wallet" | "stake" | "swap" }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const { wallets } = useWallets();
  const { wallets: solWallets } = useSolWallets();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();
  const { exportWallet: exportSol } = useSolExport();
  const [prefer, setPrefer] = useState<"embedded" | "external" | null>(null);
  // The built-in wallet, or a wallet the member connected (MetaMask, Trust, Phantom…). They pick which one trades.
  const evmEmbedded: any = wallets.find((w) => w.walletClientType === "privy");
  const evmExternal: any = wallets.find((w) => w.walletClientType !== "privy");
  const solEmbedded: any = solWallets.find((w: any) => /privy/i.test(w?.standardWallet?.name || ""));
  const solExternal: any = solWallets.find((w: any) => !/privy/i.test(w?.standardWallet?.name || ""));
  const using: "embedded" | "external" = prefer ?? (evmExternal || solExternal ? "external" : "embedded");
  const ev: any = using === "external" ? evmExternal || evmEmbedded : evmEmbedded || evmExternal;
  const sw: any = using === "external" ? solExternal || solEmbedded : solEmbedded || solExternal;

  const signer: Signer = {
    mode: "privy", ready, active: ready && authenticated && (!!ev || !!sw),
    label: user?.email?.address || null,
    using, canSwitch: !!(evmEmbedded || solEmbedded) && !!(evmExternal || solExternal), switchTo: setPrefer,
    evm: ev ? {
      address: ev.address,
      async send(chainId, tx) {
        await ev.switchChain(chainId);
        const p = await ev.getEthereumProvider();
        return p.request({ method: "eth_sendTransaction", params: [{ from: ev.address, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value).toString(16) }] });
      },
      async signTyped(chainId, typed) {
        await ev.switchChain(chainId);
        const p = await ev.getEthereumProvider();
        return p.request({ method: "eth_signTypedData_v4", params: [ev.address, typedJson(typed)] });
      },
      async signMessage(message) {
        const p = await ev.getEthereumProvider();
        return p.request({ method: "personal_sign", params: [hexMsg(message), ev.address] });
      },
    } : null,
    sol: sw ? {
      address: sw.address,
      async sign(txBase64) {
        const { signedTransaction } = await signTransaction({ transaction: fromB64(txBase64), wallet: sw, chain: "solana:mainnet" });
        return toB64(signedTransaction);
      },
    } : null,
    login,
    loginEmbedded: () => { setPrefer("embedded"); login({ loginMethods: ["email", "google", "apple", "passkey"] }); },
    loginExternal: () => { setPrefer("external"); if (authenticated) connectWallet(); else login({ loginMethods: ["wallet"] }); },
    logout: () => { setPrefer(null); logout(); },
    exportKey: (kind) => { (kind === "evm" ? exportWallet({ address: evmEmbedded?.address }) : exportSol({ address: solEmbedded?.address })).catch(() => {}); },
  };
  return app === "stake" ? <StakeApp signer={signer} start={start} /> : app === "swap" ? <SwapApp signer={signer} start={start} /> : <WalletApp signer={signer} start={start} />;
}
