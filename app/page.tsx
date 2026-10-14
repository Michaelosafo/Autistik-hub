import Link from "next/link";
import Art from "@/components/Art";
import Battery from "@/components/Battery";
import SessionCard from "@/components/SessionCard";
import { GROUPS, CHANNELS } from "@/lib/groups";
import { COMPANIONS } from "@/lib/companions";
import { PHOTOS } from "@/lib/site";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TICKER = ["Not a disease", "A community", "Different, not less", "Nothing about us without us", "Every mind on the spectrum", "Not broken", "Neurodiversity is strength", "Autistic and proud"];
const FACES: [string, string, string][] = [["artist", "Artists", "#6141D4"], ["coder", "Coders", "#0B857A"], ["gamer", "Gamers", "#D9472F"], ["advocate", "Advocates", "#B97F00"], ["reader", "Readers", "#2F6FB5"], ["gardener", "Gardeners", "#3F7F2F"]];

export default async function Home() {
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  const { data: sessions } = await sb.from("sessions").select("*").gte("starts_at", new Date(Date.now() - 3 * 3600e3).toISOString()).order("starts_at").limit(1);
  let recent: any[] = [];
  let points: any = null;
  let counts: Record<string, number> = {};
  if (user) {
    const { data } = await sb.from("posts").select("id,channel,body,content_note,created_at,author:profiles(alias)").is("content_note", null).order("created_at", { ascending: false }).limit(3);
    recent = data || [];
    const { data: pts } = await sb.from("member_points").select("*").eq("user_id", user.id).single();
    points = pts;
    const { data: gm } = await sb.from("group_members").select("group_id");
    for (const r of gm || []) counts[r.group_id] = (counts[r.group_id] || 0) + 1;
  }
  const ticker = [...TICKER, ...TICKER];

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <div className="hero">
          <div className="hero-copy">
            <div className="eyebrow">Autism awareness × Web3 community</div>
            <h1>Autism is not a disease. <span className="grad">It&apos;s a community.</span></h1>
            <p>Autistic minds aren&apos;t broken and don&apos;t need a cure. They need understanding, connection and a place to belong. Here you&apos;ll find four groups, two AI companions called Believer and Purity, live talks with practitioners, and airdrops for the people who show up.</p>
            <div className="row">
              <Link className="btn primary" href={user ? "/community" : "/login"}>{user ? "Join a group" : "Join the Hub"}</Link>
              <Link className="btn ghost" href="/companions">Meet Believer &amp; Purity</Link>
            </div>
          </div>
          <div className="hero-art"><Art kind="hero" photo={PHOTOS.hero.src} alt={PHOTOS.hero.alt} /></div>
        </div>
        <div className="ticker" aria-hidden="true"><div>{ticker.map((t, i) => <span key={i}><i>∞</i> {t.toUpperCase()}</span>)}</div></div>
      </div>

      <div className="truths">
        <div className="truth" data-g="lounge"><b>Not a disease</b><p>Autism is a lifelong neurological difference in how a brain senses, thinks and communicates. There&apos;s nothing to catch and nothing to cure.</p></div>
        <div className="truth" data-g="calm"><b>A spectrum, not a scale</b><p>Every autistic person has a different mix of strengths and support needs. &quot;Mild&quot; and &quot;severe&quot; don&apos;t tell the story.</p></div>
        <div className="truth" data-g="spark"><b>Nothing about us without us</b><p>Autistic people lead here. Supporters, families and practitioners join in to listen and help.</p></div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="section-head"><div><div className="label">AI companions</div><h2 style={{ marginTop: 4 }}>Pick who you want to talk to</h2></div><Link className="btn small" href="/companions">Open chat</Link></div>
        <div className="comp-grid">
          {Object.values(COMPANIONS).map((c) => (
            <div key={c.id} className="comp" data-c={c.id}>
              <Art kind={c.id} className="av" />
              <div style={{ minWidth: 0 }}>
                <h2>{c.name}</h2><div className="tagline">{c.tagline}</div>
                <div className="traits">{c.traits.map((t) => <span key={t}>{t}</span>)}</div>
                <div className="row"><Link className="btn c small" href={`/companions?c=${c.id}`}>Talk to {c.name}</Link></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="section-head"><div><div className="label">Community</div><h2 style={{ marginTop: 4 }}>Find your group</h2></div><Link className="btn small" href="/community">Open community</Link></div>
        <div className="groups-grid">
          {GROUPS.map((g) => (
            <div key={g.id} className="gcard" data-g={g.id}>
              <Art kind="group" id={g.id} photo={PHOTOS[g.id]?.src} alt={PHOTOS[g.id]?.alt} />
              <div className="gbody">
                <div><div className="tag">{g.tag}</div><h3 style={{ marginTop: 3 }}>{g.name}</h3></div>
                <p className="muted" style={{ fontSize: ".9em" }}>{g.desc}</p>
                <ul>{g.channels.map((c) => <li key={c.id}><span style={{ color: "var(--g)", fontWeight: 700 }}># </span>{c.title}</li>)}</ul>
                <div className="row">
                  <span className="muted" style={{ fontSize: ".84em" }}>{counts[g.id] ? `${counts[g.id]} member${counts[g.id] > 1 ? "s" : ""}` : "New group"}</span>
                  <Link className="btn g small" href={`/community?g=${g.id}`}>Open</Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div><div className="label">Faces of the spectrum</div><h2 style={{ marginTop: 4 }}>Autistic people are everywhere</h2><p className="muted" style={{ marginTop: 4, maxWidth: "62ch" }}>Artists, coders, gamers, advocates, readers, gardeners. Autism looks different on everyone, and there&apos;s no one way to &quot;look autistic&quot;.</p></div>
        <div className="gallery">
          {FACES.map(([k, label, bg]) => (
            <div key={k} className="face"><Art kind="portrait" person={k} bg={bg} /><b>{label}</b><span>and autistic</span></div>
          ))}
        </div>
      </div>

      <div className="hello">
        <Battery />
        <div className="card stack points-card">
          <div className="label">Your participation</div>
          {user ? (
            <>
              <div className="row" style={{ gap: 28 }}>
                <div className="stat"><b>{points?.points ?? 0}</b><span className="muted">points</span></div>
                <div className="stat"><b>{points?.posts ?? 0}</b><span className="muted">posts</span></div>
                <div className="stat"><b>{points?.sessions ?? 0}</b><span className="muted">sessions</span></div>
              </div>
              <div className="meter"><i style={{ width: `${Math.min(100, ((points?.points ?? 0) / 50) * 100)}%` }} /></div>
              <Link href="/rewards" className="muted" style={{ fontSize: ".9em" }}>See rewards and link your wallet</Link>
            </>
          ) : (
            <p className="muted">Join the Hub to earn points toward $AUTISTIK airdrops. <Link href="/login">Sign in</Link></p>
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Next live session</h2><Link className="btn small" href="/sessions">All sessions</Link></div>
          {sessions?.[0] ? <SessionCard s={sessions[0]} compact /> : <div className="empty">No sessions scheduled yet.</div>}
        </div>
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}><h2>Latest in the groups</h2><Link className="btn small" href="/community">See all</Link></div>
          {!user && <div className="empty">Sign in to read the groups.</div>}
          {user && !recent.length && <div className="empty">No posts yet. Say hello in Spectrum Lounge › introductions.</div>}
          {recent.map((p) => {
            const c = CHANNELS[p.channel];
            return (
              <div key={p.id} data-g={c?.group.id}>
                <div className="post-head"><b>{p.author?.alias || "Member"}</b><span className="where">{c ? `${c.group.name} › #${c.name}` : ""}</span></div>
                <p className="post-text">{p.body.length > 140 ? p.body.slice(0, 140) + "…" : p.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
