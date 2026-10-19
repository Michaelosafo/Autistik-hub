"use client";
import { useEffect, useState } from "react";
import { WCHAIN_LIST } from "@/lib/wallet-chains";
import WalletApp from "./WalletApp";
import { currentWallet, disconnectWallet, pickWallet, restoreWallet } from "@/lib/connect";
import StakeApp from "@/components/stake/StakeApp";
import type { Start } from "./types";
import type { Signer } from "./types";

const typedJson = (address: string, typed: { domain: any; types: any; primaryType: string; message: any }) => JSON.stringify({
  types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], ...typed.types },
  domain: typed.domain, primaryType: typed.primaryType, message: typed.message,
}, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
const hexMsg = (m: string) => "0x" + Array.from(new TextEncoder().encode(m), (b) => b.toString(16).padStart(2, "0")).join("");
/** Before the built-in wallet is switched on: use a wallet the member already has (MetaMask, Trust, OKX…). EVM only. */
export default function BrowserWallet({ start, app }: { start: Start; app?: "wallet" | "stake" }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  // The wallet picked in the "Connect a wallet" sheet (MetaMask, Trust, Binance, OKX, WalletConnect…).
  const [prov, setProv] = useState<any>(null);
  const eth = () => prov ?? currentWallet()?.provider ?? null;

  useEffect(() => {
    restoreWallet().then((p) => p && setProv(p)).finally(() => setReady(true));
    const changed = () => setProv(currentWallet()?.provider ?? null);
    addEventListener("aw-wallet-changed", changed);
    return () => removeEventListener("aw-wallet-changed", changed);
  }, []);

  useEffect(() => {
    if (!prov) { setAddress(null); return; }
    prov.request({ method: "eth_accounts" }).then((a: string[]) => setAddress((a?.[0] as any) || null)).catch(() => {});
    const on = (a: string[]) => setAddress((a?.[0] as any) || null);
    prov.on?.("accountsChanged", on);
    return () => prov.removeListener?.("accountsChanged", on);
  }, [prov]);

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
      async signTyped(chainId, typed) { await switchTo(chainId); return eth().request({ method: "eth_signTypedData_v4", params: [address, typedJson(address, typed)] }); },
      async signMessage(message) { return eth().request({ method: "personal_sign", params: [hexMsg(message), address] }); },
    } : null,
    sol: null,
    loginExternal: undefined,
    login: () => { pickWallet({ fresh: true }).then((p) => p && setProv(p)); },
    logout: () => { disconnectWallet(); setProv(null); setAddress(null); },
  };
  return app === "stake" ? <StakeApp signer={signer} start={start} /> : <WalletApp signer={signer} start={start} />;
}
