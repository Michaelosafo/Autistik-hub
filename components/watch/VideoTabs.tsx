"use client";
/** The Videos, Fun and Livestreams tabs on TIK. */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { fmtCount, fmtDur, playerUrl, thumbUrl, playUid, videosOn } from "@/lib/stream-shared";
import { ago, listVideos, withAuthors, type VideoRow } from "./data";
import UploadVideo from "./UploadVideo";

function Soon() {
  return <div className="card wv-soon"><b>Videos are coming soon</b><p className="muted">Uploads, fun clips and live video streams are almost ready.</p></div>;
}

/** A thumbnail card in the Videos grid. */
function Card({ v }: { v: VideoRow }) {
  const uid = playUid(v);
  return (
    <Link href={`/watch/${v.id}`} className="wv-card">
      <span className="wv-thumb">
        {uid ? <img src={thumbUrl(uid)} alt="" loading="lazy" /> : null}
        {v.kind === "stream" && v.status === "live" ? <em className="wv-live">LIVE</em> : v.duration ? <em>{fmtDur(v.duration)}</em> : null}
      </span>
      <span className="wv-meta">
        {v.author && <Avatar className="me-av wv-av" alias={v.author.alias} color={v.author.color} url={v.author.avatar_url} />}
        <span><b>{v.title}</b><small>{v.author?.alias || "Member"} · {fmtCount(v.views)} views · {ago(v.started_at || v.created_at)}</small></span>
      </span>
    </Link>
  );
}

export function VideosTab({ signedIn }: { signedIn: boolean }) {
  const [list, setList] = useState<VideoRow[] | null>(null);
  const [up, setUp] = useState(false);
  useEffect(() => { if (videosOn()) listVideos("video", { limit: 36 }).then(setList).catch(() => setList([])); }, [up]);
  if (!videosOn()) return <Soon />;
  return (
    <section className="stack" aria-label="Videos">
      <div className="wv-head"><b>Videos</b>{signedIn ? <button type="button" className="btn primary small" onClick={() => setUp(true)}>＋ Upload</button> : <Link className="btn small" href="/login?next=/mood?tab=videos">Sign in to upload</Link>}</div>
      {list === null ? <small className="muted">Loading…</small> : list.length === 0 ? <div className="card muted">No videos yet. Be the first to upload one.</div> : (
        <div className="wv-grid">{list.map((v) => <Card key={v.id} v={v} />)}</div>
      )}
      {up && <UploadVideo kind="video" onClose={() => setUp(false)} />}
    </section>
  );
}

/** Short clips, one per screen: the one in view plays (muted until tapped), the rest wait as pictures. */
export function FunTab({ signedIn }: { signedIn: boolean }) {
  const [list, setList] = useState<VideoRow[] | null>(null);
  const [up, setUp] = useState(false);
  const [on, setOn] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (videosOn()) listVideos("fun", { limit: 40 }).then(setList).catch(() => setList([])); }, [up]);
  useEffect(() => {
    if (!list?.length || !box.current) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && e.intersectionRatio > 0.6) setOn((e.target as HTMLElement).dataset.id || null); }), { threshold: [0.6] });
    box.current.querySelectorAll("[data-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [list]);
  if (!videosOn()) return <Soon />;
  return (
    <section className="stack" aria-label="Fun clips">
      <div className="wv-head"><b>Fun</b>{signedIn ? <button type="button" className="btn primary small" onClick={() => setUp(true)}>＋ Post a clip</button> : <Link className="btn small" href="/login?next=/mood?tab=fun">Sign in to post</Link>}</div>
      {list === null ? <small className="muted">Loading…</small> : list.length === 0 ? <div className="card muted">No clips yet. Post the first one: up to 90 seconds.</div> : (
        <div className="wv-fun" ref={box}>
          {list.map((v) => (
            <article key={v.id} className="wv-clip" data-id={v.id}>
              <div className="wv-clip-v">
                {on === v.id && v.cf_uid
                  ? <iframe src={playerUrl(v.cf_uid, { autoplay: true, muted: true, loop: true })} title={v.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
                  : v.cf_uid ? <img src={thumbUrl(v.cf_uid, 640)} alt="" loading="lazy" /> : null}
              </div>
              <div className="wv-clip-t">
                <Link href={`/watch/${v.id}`}><b>{v.title}</b></Link>
                <small>{v.author?.alias || "Member"} · ♥ {fmtCount(v.likes)} · 💬 {fmtCount(v.comments)}</small>
              </div>
            </article>
          ))}
        </div>
      )}
      {up && <UploadVideo kind="fun" onClose={() => setUp(false)} />}
    </section>
  );
}

export function StreamsTab({ signedIn }: { signedIn: boolean }) {
  const [live, setLive] = useState<VideoRow[] | null>(null);
  const [past, setPast] = useState<VideoRow[] | null>(null);
  useEffect(() => {
    if (!videosOn()) return;
    const load = () => fetch("/api/videos/live").then((r) => r.json()).then((d) => withAuthors((d.live || []).map((v: any) => ({ ...v, kind: "stream" })))).then(setLive).catch(() => setLive([]));
    load();
    listVideos("stream", { status: ["ended"], limit: 24 }).then((l) => setPast(l.filter((v) => v.rec_uid))).catch(() => setPast([]));
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  if (!videosOn()) return <Soon />;
  return (
    <section className="stack" aria-label="Livestreams">
      <div className="wv-head"><b><i className="wv-dot" aria-hidden="true" />Live now</b>{signedIn ? <Link className="btn primary small" href="/watch/live">🎥 Go live</Link> : <Link className="btn small" href="/login?next=/watch/live">Sign in to go live</Link>}</div>
      {live === null ? <small className="muted">Loading…</small> : live.length === 0 ? <div className="card muted">Nobody is streaming right now. Start one: camera or screen, straight from your browser.</div> : (
        <div className="wv-grid">{live.map((v) => <Card key={v.id} v={v} />)}</div>
      )}
      <div className="wv-head"><b>Past streams</b></div>
      {past === null ? <small className="muted">Loading…</small> : past.length === 0 ? <div className="card muted">Finished streams are saved here.</div> : (
        <div className="wv-grid">{past.map((v) => <Card key={v.id} v={v} />)}</div>
      )}
    </section>
  );
}
