"use client";
import { useEffect, useState } from "react";
import { WCHAIN_LIST } from "@/lib/wallet-chains";
import WalletApp from "./WalletApp";
import type { Signer } from "./types";

/** Before the built-in wallet is switched on: use a wallet the member already has (MetaMask, Trust, OKX…). EVM only. */
export default function BrowserWallet({ start }: { start: { chain?: string; buy?: string } }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  const eth = () => (typeof window !== "undefined" ? (window as any).ethereum : null);

  useEffect(() => {
    const p = eth();
    if (!p) { setReady(true); return; }
    p.request({ method: "eth_accounts" }).then((a: string[]) => setAddress((a?.[0] as any) || null)).catch(() => {}).finally(() => setReady(true));
    const on = (a: string[]) => setAddress((a?.[0] as any) || null);
    p.on?.("accountsChanged", on);
    return () => p.removeListener?.("accountsChanged", on);
  }, []);

  async function switchTo(chainId: number) {
    const p = eth();
    const hex = "0x" + chainId.toString(16);
    try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch (e: any) {
      const c = WCHAIN_LIST.find((x) => x.chainId === chainId);
      if (e?.code !== 4902 || !c) throw e;
      await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: c.name, nativeCurrency: { name: c.native.name, symbol: c.native.symbol, decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: [c.explorer] }] });
    }
  }

  const signer: Signer = {
    mode: "browser", ready, active: !!address, label: null,
    evm: address ? {
      address,
      async send(chainId, tx) {
        await switchTo(chainId);
        return eth().request({ method: "eth_sendTransaction", params: [{ from: address, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value).toString(16) }] });
      },
    } : null,
    sol: null,
    login: () => {
      const p = eth();
      if (!p) { alert("No wallet found in this browser. Open this page in your wallet app's browser (Trust Wallet, MetaMask), or install MetaMask."); return; }
      p.request({ method: "eth_requestAccounts" }).then((a: string[]) => setAddress((a?.[0] as any) || null)).catch(() => {});
    },
    logout: () => setAddress(null),
  };
  return <WalletApp signer={signer} start={start} />;
}
