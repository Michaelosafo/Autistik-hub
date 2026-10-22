"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { WCHAIN_LIST } from "@/lib/wallet-chains";
import { XCHAINS } from "@/lib/bridge-chains";
import { getState, restoreWallet, subscribe } from "@/lib/connect";
import type { Signer } from "./types";

const typedJson = (typed: { domain: any; types: any; primaryType: string; message: any }) => JSON.stringify({
  types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...typed.types },
  domain: typed.domain, primaryType: typed.primaryType, message: typed.message,
}, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const hexMsg = (m: string) => "0x" + Array.from(new TextEncoder().encode(m), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The wallet connected through the site's "Connect a wallet" window (top bar, or any Connect button): MetaMask,
 * Trust, WalletConnect… Once the member approves the connection in their wallet, every page in this browser uses it
 * (it comes back after a reload, or when the phone returns from the wallet app), so they never connect twice.
 */
export function useSiteWallet(): { ready: boolean; name: string | null; evm: Signer["evm"] } {
  const current = useSyncExternalStore(subscribe, getState, getState).current;
  const prov = current?.provider ?? null;
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { restoreWallet().catch(() => null).finally(() => setReady(true)); }, []);
  useEffect(() => {
    if (!prov) { setAddress(null); return; }
    prov.request({ method: "eth_accounts" }).then((a: string[]) => setAddress((a?.[0] as any) || null)).catch(() => {});
    const on = (a: string[]) => setAddress((a?.[0] as any) || null);
    prov.on?.("accountsChanged", on);
    return () => prov.removeListener?.("accountsChanged", on);
  }, [prov]);

  async function switchTo(chainId: number) {
    const hex = "0x" + chainId.toString(16);
    try { await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch (e: any) {
      const c = WCHAIN_LIST.find((x) => x.chainId === chainId);
      const x = XCHAINS[chainId];
      if (e?.code !== 4902 || (!c && !x)) throw e;
      const add = c ? { chainName: c.name, nativeCurrency: { name: c.native.name, symbol: c.native.symbol, decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: [c.explorer] }
        : { chainName: x.name, nativeCurrency: { name: x.native.symbol, symbol: x.native.symbol, decimals: x.native.decimals }, rpcUrls: [x.rpc], blockExplorerUrls: [x.explorer] };
      await prov.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, ...add }] });
    }
  }

  const evm: Signer["evm"] = prov && address ? {
    address,
    async send(chainId, tx) {
      await switchTo(chainId);
      return prov.request({ method: "eth_sendTransaction", params: [{ from: address, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value).toString(16) }] });
    },
    async signTyped(chainId, typed) { await switchTo(chainId); return prov.request({ method: "eth_signTypedData_v4", params: [address, typedJson(typed)] }); },
    async signMessage(message) { return prov.request({ method: "personal_sign", params: [hexMsg(message), address] }); },
  } : null;
  return { ready, name: current?.name ?? null, evm };
}
