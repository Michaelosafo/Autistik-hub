"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import FollowButton from "@/components/members/FollowButton";

type Person = { id: string; alias: string; handle: string | null; color: string; avatar_url: string | null; is_team: boolean; is_verified: boolean; following: boolean; followsYou: boolean };

/**
 * "Find people" in your panel: one button opens a search by name or @handle with Follow right there. Before you
 * type, it lists the people who follow you that you haven't followed back.
 */
export default function FindPeople() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [back, setBack] = useState(0);
  const seq = useRef(0);

  // How many people to follow back, for the button's badge.
  useEffect(() => {
    fetch("/api/me/people", { cache: "no-store" }).then((r) => r.json()).then((d) => setBack(d.toFollowBack || 0)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    setPeople(null);
    const t = setTimeout(() => {
      fetch(`/api/me/people?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" }).then((r) => r.json())
        .then((d) => { if (id !== seq.current) return; setPeople(d.people || []); if (!q.trim()) setBack(d.toFollowBack || 0); })
        .catch(() => id === seq.current && setPeople([]));
    }, q.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  if (!open) {
    return (
      <button type="button" className="fp-open" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="10" cy="8" r="4" /><path d="M2.5 20c.8-3.6 3.8-6 7.5-6 1.6 0 3 .4 4.2 1.2" /><circle cx="17.5" cy="16.5" r="3.2" /><path d="M20 19l2 2" /></svg>
        <span>Find people to follow</span>
        {back > 0 && <em>{back} to follow back</em>}
      </button>
    );
  }
  const typed = !!q.trim();
  return (
    <section className="mp-sec fp" aria-label="Find people">
      <div className="mp-sec-h"><b>Find people</b><button type="button" className="fp-x" onClick={() => { setOpen(false); setQ(""); }}>Close</button></div>
      <label className="fp-q">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or @handle" spellCheck={false} autoComplete="off" aria-label="Search people by name or handle" />
      </label>
      {!typed && <small className="mp-dim">{back ? "These people follow you. Follow them back:" : "Type a name to find someone and follow them."}</small>}
      {people === null ? <small className="mp-dim">Searching…</small>
        : !people.length ? (typed ? <small className="mp-dim">No one found with that name.</small> : null)
        : people.map((p) => (
          <div key={p.id} className="mp-person">
            <Link href={`/members/${p.id}`} className="mp-person-l">
              <Avatar className="me-av" alias={p.alias} color={p.color} url={p.avatar_url} />
              <span className="mp-link-t">
                <b>{p.alias}{p.is_verified && <span className="mp-tick" title="Verified">✓</span>}</b>
                <small>{[p.handle ? `@${p.handle}` : "", p.followsYou ? "Follows you" : "", p.is_team ? "AUTISTIK team" : ""].filter(Boolean).join(" · ") || "Member"}</small>
              </span>
            </Link>
            <FollowButton id={p.id} initial={p.following} small back={p.followsYou}
              onChange={(on) => p.followsYou && setBack((b) => Math.max(0, b + (on ? -1 : 1)))} />
          </div>
        ))}
      <Link href="/members?tab=find" className="fp-more">See all members</Link>
    </section>
  );
}
