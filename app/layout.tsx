import "./globals.css";
import BotFab from "@/components/BotFab";
import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import Welcome from "@/components/Welcome";
import WalletGate from "@/components/WalletGate";
import { headers } from "next/headers";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "AUTISTIK Hub",
  description: "Autism is not a disease. It's a community. Groups, companion assistants, live sessions and $AUTISTIK airdrops for autistic adults.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://autistik.io"),
  openGraph: { title: "AUTISTIK Hub", description: "Autism is not a disease. It's a community.", type: "website" },
  appleWebApp: { capable: true, title: "AUTISTIK", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#F7F5FC" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = headers().get("x-nonce") ?? undefined;
  const sb = supabaseServer();
  const user = await currentUser();
  let needWallet = false;
  let me: { id: string; alias: string; color: string; avatar_url: string | null; is_admin: boolean; mfa: boolean } | null = null;
  if (user) {
    const { data: w0 } = await sb.from("wallets").select("user_id").eq("user_id", user.id).maybeSingle();
    needWallet = !w0;
    // The Admin menu item only shows for the owner (see supabase/admin-lock.sql).
    const [{ data }, { data: owner }] = await Promise.all([sb.from("profiles").select("alias, color, avatar_url").eq("id", user.id).single().then((r) => (r.error ? sb.from("profiles").select("alias, color").eq("id", user.id).single() : r)), sb.rpc("is_owner")]);
    me = { id: user.id, avatar_url: (data as any)?.avatar_url ?? null, alias: data?.alias ?? "Member", color: /^#[0-9a-f]{6}$/i.test(data?.color || "") ? data!.color : "#6141D4", is_admin: owner === true, mfa: !!user.factors?.some((f) => f.status === "verified") };
  }
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies saved comfort settings before the page paints, so there's no flash of bright colours or motion. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: `try{var d=document.documentElement,l=localStorage;if(l.getItem("calm")==="1")d.dataset.calm="on";if(l.getItem("big")==="1")d.dataset.size="large";d.dataset.theme=l.getItem("theme3")==="dark"?"dark":"light"}catch(e){}` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Wallet connections start faster with these already open. */}
        <link rel="preconnect" href="https://relay.walletconnect.org" crossOrigin="" />
        <link rel="dns-prefetch" href="https://explorer-api.walletconnect.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Unbounded:wght@500;700;800&family=JetBrains+Mono:wght@400;600&display=swap" />
      </head>
      <body>
        {/* Without JavaScript the welcome can't close, so it isn't shown at all. */}
        <noscript><style>{`.welcome{display:none}`}</style></noscript>
        <Welcome />
        {user && needWallet && <WalletGate uid={user.id} />}
        <Shell me={me}>{children}</Shell>
        <BotFab />
      </body>
    </html>
  );
}
