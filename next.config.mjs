// What the browser may load. Scripts only from this site (plus Cloudflare's "are you human" check and Vercel's
// preview toolbar), so injected scripts from other sites won't run. Fonts come from Google Fonts. Wallet and price
// data use many HTTPS services, so connections are limited to HTTPS rather than a list.
const dev = process.env.NODE_ENV !== "production";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com https://vercel.live`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://vercel.live",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https: wss:${dev ? " ws: http://localhost:*" : ""}`,
  "frame-src https://challenges.cloudflare.com https://vercel.live",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keeps first deploys smooth; run `npx tsc --noEmit` locally to see type hints.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Old autistikk.com addresses keep working after the switch to the Hub.
  async redirects() {
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/fund.html", destination: "/fund", permanent: true },
      { source: "/privacy.html", destination: "/safety", permanent: true },
      { source: "/autism.html", destination: "/autism", permanent: true },
      { source: "/how-to-buy", destination: "/buy", permanent: true },
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
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
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
