/**
 * Solana wallets in the browser (Phantom, Solflare, Backpack and any other Wallet Standard wallet), for the Launch Pad.
 * Transactions are built on the server, signed here in the member's wallet, then sent through the Hub's node.
 * Browser only.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";

export type SolWallet = { wallet: Wallet; account: WalletAccount };

/** Wallets on this device that can sign Solana transactions. */
export function solWallets(): Wallet[] {
  return getWallets().get().filter((w) => "standard:connect" in w.features && "solana:signTransaction" in w.features && w.chains.some((c) => c.startsWith("solana:")));
}

export async function connectSol(w: Wallet): Promise<SolWallet> {
  const { accounts } = await (w.features["standard:connect"] as any).connect();
  const account = (accounts as WalletAccount[]).find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
  if (!account) throw new Error("The wallet didn't share an account.");
  return { wallet: w, account };
}

const toBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toB64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

async function wallet<T>(action: string, body: object): Promise<T> {
  const r = await fetch(`/api/wallet/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Couldn't reach Solana. Try again.");
  return d as T;
}

/** Signs a base64 transaction in the wallet, sends it, and waits until Solana confirms it. Returns the signature. */
export async function signAndSend(sw: SolWallet, txBase64: string): Promise<string> {
  const [out] = await (sw.wallet.features["solana:signTransaction"] as any).signTransaction({ account: sw.account, transaction: toBytes(txBase64), chain: "solana:mainnet" });
  const { signature } = await wallet<{ signature: string }>("sol-send", { tx: toB64(out.signedTransaction) });
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { status } = await wallet<{ status: string }>("sol-status", { sig: signature }).catch(() => ({ status: "pending" }));
    if (status === "done") return signature;
    if (status === "failed") throw new Error("The transaction failed on Solana. Only the network fee was used.");
  }
  throw new Error("Solana is slow right now. Check your wallet's activity before trying again.");
}

/** Calls the Solana Launch Pad API (app/api/launchpad/solana). */
export async function solLaunchApi<T>(action: string, body: object): Promise<T> {
  const r = await fetch("/api/launchpad/solana", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Something went wrong. Try again.");
  return d as T;
}

export const solErr = (e: any) => {
  const m = String(e?.message || e || "");
  if (/^(Not enough|That took too long|That pool already|The wallet changed|Solana rejected)/.test(m)) return m;
  return /reject|denied|cancel|declined/i.test(m) ? "You cancelled in your wallet." : /insufficient|0x1\b/i.test(m) ? "Not enough SOL in this wallet." : m.slice(0, 220) || "Something went wrong.";
};
