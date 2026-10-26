import Link from "next/link";
import Art from "@/components/Art";
import ProHero from "@/components/ProHero";
import SessionForms from "@/components/SessionForms";
import JoinLive from "@/components/live/JoinLive";
import SendTokens from "@/components/live/SendTokens";
import LiveControls from "@/components/live/LiveControls";
import MemberName from "@/components/members/MemberName";
import { adminState } from "@/lib/admin";
import { isLiveNow, streamOf, type LiveSession } from "@/lib/live";
import { loadProfiles } from "@/lib/members";
import { supabaseServer, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live hub · AUTISTIK Hub" };

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleString("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

export default async function LivePage() {
  const sb = supabaseServer();
  const user = await currentUser();
  const { data } = await sb.from("sessions").select("*").gte("starts_at", new Date(Date.now() - 7 * 86400e3).toISOString()).order("starts_at").limit(60);
  const all = (data || []) as LiveSession[];
  const now = Date.now();
  const live = all.filter((s) => isLiveNow(s, now));
  const upcoming = all.filter((s) => !live.includes(s) && !s.ended && Date.parse(s.starts_at) > now);
  const past = all.filter((s) => !live.includes(s) && !upcoming.includes(s)).reverse().slice(0, 6);

  let admin = false, wallet = false;
  let mine = new Set<string>();
  const joiners: Record<string, string[]> = {};
  let people = new Map<string, Awaited<ReturnType<typeof loadProfiles>>[number]>();
  if (user) {
    const ids = [...live, ...past].map((s) => s.id);
    const [a, { data: w }, { data: j }] = await Promise.all([
      adminState(),
      sb.from("wallets").select("user_id").eq("user_id", user.id).maybeSingle(),
      ids.length ? sb.from("session_joins").select("session_id,user_id").in("session_id", ids).order("joined_at", { ascending: false }).limit(2000) : Promise.resolve({ data: [] as any[] }),
    ]);
    admin = a.admin; wallet = !!w;
    for (const r of (j || []) as any[]) {
      (joiners[r.session_id] ||= []).push(r.user_id);
      if (r.user_id === user.id) mine.add(r.session_id);
    }
    const show = [...new Set(Object.values(joiners).flatMap((x) => x.slice(0, 12)))];
    people = new Map((await loadProfiles(sb, show)).map((p) => [p.id, p]));
  }

  const who = (s: LiveSession) => {
    const list = joiners[s.id] || [];
    if (!user) return null;
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: ".85em" }}>{list.length ? `${list.length} member${list.length > 1 ? "s" : ""} joined with a wallet` : "Be the first to join"}</span>
        {!!list.length && <div className="joiners">{list.slice(0, 12).map((id) => people.get(id) && <MemberName key={id} m={people.get(id)!} avatar />)}</div>}
      </div>
    );
  };

  return (
    <div className="stack">
      <ProHero tone="coral" kicker="AUTISTIK · LIVE HUB" title="Live with the team" live={live.length ? "On now" : false}
        text="The team hosts live sessions here: X Spaces, YouTube streams, AMAs and Q&As. Connect your wallet when you join, so airdrops for the session reach you."
        stats={[[live.length, "live now"], [upcoming.length, "coming up"], ["Wallet", "airdrops"]]} />

      <div className="steps-card card">
        <div><b>1</b><span>Sign in. You get your own meme name.</span></div>
        <div><b>2</b><span>Connect your wallet once. You sign a free message, no funds move.</span></div>
        <div><b>3</b><span>Join the session. Team airdrops go straight to your wallet.</span></div>
      </div>

      <section className="stack">
        <h2>{live.length ? "Live now" : "Live now"}</h2>
        {!live.length && <div className="empty">Nothing live right now. {upcoming.length ? "The next session is below." : "Follow the team on the Members page so you see when they go live."}</div>}
        {live.map((s) => (
          <div key={s.id} className="card live-card stack">
            <div className="live-top">
              <div className="thumb" style={{ position: "relative" }}><Art kind="session" type={s.kind} className="art" style={{ position: "absolute", inset: 0 }} /><span className="live-dot">LIVE</span></div>
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><span className="badge v">{s.kind}</span><span className="muted" style={{ fontSize: ".85em" }}>{streamOf(s.join_link).label}</span></div>
                <h3>{s.title}</h3>
                <span className="muted" style={{ fontSize: ".9em" }}>Started {when(s.starts_at)} · Host: {s.host || "AUTISTIK team"}</span>
                {s.description && <p>{s.description}</p>}
              </div>
            </div>
            <JoinLive sessionId={s.id} link={s.join_link} uid={user?.id ?? null} wallet={wallet} joined={mine.has(s.id)} live />
            {who(s)}
            {mine.has(s.id) && <SendTokens sessionId={s.id} />}
            {admin && <LiveControls id={s.id} live ended={!!s.ended} />}
          </div>
        ))}
      </section>

      <section className="stack">
        <h2>Coming up</h2>
        {!upcoming.length && <div className="empty">{admin ? "No sessions scheduled. Add one with the form below." : "No sessions scheduled yet. Check back soon."}</div>}
        <div className="live-grid">
          {upcoming.map((s) => (
            <div key={s.id} className="card stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6, justifyContent: "space-between" }}><span className="badge v">{s.kind}</span><span className="badge gold">{when(s.starts_at)}</span></div>
              <h3>{s.title}</h3>
              <span className="muted" style={{ fontSize: ".9em" }}>Host: {s.host || "AUTISTIK team"} · {streamOf(s.join_link).label}</span>
              {s.description && <p style={{ fontSize: ".92em" }}>{s.description}</p>}
              {user && !wallet && <span className="muted" style={{ fontSize: ".85em" }}>Tip: <Link href="/rewards">connect your wallet</Link> now, so joining takes one tap.</span>}
              {admin && <LiveControls id={s.id} live={false} ended={false} />}
            </div>
          ))}
        </div>
      </section>

      {!!past.length && (
        <section className="stack">
          <h2>Recently ended</h2>
          <div className="live-grid">
            {past.map((s) => (
              <div key={s.id} className="card stack" style={{ gap: 4 }}>
                <span className="muted" style={{ fontSize: ".85em" }}>{when(s.starts_at)}</span>
                <h3>{s.title}</h3>
                {who(s)}
                {admin && <LiveControls id={s.id} live={false} ended={!!s.ended} />}
              </div>
            ))}
          </div>
        </section>
      )}

      {admin && <SessionForms signedIn admin />}
      {admin && <div className="notice">To airdrop to everyone who joined a session, open <Link href="/admin#airdrop">Admin → Send an airdrop</Link>.</div>}
    </div>
  );
}
