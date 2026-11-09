import CompanionChat from "@/components/CompanionChat";
import { currentUser } from "@/lib/supabase/server";
import { PRIVY_APP_ID, walletMember } from "@/lib/privy-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Believer & Purity · AUTISTIK Hub" };

export default async function CompanionsPage({ searchParams }: { searchParams: { c?: string; welcome?: string } }) {
  const user = await currentUser();
  // The wallet on their account, for the trading bot (paste a coin address).
  const member = user && PRIVY_APP_ID ? await walletMember().catch(() => null) : null;
  const start = searchParams.c === "purity" ? "purity" : searchParams.c === "believer" ? "believer" : undefined;
  return (
    <div className="stack gpt-page">
      <h1 className="sr-only">Chat with Believer or Purity</h1>
      {user && searchParams.welcome && <div className="notice">Your email is confirmed and you&apos;re signed in. Welcome to the Hub!</div>}
      <CompanionChat signedIn={!!user} start={start} appId={PRIVY_APP_ID || null} member={member} />
    </div>
  );
}
