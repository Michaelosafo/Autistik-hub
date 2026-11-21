/**
 * The page's Content Security Policy, built per request so scripts can carry a one-time nonce.
 *
 * - Scripts: only ones this site serves with the nonce (and what they load, via 'strict-dynamic'). No inline
 *   scripts without the nonce, so injected <script> tags don't run.
 * - Connections: only the services in CONNECT_ALLOW (enforced since 2026-11-21, after two weeks of clean report-only
 *   runs). A script that slipped in can't send data to an unknown server. Anything blocked is still reported to
 *   /api/csp-report, so a missing service shows up there.
 */
const dev = process.env.NODE_ENV !== "production";

const origin = (u: string | undefined) => { try { return u ? new URL(u).origin : null; } catch { return null; } };
const wss = (o: string | null) => (o ? o.replace(/^https:/, "wss:") : null);

const SUPABASE = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const RPCS = [
  process.env.NEXT_PUBLIC_BSC_RPC || "https://bsc-dataseed.bnbchain.org",
  process.env.NEXT_PUBLIC_BASE_RPC || "https://mainnet.base.org",
  process.env.NEXT_PUBLIC_ETHEREUM_RPC || "https://ethereum-rpc.publicnode.com",
  process.env.NEXT_PUBLIC_ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc",
  process.env.NEXT_PUBLIC_SOLANA_RPC || "https://solana-rpc.publicnode.com",
].map(origin);

/** Everything the browser itself needs to talk to. Server-side calls (price APIs, swaps) don't count here. */
export const CONNECT_ALLOW = [
  "'self'",
  SUPABASE, wss(SUPABASE),
  ...RPCS, ...RPCS.map(wss),
  // Launch Pad and token tools read these chains in the browser.
  "https://*.publicnode.com", "wss://*.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://*.bnbchain.org",
  "https://mainnet.base.org", "https://arb1.arbitrum.io", "https://mainnet.optimism.io", "https://rpc.linea.build",
  "https://mainnet.unichain.org", "https://api.mainnet.abs.xyz", "https://rpc.mainnet.chain.robinhood.com",
  "https://api.mainnet-beta.solana.com", "https://eth.llamarpc.com", "https://*.llamarpc.com", "https://*.drpc.org", "wss://*.drpc.org",
  "https://rpc.ankr.com", "https://polygon-rpc.com", "https://*.blastapi.io", "https://*.g.alchemy.com",
  // Google sign-in checks the session from the browser.
  "https://accounts.google.com", "https://oauth2.googleapis.com",
  // Price and chart data some widgets read straight from the browser.
  "https://api.dexscreener.com", "https://api.geckoterminal.com", "https://api.coingecko.com", "https://lite-api.jup.ag", "https://api.jup.ag",
  // Game scripts (Hyperfocus GP) load from these CDNs.
  "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com",
  // Built-in wallet (Privy) and wallet connections (WalletConnect).
  "https://auth.privy.io", "https://*.privy.io", "https://*.privy.systems", "wss://*.privy.io",
  "https://*.walletconnect.com", "https://*.walletconnect.org", "wss://*.walletconnect.com", "wss://*.walletconnect.org",
  "https://*.web3modal.org", "https://*.reown.com", "wss://*.reown.com",
  // "Are you human" check, Vercel preview toolbar and speed insights.
  // TIK videos and live streams (Cloudflare Stream): uploads and browser broadcasting.
  "https://*.cloudflarestream.com",
  "https://challenges.cloudflare.com", "https://vercel.live", "wss://ws-us3.pusher.com", "https://vitals.vercel-insights.com",
  ...(dev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : []),
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

export function buildCsp(nonce: string) {
  const enforced = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://vercel.live`,
    // Google sign-in (components/GoogleSignIn.tsx): its button frame, popup and stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com https://vercel.live",
    "img-src 'self' data: blob: https:",
    `connect-src ${CONNECT_ALLOW.join(" ")}`,
    // YouTube live sessions play on /live. The built-in wallet (Privy) keeps keys in its own secure frame.
    "frame-src https://accounts.google.com https://www.youtube-nocookie.com https://player.vimeo.com https://w.soundcloud.com https://open.spotify.com https://challenges.cloudflare.com https://vercel.live https://auth.privy.io https://*.privy.io https://dexscreener.com https://*.walletconnect.com https://*.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org https://*.reown.com https://*.cloudflarestream.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Voice notes in Chats are played from the site's own storage (Supabase).
    "media-src 'self' data: blob: https://*.supabase.co https://*.cloudflarestream.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  // The connection list is enforced now; report-only keeps watching a stricter script rule (no third-party script hosts).
  const reportOnly = [`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, "report-uri /api/csp-report"].join("; ");
  return { enforced, reportOnly };
}

/** A fresh random nonce (Edge and Node both have Web Crypto). */
export function makeNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
