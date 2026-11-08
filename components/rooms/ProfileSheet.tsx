"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import VerifiedBadge from "@/components/VerifiedBadge";
import { supabaseBrowser } from "@/lib/supabase/client";

type Card = {
  id: string; alias: string; handle: string | null; color: string | null; avatar_url: string | null; is_verified: boolean; verified_badge?: number | null; is_team: boolean; team_title: string | null;
  followers: number; following: number; iFollow: boolean; me: boolean;
  posts: { id: string; body: string; image_url: string | null; created_at: string }[];
  launched: { chain: string; token: string; symbol: string; name: string }[];
  watching: { chain: string; token: string; symbol: string | null }[]; watchShared: boolean;
};
export type SheetActions = {
  role: "host" | "cohost" | "speaker" | "listener";
  canRun: boolean; isHost: boolean; muted?: boolean;
  invite: () => void; moveDown: () => void; makeCohost: () => void; removeCohost: () => void; send: () => void; mute?: () => void;
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (iso: string) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`; };

/** Tap someone's picture in a live: their card, with follow, their posts, coins, and the host's controls. */
export default function ProfileSheet({ id, alias, onClose, act }: { id: string; alias: string; onClose: () => void; act: SheetActions }) {
  const [c, setC] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/rooms/profile?id=${id}`).then((r) => r.json()).then((j) => !j.error && setC(j)).catch(() => {});
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [id, onClose]);
  async function follow() {
    if (!c) return;
    setBusy(true);
    const sb = supabaseBrowser();
    const { error } = c.iFollow ? await sb.from("follows").delete().eq("followee_id", c.id) : await sb.from("follows").insert({ followee_id: c.id });
    if (!error) setC({ ...c, iFollow: !c.iFollow, followers: c.followers + (c.iFollow ? -1 : 1) });
    setBusy(false);
  }
  const roleLabel = { host: "Host", cohost: "Co-host", speaker: "Speaker", listener: "Listener" }[act.role];
  return (
    <div className="lv-sheet-wrap" role="presentation" onClick={onClose}>
      <section className="lv-sheet" role="dialog" aria-modal="true" aria-label={`${alias}'s profile`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="lv-x" onClick={onClose} aria-label="Close">✕</button>
        <div className="lv-sheet-head">
          <Avatar className="avatar lv-sheet-av" alias={c?.alias || alias} color={c?.color ?? null} url={c?.avatar_url ?? null} />
          <div>
            <b className="lv-sheet-name">{c?.alias || alias} {c?.is_verified && <VerifiedBadge n={c.verified_badge} size={20} />}</b>
            <small className="muted">{c?.handle ? `@${c.handle} · ` : ""}{roleLabel}{c?.is_team ? ` · ${c.team_title || "AUTISTIK team"}` : ""}</small>
            <div className="lv-sheet-stats"><span><b>{c ? c.followers.toLocaleString("en-US") : "…"}</b> followers</span><span><b>{c ? c.following.toLocaleString("en-US") : "…"}</b> following</span></div>
          </div>
        </div>
        <div className="lv-sheet-btns">
          {c?.me ? <Link className="btn small" href="/me">✏️ Edit profile</Link>
            : <button type="button" className={"btn small" + (c?.iFollow ? "" : " primary")} disabled={!c || busy} onClick={follow}>{c?.iFollow ? "Following ✓" : "+ Follow"}</button>}
          {c?.handle && <Link className="btn small" href={`/u/${c.handle}`} target="_blank">Full profile</Link>}
        </div>
        {act.canRun && !c?.me && (
          <div className="lv-sheet-run">
            <small className="muted">Run the live</small>
            <div className="lv-sheet-btns">
              <button type="button" className="btn small primary" onClick={act.send}>🎁 Send tokens</button>
              {act.role === "listener" && <button type="button" className="btn small" onClick={act.invite}>🎙️ Invite to speak</button>}
              {act.role !== "listener" && act.role !== "host" && !act.muted && act.mute && <button type="button" className="btn small" onClick={act.mute}>🔇 Mute</button>}
              {act.role === "speaker" && <button type="button" className="btn small" onClick={act.moveDown}>↓ Move to listeners</button>}
              {act.isHost && act.role !== "cohost" && act.role !== "host" && <button type="button" className="btn small" onClick={act.makeCohost}>⭐ Make co-host</button>}
              {act.isHost && act.role === "cohost" && <button type="button" className="btn small" onClick={act.removeCohost}>Remove co-host</button>}
            </div>
          </div>
        )}
        {c && c.launched.length > 0 && (
          <div className="lv-sheet-sec"><small className="muted">🚀 Launched</small>
            <div className="lv-chips">{c.launched.map((l) => <Link key={l.chain + l.token} href={`/launchpad/${l.chain}/${l.token}`} target="_blank" className="lv-chip" title={l.token}>${l.symbol} <span className="mono">{short(l.token)}</span></Link>)}</div>
          </div>
        )}
        {c && (c.watching.length > 0 || c.me) && (
          <div className="lv-sheet-sec"><small className="muted">👀 Watching{c.me && !c.watchShared ? " (only you see this)" : ""}</small>
            {c.watching.length ? <div className="lv-chips">{c.watching.map((w) => <Link key={w.chain + w.token} href={`/launchpad/${w.chain}/${w.token}`} target="_blank" className="lv-chip" title={w.token}>{w.symbol ? `$${w.symbol} ` : ""}<span className="mono">{short(w.token)}</span></Link>)}</div> : <small className="muted">Nothing on the watchlist yet.</small>}
          </div>
        )}
        <div className="lv-sheet-sec"><small className="muted">💬 Latest posts</small>
          {!c ? <small className="muted">Loading…</small> : c.posts.length ? c.posts.map((p) => (
            <Link key={p.id} href={`/mood?tik=${p.id}`} target="_blank" className="lv-post">
              <span>{p.body.slice(0, 180)}{p.body.length > 180 ? "…" : ""}</span>
              <small className="muted">{ago(p.created_at)}</small>
            </Link>
          )) : <small className="muted">No posts yet.</small>}
        </div>
      </section>
    </div>
  );
}
