import "./globals.css";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "AUTISTIK Hub",
  description: "Autism is not a disease. It's a community. Groups, AI companions, live sessions and $AUTISTIK airdrops for autistic adults.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autistikk.com"),
  openGraph: { title: "AUTISTIK Hub", description: "Autism is not a disease. It's a community.", type: "website" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  let me: { alias: string; is_admin: boolean } | null = null;
  if (user) {
    const { data } = await sb.from("profiles").select("alias,is_admin").eq("id", user.id).single();
    me = data ?? { alias: "Member", is_admin: false };
  }
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Unbounded:wght@500;700;800&family=JetBrains+Mono:wght@400;600&display=swap" />
      </head>
      <body>
        <Shell me={me}>{children}</Shell>
      </body>
    </html>
  );
}
