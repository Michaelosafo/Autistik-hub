"use client";
import { PrivyProvider, useExportWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useExportWallet as useSolExport, useSignTransaction, useWallets as useSolWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { WCHAINS } from "@/lib/wallet-chains";
import WalletApp from "./WalletApp";
import type { Signer } from "./types";

const toB64 = (u8: Uint8Array) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const SOL_RPC = WCHAINS.solana.rpc;

/**
 * The built-in AUTISTIK wallet, run by Privy: sign in with email or a passkey (Face ID / fingerprint) and get an
 * EVM wallet and a Solana wallet. Keys are split and kept in secure hardware; neither AUTISTIK nor anyone else can
 * use them without the member signing in.
 */
export default function PrivyWallet({ appId, start }: { appId: string; start: { chain?: string; buy?: string } }) {
  return (
    <PrivyProvider appId={appId} config={{
      loginMethods: ["email", "passkey", "wallet"],
      appearance: { theme: "dark", accentColor: "#3EE58F", logo: "/icon.svg", landingHeader: "AUTISTIK Wallet", walletChainType: "ethereum-and-solana" },
      embeddedWallets: { ethereum: { createOnLogin: "all-users" }, solana: { createOnLogin: "all-users" }, showWalletUIs: true },
      supportedChains: [bsc, base, mainnet, arbitrum],
      defaultChain: bsc,
      solana: { rpcs: { "solana:mainnet": { rpc: createSolanaRpc(SOL_RPC), rpcSubscriptions: createSolanaRpcSubscriptions(SOL_RPC.replace(/^http/, "ws")), blockExplorerUrl: "https://solscan.io" } } },
    }}>
      <Inner start={start} />
    </PrivyProvider>
  );
}

function Inner({ start }: { start: { chain?: string; buy?: string } }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solWallets } = useSolWallets();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();
  const { exportWallet: exportSol } = useSolExport();
  // Prefer the built-in wallets; a connected outside wallet (like MetaMask or Phantom) works too.
  const ev: any = wallets.find((w) => w.walletClientType === "privy") || wallets[0];
  const sw: any = solWallets.find((w: any) => /privy/i.test(w?.standardWallet?.name || "")) || solWallets[0];

  const signer: Signer = {
    mode: "privy", ready, active: ready && authenticated,
    label: user?.email?.address || null,
    evm: ev ? {
      address: ev.address,
      async send(chainId, tx) {
        await ev.switchChain(chainId);
        const p = await ev.getEthereumProvider();
        return p.request({ method: "eth_sendTransaction", params: [{ from: ev.address, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value).toString(16) }] });
      },
    } : null,
    sol: sw ? {
      address: sw.address,
      async sign(txBase64) {
        const { signedTransaction } = await signTransaction({ transaction: fromB64(txBase64), wallet: sw, chain: "solana:mainnet" });
        return toB64(signedTransaction);
      },
    } : null,
    login, logout,
    exportKey: (kind) => { (kind === "evm" ? exportWallet({ address: ev?.address }) : exportSol({ address: sw?.address })).catch(() => {}); },
  };
  return <WalletApp signer={signer} start={start} />;
}
