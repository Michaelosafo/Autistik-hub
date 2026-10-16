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
        <div className="label">AI companions</div>
        <h1>Talk with Believer or Purity</h1>
        <p className="muted">Believer helps you plan and keep going; Purity helps you slow down when things feel like too much. Type, or tap 🎤 to send a voice note. 15 free messages a day. They&apos;re AIs, not doctors or therapists.</p>
      </div>
      {user && searchParams.welcome && <div className="notice">Your email is confirmed and you&apos;re signed in. Welcome to the Hub! Say hello to Believer or Purity below.</div>}
      <CompanionChat signedIn={!!user} start={start} />
    </div>
  );
}
