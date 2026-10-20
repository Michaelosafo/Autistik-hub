/**
 * The page's Content Security Policy, built per request so scripts can carry a one-time nonce.
 *
 * - Scripts: only ones this site serves with the nonce (and what they load, via 'strict-dynamic'). No inline
 *   scripts without the nonce, so injected <script> tags don't run.
 * - Connections: still any HTTPS for now (enforced), while a tight allowlist runs in report-only mode. Reports go to
 *   /api/csp-report; once they're clean the allowlist replaces https: (see CONNECT_ALLOW).
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
  "https://api.mainnet-beta.solana.com", "https://eth.llamarpc.com",
  // Built-in wallet (Privy) and wallet connections (WalletConnect).
  "https://auth.privy.io", "https://*.privy.io", "https://*.privy.systems", "wss://*.privy.io",
  "https://*.walletconnect.com", "https://*.walletconnect.org", "wss://*.walletconnect.com", "wss://*.walletconnect.org",
  "https://*.web3modal.org", "https://*.reown.com", "wss://*.reown.com",
  // "Are you human" check, Vercel preview toolbar and speed insights.
  "https://challenges.cloudflare.com", "https://vercel.live", "wss://ws-us3.pusher.com", "https://vitals.vercel-insights.com",
  ...(dev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : []),
].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i) as string[];

export function buildCsp(nonce: string) {
  const enforced = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://vercel.live`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com https://vercel.live",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' https: wss:${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    // The built-in wallet (Privy) keeps keys in its own secure frame.
    "frame-src https://challenges.cloudflare.com https://vercel.live https://auth.privy.io https://*.privy.io https://dexscreener.com https://*.walletconnect.com https://*.walletconnect.org https://verify.walletconnect.org https://verify.walletconnect.com https://secure.walletconnect.org https://*.reown.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  // Trial run of the tight connection list: the browser reports what it would block, but blocks nothing.
  const reportOnly = [`connect-src ${CONNECT_ALLOW.join(" ")}`, "report-uri /api/csp-report"].join("; ");
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
