import "./globals.css";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "AUTISTIK Hub",
  description: "Autism is not a disease. It's a community. Groups, AI companions, live sessions and $AUTISTIK airdrops for autistic adults.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io"),
  openGraph: { title: "AUTISTIK Hub", description: "Autism is not a disease. It's a community.", type: "website" },
  appleWebApp: { capable: true, title: "AUTISTIK", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#141830" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
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
        <script dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement,l=localStorage;if(l.getItem("calm")==="1")d.dataset.calm="on";if(l.getItem("big")==="1")d.dataset.size="large";var t=l.getItem("theme");if(t==="light"||t==="dark")d.dataset.theme=t}catch(e){}` }} />
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
