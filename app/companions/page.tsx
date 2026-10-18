import CompanionChat from "@/components/CompanionChat";
import SectionCards, { COMMUNITY_CARDS } from "@/components/SectionCards";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Believer & Purity · AUTISTIK Hub" };

export default async function CompanionsPage({ searchParams }: { searchParams: { c?: string; welcome?: string } }) {
  const user = await currentUser();
  const start = searchParams.c === "purity" ? "purity" : searchParams.c === "believer" ? "believer" : undefined;
  return (
    <div className="stack">
      <SectionCards items={COMMUNITY_CARDS} active="/companions" label="Chat and community" />
      <h1 className="sr-only">Chat with Believer or Purity</h1>
      {user && searchParams.welcome && <div className="notice">Your email is confirmed and you&apos;re signed in. Welcome to the Hub!</div>}
      <CompanionChat signedIn={!!user} start={start} />
    </div>
  );
}
