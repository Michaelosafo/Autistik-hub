"use client";
import { pickWallet } from "@/lib/connect";
import { createWalletClient, custom } from "viem";
import { bsc } from "viem/chains";
import { linkMessage } from "@/lib/wallet";

/**
 * Ties a wallet to this Hub account: the member signs a free message in their wallet and the server checks it.
 * Resolves with the linked address, or throws with a message to show. Moves no funds.
 */
export async function linkWallet(uid: string): Promise<string> {
  const eth = await pickWallet();
  if (!eth) throw new Error("No wallet chosen.");
  try {
    const client = createWalletClient({ chain: bsc, transport: custom(eth) });
    const [address] = await client.requestAddresses();
    const issued = new Date().toISOString();
    const signature = await client.signMessage({ account: address, message: linkMessage(uid, issued) });
    const res = await fetch("/api/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address, issued, signature }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't link your wallet.");
    return data.address as string;
  } catch (e: any) {
    throw new Error(e?.shortMessage ? "You cancelled in your wallet. Nothing was linked." : e?.message || "Couldn't link your wallet.");
  }
}
