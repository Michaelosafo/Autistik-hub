import type { MetadataRoute } from "next";

// The installable app (home screen, and the Google Play / App Store packages built from it).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AUTISTIK Hub",
    short_name: "AUTISTIK",
    description: "Autism community and Web3 hub: safe self-custody wallet, coin analytics, launchpad, liquidity locker, groups and live sessions.",
    id: "/",
    // The installed app opens straight on the tools.
    start_url: "/app?source=app",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#0B0E17",
    theme_color: "#0B0E17",
    lang: "en",
    dir: "ltr",
    prefer_related_applications: false,
    categories: ["finance", "social", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      { src: "/screenshots/home.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Home" },
      { src: "/screenshots/wallet.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Buy coins in one tap" },
      { src: "/screenshots/analytics.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Check any coin" },
      { src: "/screenshots/lockers.png", sizes: "1080x1920", type: "image/png", form_factor: "narrow", label: "Lock liquidity" },
    ],
    shortcuts: [
      { name: "Wallet", url: "/wallet", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Check a coin", url: "/analytics", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Launch a coin", url: "/launchpad/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Talk to Believer", url: "/companions?c=believer", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  } as unknown as MetadataRoute.Manifest;
}
