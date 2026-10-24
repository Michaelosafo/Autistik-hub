"use client";
import { useEffect, useState } from "react";
import { PrivyProvider, useExportWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useExportWallet as useSolExport, useSignTransaction, useWallets as useSolWallets } from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { bsc } from "viem/chains";
import { WCHAINS } from "@/lib/wallet-chains";
import { XCHAIN_LIST } from "@/lib/bridge-chains";
import { WALLETCONNECT_ID, disconnectWallet, pickWallet } from "@/lib/connect";
import { useSiteWallet } from "./site-wallet";
import WalletApp from "./WalletApp";
import AuthenticatorGate from "./AuthenticatorGate";
import StakeApp from "@/components/stake/StakeApp";
import SwapApp from "@/components/swap/SwapApp";
import type { Member, Start } from "./types";
import type { Signer } from "./types";

const toB64 = (u8: Uint8Array) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const SOL_RPC = WCHAINS.solana.rpc;

/**
 * The built-in AUTISTIK wallet, run by Privy: every member gets an EVM wallet and a Solana wallet for the email they
 * joined with. They unlock it with a code sent to that email, and must add an authenticator app before first use.
 * Keys are split and kept in secure hardware; neither AUTISTIK nor anyone else can use them without the member.
 */
export default function PrivyWallet({ appId, member, start, app }: { appId: string; member: Member | null; start: Start; app?: "wallet" | "stake" | "swap" }) {
  return (
    <PrivyProvider appId={appId} config={{
      // Only the email they joined the Hub with (a code is sent to it), or their own wallet.
      loginMethods: ["email", "wallet"],
      appearance: {
        theme: "dark", accentColor: "#F0B90B", logo: "/icon.svg", landingHeader: "AUTISTIK Wallet", walletChainType: "ethereum-and-solana",
        // "Connect my wallet": wallets on this device first, then Bitget, WalletConnect (Trust and 600+ more) and the top wallets.
        // Trust Wallet, SafePal, TokenPocket and 600+ more are under WalletConnect (Privy has no separate button for them).
        walletList: ["detected_ethereum_wallets", "detected_solana_wallets", "bitget_wallet", "wallet_connect", "metamask", "binance", "okx_wallet", "phantom",
          "solflare", "backpack", "coinbase_wallet", "bybit_wallet", "rainbow", "zerion", "uniswap", "cryptocom", "safe", "wallet_connect_qr_solana"],
      },
      ...(WALLETCONNECT_ID ? { walletConnectCloudProjectId: WALLETCONNECT_ID } : {}),
      embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, solana: { createOnLogin: "users-without-wallets" }, showWalletUIs: true },
      // Every network the swap reaches, so the wallet can switch to it.
      supportedChains: XCHAIN_LIST.filter((c) => c.viem).map((c) => c.viem),
      defaultChain: bsc,
      solana: { rpcs: { "solana:mainnet": { rpc: createSolanaRpc(SOL_RPC), rpcSubscriptions: createSolanaRpcSubscriptions(SOL_RPC.replace(/^http/, "ws")), blockExplorerUrl: "https://solscan.io" } } },
    }}>
      <Inner member={member} start={start} app={app} />
    </PrivyProvider>
  );
}

const typedJson = (typed: { domain: any; types: any; primaryType: string; message: any }) => JSON.stringify({
  types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...typed.types },
  domain: typed.domain, primaryType: typed.primaryType, message: typed.message,
}, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const hexMsg = (m: string) => "0x" + Array.from(new TextEncoder().encode(m), (b) => b.toString(16).padStart(2, "0")).join("");

/** A wallet Privy knows (built-in or connected through Privy) as what the screens sign with. */
const fromPrivy = (ev: any): Signer["evm"] => ev ? {
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
} : null;

function Inner({ member, start, app }: { member: Member | null; start: Start; app?: "wallet" | "stake" | "swap" }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solWallets } = useSolWallets();
  const { signTransaction } = useSignTransaction();
  const { exportWallet } = useExportWallet();
  const { exportWallet: exportSol } = useSolExport();
  const [prefer, setPrefer] = useState<"embedded" | "external" | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const [mismatch, setMismatch] = useState("");
  // The built-in wallet belongs to the Hub account: if someone unlocks it with a different email, sign that out.
  const privyEmail = user?.email?.address?.toLowerCase() || null;
  useEffect(() => {
    if (!ready || !authenticated || !privyEmail || privyEmail === member?.email) return;
    setMismatch(member ? `That wallet belongs to ${privyEmail}, not the email you're signed in to the Hub with (${member.email}). Unlock it with ${member.email}.`
      : "Sign in to your Hub account first, then unlock your AUTISTIK wallet.");
    logout();
  }, [ready, authenticated, member, privyEmail, logout]);
  // The built-in wallet, or a wallet the member connected (MetaMask, Trust, Phantom…). They pick which one trades.
  const evmEmbedded: any = wallets.find((w) => w.walletClientType === "privy");
  const privyExternal: any = wallets.find((w) => w.walletClientType !== "privy");
  // A wallet connected from the top bar (or any Connect button on the site) counts too: once approved in the
  // wallet, the swap uses it straight away, with no second sign-in.
  const site = useSiteWallet();
  const solEmbedded: any = solWallets.find((w: any) => /privy/i.test(w?.standardWallet?.name || ""));
  const solExternal: any = solWallets.find((w: any) => !/privy/i.test(w?.standardWallet?.name || ""));
  const evmOwn = fromPrivy(privyExternal) || site.evm;
  const evmBuilt = fromPrivy(evmEmbedded);
  const using: "embedded" | "external" = prefer ?? (evmOwn || solExternal ? "external" : "embedded");
  const evm = using === "external" ? evmOwn || evmBuilt : evmBuilt || evmOwn;
  const sw: any = using === "external" ? solExternal || solEmbedded : solEmbedded || solExternal;

  const signer: Signer = {
    mode: "privy", ready: ready && site.ready, active: (ready && authenticated && !!sw) || !!evm,
    label: user?.email?.address || null,
    using, canSwitch: !!(evmEmbedded || solEmbedded) && !!(evmOwn || solExternal), switchTo: setPrefer,
    evm,
    sol: sw ? {
      address: sw.address,
      async sign(txBase64) {
        const { signedTransaction } = await signTransaction({ transaction: fromB64(txBase64), wallet: sw, chain: "solana:mainnet" });
        return toB64(signedTransaction);
      },
    } : null,
    login,
    // The built-in wallet needs a Hub account: sign in (or join) first, then unlock it with a code sent to that email.
    loginEmbedded: () => {
      if (!member) { window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`; return; }
      setMismatch(""); setPrefer("embedded");
      login({ loginMethods: ["email"], prefill: { type: "email", value: member.email } });
    },
    // Connect a wallet with the site's own window: approve once in the wallet and this browser stays connected.
    loginExternal: () => { setPrefer("external"); pickWallet({ fresh: true }); },
    logout: () => { setPrefer(null); disconnectWallet(); if (authenticated) logout(); },
    exportKey: (kind) => { (kind === "evm" ? exportWallet({ address: evmEmbedded?.address }) : exportSol({ address: solEmbedded?.address })).catch(() => {}); },
  };
  // An authenticator app is required before the built-in wallet can be used (Privy then asks for its code to sign).
  const usesBuilt = (!!evmBuilt && evm === evmBuilt) || (!!solEmbedded && sw === solEmbedded);
  const hasAuthenticator = enrolled || !!user?.mfaMethods?.includes("totp");
  if (ready && authenticated && usesBuilt && !hasAuthenticator) {
    return <AuthenticatorGate email={privyEmail} onDone={() => setEnrolled(true)} onSignOut={signer.logout} />;
  }
  const note = mismatch ? <div className="notice warn" role="alert">{mismatch}</div> : null;
  return <>{note}{app === "stake" ? <StakeApp signer={signer} start={start} /> : app === "swap" ? <SwapApp signer={signer} start={start} /> : <WalletApp signer={signer} start={start} member={member} />}</>;
}
