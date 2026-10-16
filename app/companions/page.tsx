import CompanionChat from "@/components/CompanionChat";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Believer & Purity · AUTISTIK Hub" };

export default async function CompanionsPage({ searchParams }: { searchParams: { c?: string; welcome?: string } }) {
  const user = await currentUser();
  const start = searchParams.c === "purity" ? "purity" : searchParams.c === "believer" ? "believer" : undefined;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Chat</h1>
        <p className="muted">Type or tap 🎤. 5 free messages a day.</p>
      </div>
      {user && searchParams.welcome && <div className="notice">Your email is confirmed and you&apos;re signed in. Welcome to the Hub!</div>}
      <CompanionChat signedIn={!!user} start={start} />
    </div>
  );
}
