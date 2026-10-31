"use client";
import { useEffect } from "react";
import { getState, pickWallet, subscribe } from "@/lib/connect";

// The game's scripts, loaded in order once the page is on screen.
const SCRIPTS = [
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
  "/hyperfocus/swap.js",
  "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "/hyperfocus/net.js",
  "/hyperfocus/game.js",
];

const short = (a: string, n = 6) => (a.length > n + 6 ? `${a.slice(0, n)}…${a.slice(-4)}` : a);

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
