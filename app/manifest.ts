import type { MetadataRoute } from "next";

// Lets people install the Hub on their phone's home screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AUTISTIK Hub",
    short_name: "AUTISTIK",
    description: "Autism is not a disease. It's a community. Groups, companion assistants and live sessions for autistic adults.",
    id: "/",
    start_url: "/?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141830",
    theme_color: "#141830",
    categories: ["social", "lifestyle", "health"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Talk to Believer", url: "/companions?c=believer", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Community", url: "/community", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Trending tokens", url: "/launchpad", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
