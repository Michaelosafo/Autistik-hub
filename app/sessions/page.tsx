import { adminState } from "@/lib/admin";
import SessionCard from "@/components/SessionCard";
import SessionForms from "@/components/SessionForms";
import SectionCards, { COMMUNITY_CARDS } from "@/components/SectionCards";
import ProHero from "@/components/ProHero";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live sessions · AUTISTIK Hub" };

export default async function SessionsPage() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: sessions } = await sb.from("sessions").select("*").gte("starts_at", new Date(Date.now() - 3 * 3600e3).toISOString()).order("starts_at");
  let seats: Record<string, number> = {};
  let admin = false;
  if (user) {
    const { data } = await sb.from("rsvps").select("session_id");
    for (const r of data || []) seats[r.session_id] = (seats[r.session_id] || 0) + 1;
    admin = (await adminState()).admin;
  }
  return (
    <div className="stack">
      <SectionCards items={COMMUNITY_CARDS} active="/sessions" label="Chat and community" />
      <ProHero tone="coral" kicker="AUTISTIK · LIVE SESSIONS" title="Talks, Q&amp;As and support circles" live={sessions?.some((s: any) => new Date(s.starts_at).getTime() <= Date.now()) ? "On now" : false}
        text="Hosted by practitioners the AUTISTIK team has checked. Save your seat to earn participation points."
        stats={[[sessions?.length ?? 0, "coming up"], ["Checked", "hosts"], ["+ points", "for every seat"]]} />
      {!sessions?.length && <div className="empty">{admin ? "No sessions yet. Add the first one with the form below." : "No sessions scheduled yet. Check back soon."}</div>}
      {sessions?.map((s) => <SessionCard key={s.id} s={s} seats={user ? seats[s.id] || 0 : undefined} admin={admin} />)}
      <SessionForms signedIn={!!user} admin={admin} />
    </div>
  );
}
