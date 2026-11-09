"use client";
/**
 * The member's own panel in the left menu (classic layout). Tapping your picture at the top of the menu swaps the
 * menu for this panel; tapping it again brings the menu back. It shows your photo (tap it to change, remove or share), your wallet,
 * updates from people you follow, a token scanner, your launches and locks, and your account and display settings.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import PhotoCrop from "@/components/PhotoCrop";
import ShareProfile from "@/components/members/ShareProfile";
import VerifiedBadge, { BADGES } from "@/components/VerifiedBadge";
import BadgePicker from "@/components/BadgePicker";
import BadgeApply from "@/components/BadgeApply";
import { supabaseBrowser } from "@/lib/supabase/client";

type Summary = {
  signedIn: boolean;
  profile?: { alias: string; handle?: string | null; is_verified?: boolean; is_team?: boolean; verified_badge?: number | null } | null;
  following?: number; followers?: number; tiks?: number; likes?: number;
  wallet?: { short: string; totalUsd: number | null; funds: { symbol: string; amount: number; valueUsd: number | null }[] } | null;
  launches?: { chain: string; token: string; symbol: string; lp_lock: string; lp_unlock_at: string | null }[];
  team?: { id: string; alias: string; handle: string | null; color: string; avatar_url: string | null; team_title: string | null; is_verified: boolean; following: boolean }[];
};

/** Line icons for the panel's rows (24×24, stroke). */
const IC: Record<string, string> = {
  wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  chats: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z"/>',
  live: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  launch: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5z"/><circle cx="15" cy="9" r="1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  scan: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  board: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  star: '<path d="M12 3l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.5 6.7 19.3l1.1-5.9L3.4 9.3l6-.8z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  race: '<path d="M5 17h14l-1.5-5.5A2 2 0 0 0 15.6 10H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
function Svg({ d, size = 18 }: { d: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
}
/** One row: coloured icon tile, label, optional value on the right, chevron. */
function Row({ href, onClick, icon, color, label, value }: { href?: string; onClick?: () => void; icon: string; color: string; label: string; value?: ReactNode }) {
  const body = <><span className="pf-ic" style={{ ["--c" as any]: color }}><Svg d={IC[icon]} /></span><span className="pf-l">{label}</span>{value != null && <span className="pf-v">{value}</span>}<i className="pf-chev" aria-hidden="true">›</i></>;
  return href ? <Link href={href} className="pf-row">{body}</Link> : <button type="button" className="pf-row" onClick={onClick}>{body}</button>;
}
const usd = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 }));

export default function MePanel({ me, settings }: {
  me: { id: string; alias: string; color: string; avatar_url: string | null; is_admin: boolean };
  /** The display and account rows (shared with the menu on phones). */
  settings: ReactNode;
}) {
  const router = useRouter();
  const [sum, setSum] = useState<Summary | null>(null);
  const [photo, setPhoto] = useState(me.avatar_url);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [view, setView] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [badge, setBadge] = useState(false);
  const [vb, setVb] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/me/summary").then((r) => r.json()).then(setSum).catch(() => setSum({ signedIn: true }));
  }, []);

  /** A picture was picked: first let them choose how it fits in the circle. */
  function pick(f: File) {
    if (!/^image\//.test(f.type)) { setMsg("Pick a picture (PNG, JPG, WebP or GIF)."); return; }
    if (f.size > 20 * 1024 * 1024) { setMsg("That picture is very big. Try one under 20 MB."); return; }
    setMsg(""); setCrop(f);
  }
  async function upload(blob: Blob) {
    setCrop(null);
    setBusy(true); setMsg("Uploading…");
    try {
      const sb = supabaseBrowser();
      const path = `${me.id}/avatar-${Date.now()}.webp`;
      const { error: up } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/webp", upsert: true });
      if (up) throw new Error(up.message);
      const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error } = await sb.from("profiles").update({ avatar_url: url }).eq("id", me.id);
      if (error) throw new Error(error.message);
      if (photo) {
        const old = photo.split("/avatars/")[1];
        if (old && old.startsWith(me.id + "/")) sb.storage.from("avatars").remove([old]).catch(() => {});
      }
      setPhoto(url); setMsg("✅ Photo updated."); router.refresh();
    } catch (e: any) {
      const m = String(e?.message || "");
      setMsg(/size|large/i.test(m) ? "That picture is too big. Try one under 2 MB."
        : /Change photo button|permission|denied|policy/i.test(m) ? "Couldn't save your photo. Sign out and in again, then try once more."
        : `Couldn't upload that picture${m ? ` (${m.slice(0, 80)})` : ""}. Try again.`);
    }
    finally { setBusy(false); }
  }
  async function removePhoto() {
    setBusy(true);
    const sb = supabaseBrowser();
    await sb.from("profiles").update({ avatar_url: null }).eq("id", me.id);
    const old = photo?.split("/avatars/")[1];
    if (old && old.startsWith(me.id + "/")) await sb.storage.from("avatars").remove([old]).catch(() => {});
    setPhoto(null); setBusy(false); setMsg("Photo removed."); router.refresh();
  }
  const verified = !!(sum?.profile?.is_verified || sum?.profile?.is_team);
  const name = sum?.profile?.alias || me.alias;
  const badgeN = vb ?? sum?.profile?.verified_badge;
  return (
    <div className="mp pf">
      <div className="pf-head">
        <button type="button" className="pf-photo" onClick={(e) => { e.stopPropagation(); setSheet(true); }} disabled={busy} aria-label="Profile photo options" aria-haspopup="dialog">
          <Avatar className="me-av pf-av" alias={me.alias} color={me.color} url={photo} logo />
          <span className="pf-cam" aria-hidden="true"><Svg d={IC.camera} size={13} /></span>
        </button>
        <h2 className="pf-name">{name}{verified && <VerifiedBadge n={badgeN} size={17} className="vbadge-name" />}</h2>
        <small className="pf-sub">{sum?.profile?.handle ? `@${sum.profile.handle}` : "Add a username on your profile"}{me.is_admin && <em className="pf-admin">Admin</em>}</small>
        <div className="pf-stats">
          <Link href="/members?tab=following"><b>{sum?.following ?? "–"}</b><small>Following</small></Link>
          <Link href="/members?tab=followers"><b>{sum?.followers ?? "–"}</b><small>Followers</small></Link>
          <Link href="/mood"><b>{sum?.tiks ?? "–"}</b><small>Tiks</small></Link>
        </div>
        <div className="pf-acts">
          <Link className="pf-act" href="/me">Edit profile</Link>
          <ShareProfile handle={sum?.profile?.handle ?? null} id={me.id} name={name} className="pf-act" />
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
        {crop && <PhotoCrop file={crop} onCancel={() => setCrop(null)} onDone={upload} />}
        {/* Opened over the whole page (not inside the panel, whose slide-in would trap and clip them). */}
        {typeof document !== "undefined" && (sheet || badge || (view && photo)) && createPortal(<>
        {sheet && (
          <div className="mp-sheet-bg" role="dialog" aria-modal="true" aria-label="Profile photo" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
            <div className="mp-sheet">
              <Avatar className="me-av mp-sheet-av" alias={me.alias} color={me.color} url={photo} logo />
              <button type="button" onClick={() => { setSheet(false); file.current?.click(); }}>📷 {photo ? "Change photo" : "Add a photo"}</button>
              {photo && <button type="button" onClick={() => { setSheet(false); setView(true); }}>🖼️ View photo</button>}
              {photo && <button type="button" className="danger" onClick={() => { setSheet(false); removePhoto(); }}>🗑️ Remove photo</button>}
              <ShareProfile handle={sum?.profile?.handle ?? null} id={me.id} name={sum?.profile?.alias || me.alias} className="mp-sheet-share" />
              <button type="button" className="mp-sheet-x" onClick={() => setSheet(false)}>Cancel</button>
            </div>
          </div>
        )}
        {badge && (
          <div className="mp-sheet-bg" role="dialog" aria-modal="true" aria-label="Your badge" onClick={(e) => e.target === e.currentTarget && setBadge(false)}>
            <div className="mp-sheet mp-badge-sheet">
              {verified ? (
                <BadgePicker current={vb ?? sum?.profile?.verified_badge ?? null} name={sum?.profile?.alias || me.alias} startOpen onSaved={(n) => { setVb(n); setBadge(false); }} />
              ) : (
                <>
                  <b className="mp-bs-h">🏅 Choose your badge type</b>
                  <small className="mp-dim">Apply for Verified (creators, projects, known members) or Team (you work with AUTISTIK). Once approved, you pick one of these 10 designs to show next to your name everywhere.</small>
                  <div className="mp-bs-row" aria-hidden="true">{BADGES.map((b, i) => <VerifiedBadge key={b.name} n={i + 1} size={26} />)}</div>
                  <BadgeApply verified={false} team={false} />
                </>
              )}
              <button type="button" className="mp-sheet-x" onClick={() => setBadge(false)}>Close</button>
            </div>
          </div>
        )}
        {view && photo && (
          <div className="pv-bg" role="dialog" aria-modal="true" aria-label="Your photo" onClick={(e) => e.target === e.currentTarget && setView(false)}>
            <div className="pv">
              <img src={photo} alt={`${me.alias}'s photo`} />
              <b>{me.alias}</b>
              <div className="mp-row" style={{ justifyContent: "center" }}>
                <button type="button" className="btn small" onClick={() => setView(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
        </>, document.body)}
      </div>
      {msg && <small className="mp-msg">{msg}</small>}

      {!verified && (
        <button type="button" className="pf-cta" onClick={(e) => { e.stopPropagation(); setBadge(true); }}>
          <span className="pf-cta-ic" aria-hidden="true"><VerifiedBadge n={1} size={22} /></span>
          <span className="pf-cta-t"><b>Get a badge</b><small>Apply for Verified or Team. It shows next to your name everywhere.</small></span>
          <i className="pf-chev" aria-hidden="true">›</i>
        </button>
      )}

      <div className="pf-group">
        <Row href="/wallet" icon="wallet" color="#F0B90B" label="Wallet" value={sum?.wallet ? usd(sum.wallet.totalUsd) : sum ? "Set up" : "…"} />
        <Row href="/chats" icon="chats" color="#3B9EFF" label="Chats" />
        <Row href="/spaces" icon="live" color="#FF5C8A" label="Live rooms" />
        <Row onClick={() => setBadge(true)} icon="star" color="#8B6CFF" label="Badge" value={verified ? <VerifiedBadge n={badgeN} size={15} /> : "Apply"} />
      </div>

      <div className="pf-group">
        <Row href="/swap" icon="swap" color="#22C38E" label="Swap" />
        <Row href="/analytics" icon="scan" color="#14B8A6" label="Check a coin" />
        <Row href="/board" icon="board" color="#F59E0B" label="Board" />
        <Row href="/launchpad/new" icon="launch" color="#EC4899" label="Launch a coin" />
        <Row href="/lockers" icon="lock" color="#A855F7" label="Lock & stake" />
        <Row href="/hyperfocus" icon="race" color="#FB923C" label="Race" />
      </div>

      <div className="pf-group">
        <Row href="/members?tab=find" icon="people" color="#0EA5E9" label="Find people" />
        <Row href="/members" icon="user" color="#64748B" label="AUTISTIK team" value={sum?.team?.length ? `${sum.team.length}` : undefined} />
      </div>

      <div className="pf-group pf-settings">{settings}</div>
    </div>
  );
}
