"use client";
import { useEffect } from "react";
import { getState, pickWallet, subscribe } from "@/lib/connect";

// The game's scripts, loaded in order once the page is on screen.
const SCRIPTS = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
  "/hyperfocus/swap.js",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "/hyperfocus/fx.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "/hyperfocus/net.js",
  "/hyperfocus/sim.js",
  "/hyperfocus/game.js",
];

const short = (a: string, n = 6) => (a.length > n + 6 ? `${a.slice(0, n)}…${a.slice(-4)}` : a);
const CHAIN_ID: Record<string, number> = { bsc: 56, base: 8453, ethereum: 1 };
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const pad = (h: string) => h.replace(/^0x/, "").toLowerCase().padStart(64, "0");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The connected EVM wallet (the site's own connection), switched to the right network. */
async function evm(chainId: number) {
  const prov: any = getState().current?.provider;
  if (!prov) throw new Error("Connect a wallet first.");
  const acc = await prov.request({ method: "eth_requestAccounts" });
  const from = String(acc?.[0] || "");
  if (!from) throw new Error("Connect a wallet first.");
  try { await prov.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + chainId.toString(16) }] }); }
  catch { throw new Error("Switch your wallet to the right network and try again."); }
  return { prov, from };
}
async function waitTx(prov: any, hash: string) {
  for (let i = 0; i < 90; i++) {
    const r = await prov.request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null);
    if (r) { if (r.status === "0x1") return r; throw new Error("The transaction failed on-chain."); }
    await sleep(2000);
  }
  throw new Error("Still waiting for the transaction. Check your wallet.");
}
async function walletApi(action: string, body: unknown) {
  const r = await fetch(`/api/wallet/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "That didn't work. Try again.");
  return j;
}

/** Starts Hyperfocus GP and lets its Wallet tab use the site's own wallet connection. */
export default function HFBoot({ nonce }: { nonce?: string }) {
  useEffect(() => {
    const w = window as any;
    // The game script runs once per page load; coming back through an in-site link reloads the page cleanly.
    if (w.__hfBooted) { window.location.reload(); return; }
    w.__hfBooted = true;
    w.HFWallet = {
      connect: () => pickWallet({ fresh: true }),
      subscribe: (f: () => void) => subscribe(f),
      label: async () => {
        const st = getState();
        const parts: string[] = [];
        if (st.current) {
          let a = "";
          try { const acc = await st.current.provider?.request?.({ method: "eth_accounts" }); a = (acc && acc[0]) || ""; } catch {}
          parts.push(a ? `${st.current.name} ${short(a)}` : st.current.name);
        }
        if (st.sol) {
          const a = String((st.sol.account as any)?.address || "");
          parts.push(a ? `${st.sol.name} ${short(a, 4)}` : st.sol.name);
        }
        return parts.join(" · ");
      },
      /** The connected wallet addresses, so a player can find their own car among a token's real holders. */
      addresses: async () => {
        const st = getState();
        let evm = "";
        try { const acc = await st.current?.provider?.request?.({ method: "eth_accounts" }); evm = (acc && acc[0]) || ""; } catch {}
        return { evm, sol: String((st.sol?.account as any)?.address || "") };
      },
      /** Sends a token transfer the game prepared (paid-race entry), signed in the player's own wallet. */
      sendTokenTx: async (chainId: number, token: string, data: string) => {
        const { prov, from } = await evm(chainId);
        const hash = await prov.request({ method: "eth_sendTransaction", params: [{ from, to: token, data, value: "0x0" }] });
        return { hash: String(hash), from };
      },
      /**
       * Buys a token with the chain's coin, or sells a token back to it ("all" sells the whole balance), through AUTISTIK
       * Swap's own routes. Every step is approved by the player in their wallet; the tokens always come back to them.
       */
      swap: async (o: { chain: string; side: "buy" | "sell"; token: string; amount: string }) => {
        const chainId = CHAIN_ID[o.chain];
        if (!chainId) throw new Error("In-race trading works on BNB Chain, Base and Ethereum.");
        const { prov, from } = await evm(chainId);
        let amount = o.amount;
        if (o.side === "sell" && amount === "all") {
          const res = await prov.request({ method: "eth_call", params: [{ to: o.token, data: "0x70a08231" + pad(from) }, "latest"] });
          amount = BigInt(res || "0x0").toString();
          if (amount === "0") return { skipped: true };
        }
        if (!/^\d{1,78}$/.test(amount) || BigInt(amount) <= 0n) throw new Error("Enter an amount.");
        const tokenIn = o.side === "buy" ? NATIVE : o.token, tokenOut = o.side === "buy" ? o.token : NATIVE;
        const { quote } = await walletApi("quote", { chain: o.chain, tokenIn, tokenOut, amount });
        const { tx } = await walletApi("build", { chain: o.chain, quote, from, slippageBps: o.side === "buy" ? 800 : 1500 });
        if (tx.spender) {
          const al = await prov.request({ method: "eth_call", params: [{ to: o.token, data: "0xdd62ed3e" + pad(from) + pad(tx.spender) }, "latest"] });
          if (BigInt(al || "0x0") < BigInt(amount)) {
            const ah = await prov.request({ method: "eth_sendTransaction", params: [{ from, to: o.token, data: "0x095ea7b3" + pad(tx.spender) + pad(BigInt(amount).toString(16)), value: "0x0" }] });
            await waitTx(prov, String(ah));
          }
        }
        const hash = await prov.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data, value: "0x" + BigInt(tx.value || "0").toString(16) }] });
        await waitTx(prov, String(hash));
        return { hash: String(hash), amountIn: amount, amountOut: String(quote.amountOut), inUsd: quote.inUsd ?? null, outUsd: quote.outUsd ?? null };
      },
    };
    let i = 0;
    const next = () => {
      if (i >= SCRIPTS.length) return;
      const s = document.createElement("script");
      s.src = SCRIPTS[i++];
      if (nonce) s.nonce = nonce;
      s.async = false;
      s.onload = next;
      s.onerror = next;
      document.body.appendChild(s);
    };
    next();
  }, [nonce]);
  return null;
}
