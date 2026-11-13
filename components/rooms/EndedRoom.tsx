"use client";
import Link from "next/link";
import { useEffect } from "react";
import LiveChat from "./LiveChat";
import { forgetLive } from "./LiveRoom";
import LiveSummary, { type Summary } from "./LiveSummary";

type Rec = { id: string; url: string; duration_s: number; title: string };
const len = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** A live that has ended: the summary (who joined, comments, tokens sent), its recording, and the comments. */
export default function EndedRoom({ room, host, recs, me, summary }: {
  room: { id: string; title: string; created_at: string; ended_at: string; visibility?: string };
  host: string; recs: Rec[]; summary?: Summary | null;
  me: { id: string; alias: string; color: string | null; avatar_url: string | null } | null;
}) {
  useEffect(() => { forgetLive(room.id); }, [room.id]);
  const mins = Math.max(1, Math.round((Date.parse(room.ended_at) - Date.parse(room.created_at)) / 60000));
  const when = new Date(room.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="lv stack">
      <div className="lv-top">
        <span className="room-ended">Ended</span>
        <h1>{room.title}</h1>
        <small className="muted">Hosted by {host} · {when} · {mins} min</small>
      </div>
      {summary && <LiveSummary s={summary} mins={mins} isPrivate={room.visibility === "private"} />}
      {recs.length ? recs.map((r) => (
        <section key={r.id} className="card stack rec-box">
          <b>🎙️ Recording · {len(r.duration_s)}</b>
          <audio controls preload="none" src={r.url} style={{ width: "100%" }} />
          <div className="row" style={{ gap: 6 }}>
            <a className="btn small" href={`${r.url}?download=${encodeURIComponent(`${room.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "live"}.${r.url.endsWith(".m4a") ? "m4a" : "webm"}`)}`}>⬇️ Save on my device</a>
          </div>
        </section>
      )) : <div className="empty">This live wasn&apos;t recorded.</div>}
      <LiveChat roomId={room.id} me={me} readOnly />
      <Link className="btn primary" href="/spaces" style={{ alignSelf: "flex-start" }}>See live and past lives</Link>
    </div>
  );
}
