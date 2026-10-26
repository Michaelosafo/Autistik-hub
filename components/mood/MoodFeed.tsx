"use client";
import Link from "next/link";
import { useState } from "react";
import TikComposer from "./TikComposer";
import TikCard from "./TikCard";
import { useTiks } from "./useMood";

/** Autistik Mood: write how you feel, and see everyone's Tiks with likes and replies. */
export default function MoodFeed({ limit = 20, compact, more: moreLink }: { limit?: number; compact?: boolean; more?: boolean }) {
  const [k, setK] = useState(0);
  const { tiks, setTiks, me, more, loadMore, err } = useTiks({ limit, refreshKey: k });
  return (
    <div className={"mood-feed" + (compact ? " compact" : "")}>
      {me ? <TikComposer compact={compact} onPosted={() => setK((n) => n + 1)} /> : tiks !== null && (
        <p className="muted" style={{ margin: 0 }}><Link href="/login?next=/mood">Sign in</Link> to share how you feel and see everyone&apos;s Tiks.</p>
      )}
      {err && <small className="muted">{err}</small>}
      {tiks === null ? <small className="muted">Loading Tiks…</small> : !tiks.length ? (
        me ? <p className="muted" style={{ margin: 0 }}>No Tiks yet. Be the first to share how you feel.</p> : null
      ) : tiks.map((t) => <TikCard key={t.id} t={t} me={me} compact={compact} onRemoved={(id) => setTiks((x) => x?.filter((y) => y.id !== id) ?? null)} />)}
      {moreLink ? <Link href="/mood" className="mood-more">View more on Autistik Mood</Link>
        : more && <button type="button" className="tik-more" onClick={loadMore}>Load more</button>}
    </div>
  );
}
