import "./globals.css";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import Welcome from "@/components/Welcome";
import { headers } from "next/headers";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "AUTISTIK Hub",
  description: "Autism is not a disease. It's a community. Groups, companion assistants, live sessions and $AUTISTIK airdrops for autistic adults.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io"),
  openGraph: { title: "AUTISTIK Hub", description: "Autism is not a disease. It's a community.", type: "website" },
  appleWebApp: { capable: true, title: "AUTISTIK", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#141830" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get("x-nonce") ?? undefined;
  const sb = supabaseServer();
  const user = await currentUser();
  let me: { alias: string; color: string; is_admin: boolean } | null = null;
  if (user) {
    // The Admin menu item only shows for the owner (see supabase/admin-lock.sql).
    const [{ data }, { data: owner }] = await Promise.all([sb.from("profiles").select("alias, color").eq("id", user.id).single(), sb.rpc("is_owner")]);
    me = { alias: data?.alias ?? "Member", color: /^#[0-9a-f]{6}$/i.test(data?.color || "") ? data!.color : "#6141D4", is_admin: owner === true };
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies saved comfort settings before the page paints, so there's no flash of bright colours or motion. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement,l=localStorage;if(l.getItem("calm")==="1")d.dataset.calm="on";if(l.getItem("big")==="1")d.dataset.size="large";var t=l.getItem("theme");if(t==="light"||t==="dark")d.dataset.theme=t;if(sessionStorage.getItem("welcomed")==="1"||+(l.getItem("welcomes")||0)>=2)d.dataset.welcomed="1"}catch(e){}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Unbounded:wght@500;700;800&family=JetBrains+Mono:wght@400;600&display=swap" />
      </head>
      <body>
        {/* Without JavaScript the welcome can't close, so it isn't shown at all. */}
        <noscript><style>{`.welcome{display:none}`}</style></noscript>
        <Welcome />
        <Shell me={me}>{children}</Shell>
      </body>
    </html>
  );
}
