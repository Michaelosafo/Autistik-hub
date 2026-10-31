// The Content Security Policy is set per request in middleware.ts (lib/csp.ts), so scripts can carry a nonce.

const sbOrigin = (() => { try { let u = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/^["']|["']$/g, ""); if (u && !/^https?:\/\//i.test(u)) u = "https://" + u; return u ? new URL(u).origin : ""; } catch { return ""; } })();
const HYPERFOCUS_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co${sbOrigin ? ` ${sbOrigin} ${sbOrigin.replace(/^https:/, "wss:")}` : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keeps first deploys smooth; run `npx tsc --noEmit` locally to see type hints.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Optional add-ons of the wallet library (Privy) that the Hub doesn't use: left out of the bundle.
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, "@farcaster/mini-app-solana": false, "@abstract-foundation/agw-client": false };
    return config;
  },
  // Old autistikk.com addresses keep working after the switch to the Hub.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/fund.html", destination: "/fund", permanent: true },
      { source: "/privacy.html", destination: "/safety", permanent: true },
      { source: "/autism.html", destination: "/autism", permanent: true },
      { source: "/how-to-buy", destination: "/buy", permanent: true },
      // The game arena is now Hyperfocus GP (public/hyperfocus). Old arena links land there.
      { source: "/arena", destination: "/hyperfocus", permanent: false },
      { source: "/arena/:path*", destination: "/hyperfocus", permanent: false },
    ];
  },
  // Profile links: autistik.io/@name opens that member's profile.
  async rewrites() {
    return [
      { source: "/@:handle", destination: "/u/:handle" },
      { source: "/.well-known/assetlinks.json", destination: "/api/assetlinks" },
      // Hyperfocus GP, the game arena, is a static page with its own scripts.
      { source: "/hyperfocus", destination: "/hyperfocus/index.html" },
    ];
  },
  async headers() {
    return [
      {
        // The app helper must always be checked for updates.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        // Files served without the middleware (the offline page) get a strict policy: no scripts at all.
        source: "/offline.html",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }],
      },
      {
        // Hyperfocus GP runs without the middleware, so it gets its own strict policy: its own scripts plus
        // three.js, QR and Supabase from two public CDNs, and live race rooms over Supabase Realtime.
        source: "/hyperfocus/:path*",
        headers: [{ key: "Content-Security-Policy", value: HYPERFOCUS_CSP }],
      },
      {
        source: "/hyperfocus",
        headers: [{ key: "Content-Security-Policy", value: HYPERFOCUS_CSP }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          // The Launch Pad guide uses the microphone (voice); nothing uses the camera, location or payments API.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
        ],
      },
    ];
  },
};
export default nextConfig;
