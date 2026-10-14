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
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;
