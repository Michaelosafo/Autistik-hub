"use client";
/**
 * TIK Home: the whole AUTISTIK ecosystem on one screen. News from AUTISTIK (admins post it here), everything happening
 * across the site, tokens people are looking at, tokens with a clean safety scan, and people to follow.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import FollowButton from "@/components/members/FollowButton";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ago } from "@/lib/mood";

type Who = { id: string; alias: string; color: string; avatar_url: string | null; v: boolean; vb: number | null };
type Hub = {
  news: { id: string; title: string; body: string | null; url: string | null; pinned: boolean; created_at: string }[];
  activity: { kind: string; at: string; who: Who | null; text: string; href: string }[];
  watching: { chain: string; token: string; name: string | null; symbol: string | null; logo: string | null; viewers: number; clean: boolean | null; href: string }[];
  clean: { chain: string; token: string; name: string; symbol: string; logo: string | null; holders: number; href: string }[];
  people: (Who & { handle: string | null; why: string })[];
};
const ICON: Record<string, string> = { launch: "🚀", live: "🔴", "live-ended": "🎙️", recording: "📼", drop: "🎁", tik: "💬", joined: "👋" };
const LABEL: Record<string, string> = { launch: "Launch", live: "Live", "live-ended": "Ended", recording: "Replay", drop: "Drop", tik: "Tik", joined: "New" };
const FILTERS: [string, string][] = [["all", "All"], ["launch", "Launches"], ["live", "Lives"], ["tik", "Tiks"], ["joined", "New people"]];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Coin({ logo, symbol }: { logo: string | null; symbol: string | null }) {
  return logo ? <img className="th-coin-l" src={logo} alt="" loading="lazy" /> : <span className="th-coin-l">{(symbol || "?").slice(0, 2)}</span>;
}

export default function TikHome({ admin }: { admin?: boolean }) {
  const [hub, setHub] = useState<Hub | null>(null);
  const [err, setErr] = useState(false);
  const [f, setF] = useState("all");
  const [k, setK] = useState(0);
  useEffect(() => {
    fetch("/api/tik/hub").then((r) => r.json()).then(setHub).catch(() => setErr(true));
    const t = setInterval(() => fetch("/api/tik/hub").then((r) => r.json()).then(setHub).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [k]);

  if (err && !hub) return <div className="card"><small className="muted">Couldn&apos;t load TIK Home. Pull to refresh or try again in a moment.</small></div>;
  if (!hub) return <div className="th"><div className="th-skel" /><div className="th-skel" /><div className="th-skel short" /></div>;
  const acts = hub.activity.filter((a) => f === "all" || a.kind === f || (f === "live" && ["live-ended", "recording", "drop"].includes(a.kind)));

  return (
    <div className="th">
      {/* News */}
      <section className="th-card th-news" aria-labelledby="th-news">
        <div className="th-h"><b id="th-news">📣 AUTISTIK news</b></div>
        {admin && <NewsComposer onPosted={() => setK((n) => n + 1)} />}
        {hub.news.length === 0 ? <small className="th-dim">No news yet.</small> : hub.news.map((n) => (
          <article key={n.id} className={"th-n" + (n.pinned ? " pin" : "")}>
            <div className="th-n-t"><b>{n.pinned && "📌 "}{n.title}</b><small>{ago(n.created_at)}</small></div>
            {n.body && <p>{n.body}</p>}
            <div className="th-n-a">
              {n.url && (n.url.startsWith("/") ? <Link href={n.url}>Open →</Link> : <a href={n.url} target="_blank" rel="noopener noreferrer">Open →</a>)}
              {admin && <NewsAdmin id={n.id} pinned={n.pinned} onDone={() => setK((x) => x + 1)} />}
            </div>
          </article>
        ))}
      </section>

      <div className="th-grid">
        {/* Activity */}
        <section className="th-card th-act" aria-labelledby="th-act">
          <div className="th-h"><b id="th-act"><i className="th-dot" aria-hidden="true" />Happening now</b></div>
          <div className="th-chips" role="tablist" aria-label="Filter activity">
            {FILTERS.map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={f === id} onClick={() => setF(id)}>{l}</button>)}
          </div>
          {acts.length === 0 ? <small className="th-dim">Nothing here yet.</small> : acts.map((a, i) => (
            <Link key={i} href={a.href} className={"th-a k-" + a.kind} style={{ ["--ac" as any]: a.who?.color || "#F0B90B" }}>
              <span className="th-a-av">
                {a.who ? <Avatar className="avatar th-av" alias={a.who.alias} color={a.who.color} url={a.who.avatar_url} /> : <span className="th-av th-av-sys">A</span>}
                <i aria-hidden="true">{ICON[a.kind] || "✨"}</i>
              </span>
              <span className="th-a-t">
                <span className="th-a-h">
                  <b>{a.who ? a.who.alias : "AUTISTIK"}{a.who?.v && <VerifiedBadge n={a.who.vb} size={13} className="vbadge-name" />}</b>
                  <span className="th-a-sep" aria-hidden="true">·</span>
                  <small>{ago(a.at)}</small>
                  <em>{LABEL[a.kind] || "New"}</em>
                </span>
                <span className="th-a-x">{a.text}</span>
              </span>
            </Link>
          ))}
        </section>

        <div className="th-side">
          {/* Tokens people are looking at */}
          <section className="th-card" aria-labelledby="th-watch">
            <div className="th-h"><b id="th-watch">👀 People are looking at</b><small>3 days</small></div>
            {hub.watching.length === 0 ? <small className="th-dim">Nothing yet. Scan a coin and it shows here.</small> : hub.watching.map((t) => (
              <Link key={t.chain + t.token} href={t.href} className="th-coin">
                <Coin logo={t.logo} symbol={t.symbol} />
                <span className="th-coin-t"><b>{t.symbol ? `$${t.symbol}` : short(t.token)}</b><small>{t.name || t.chain} · {t.viewers} {t.viewers === 1 ? "viewer" : "viewers"}</small></span>
                {t.clean === true && <em className="th-ok" title="Clean safety scan">✓ Clean</em>}
              </Link>
            ))}
          </section>

          {/* Clean scans */}
          <section className="th-card" aria-labelledby="th-clean">
            <div className="th-h"><b id="th-clean">🛡️ Clean scans</b><Link href="/analytics">Scan one</Link></div>
            <small className="th-dim">No honeypot, low tax, open source, no hidden owner or mint. A clean scan isn&apos;t a promise: always do your own research.</small>
            {hub.clean.length === 0 ? <small className="th-dim">None this week.</small> : hub.clean.map((t) => (
              <Link key={t.chain + t.token} href={t.href} className="th-coin">
                <Coin logo={t.logo} symbol={t.symbol} />
                <span className="th-coin-t"><b>${t.symbol}</b><small>{t.name} · {t.holders.toLocaleString("en-US")} holders</small></span>
                <em className="th-ok">✓</em>
              </Link>
            ))}
          </section>

          {/* People to follow */}
          <section className="th-card" aria-labelledby="th-people">
            <div className="th-h"><b id="th-people">✨ People to follow</b><Link href="/members?tab=find">More</Link></div>
            {hub.people.length === 0 ? <small className="th-dim">You follow everyone we&apos;d suggest. 🎉</small> : hub.people.map((p) => (
              <div key={p.id} className="th-p">
                <Link href={`/members/${p.id}`} className="th-p-l">
                  <Avatar className="avatar th-av" alias={p.alias} color={p.color} url={p.avatar_url} />
                  <span className="th-coin-t"><b>{p.alias}{p.v && <VerifiedBadge n={p.vb} size={13} className="vbadge-name" />}</b><small>{p.why}</small></span>
                </Link>
                <FollowButton id={p.id} initial={false} small />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Admins post AUTISTIK news straight onto TIK Home. */
function NewsComposer({ onPosted }: { onPosted: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [pin, setPin] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function post(e: React.FormEvent) {
    e.preventDefault();
    const u = url.trim();
    if (title.trim().length < 3) { setMsg("Add a headline."); return; }
    if (u && !/^(https:\/\/|\/)/.test(u)) { setMsg("Links must start with https:// or /"); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    if (pin) await sb.from("tik_news").update({ pinned: false }).eq("pinned", true);
    const { error } = await sb.from("tik_news").insert({ title: title.trim().slice(0, 120), body: body.trim().slice(0, 600) || null, url: u || null, pinned: pin });
    setBusy(false);
    if (error) { setMsg("Couldn't post. Only admins can post news."); return; }
    setTitle(""); setBody(""); setUrl(""); setPin(false); setOpen(false); onPosted();
  }
  if (!open) return <button type="button" className="btn small th-post" onClick={() => setOpen(true)}>＋ Post news (admin)</button>;
  return (
    <form className="th-form" onSubmit={post}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Headline" aria-label="Headline" />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={600} placeholder="Details (optional)" aria-label="Details" rows={3} />
      <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={300} placeholder="Link (optional): https://… or /launchpad/…" aria-label="Link" />
      <label className="row" style={{ gap: 6, alignItems: "center" }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> <small>Pin to the top</small></label>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={busy} type="submit">{busy ? "Posting…" : "Post news"}</button>
        <button className="btn small" type="button" onClick={() => setOpen(false)}>Cancel</button>
        {msg && <small className="muted" role="status">{msg}</small>}
      </div>
    </form>
  );
}

function NewsAdmin({ id, pinned, onDone }: { id: string; pinned: boolean; onDone: () => void }) {
  const sb = supabaseBrowser();
  return (
    <span className="th-n-adm">
      <button type="button" className="linkish" onClick={async () => { if (!pinned) await sb.from("tik_news").update({ pinned: false }).eq("pinned", true); await sb.from("tik_news").update({ pinned: !pinned }).eq("id", id); onDone(); }}>{pinned ? "Unpin" : "Pin"}</button>
      <button type="button" className="linkish" onClick={async () => { if (confirm("Delete this news post?")) { await sb.from("tik_news").delete().eq("id", id); onDone(); } }}>Delete</button>
    </span>
  );
}
