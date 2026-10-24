"use client";
/**
 * The member's own panel in the left menu (classic layout). Tapping your picture at the top of the menu swaps the
 * menu for this panel; tapping it again brings the menu back. It shows your photo (with Change photo), your wallet,
 * updates from people you follow, a token scanner, your launches and locks, and your account and display settings.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Avatar from "@/components/Avatar";
import PhotoCrop from "@/components/PhotoCrop";
import { supabaseBrowser } from "@/lib/supabase/client";

type Summary = {
  signedIn: boolean;
  profile?: { alias: string; handle?: string | null } | null;
  following?: number; followers?: number;
  wallet?: { short: string; totalUsd: number | null; funds: { symbol: string; amount: number; valueUsd: number | null }[] } | null;
  launches?: { chain: string; token: string; symbol: string; lp_lock: string; lp_unlock_at: string | null }[];
};
type Update = { kind: string; id: string; at: string; body?: string; author?: { id: string; alias: string; color: string; avatar_url?: string | null } | null };

const usd = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 }));
const ago = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

export default function MePanel({ me, settings }: {
  me: { id: string; alias: string; color: string; avatar_url: string | null; is_admin: boolean };
  /** The display and account rows (shared with the menu on phones). */
  settings: ReactNode;
}) {
  const router = useRouter();
  const [sum, setSum] = useState<Summary | null>(null);
  const [updates, setUpdates] = useState<Update[] | null>(null);
  const [photo, setPhoto] = useState(me.avatar_url);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [scan, setScan] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);

  useEffect(() => {
    fetch("/api/me/summary").then((r) => r.json()).then(setSum).catch(() => setSum({ signedIn: true }));
    fetch("/api/feed?tab=following").then((r) => r.json()).then((d) => setUpdates((d.items || []).slice(0, 4))).catch(() => setUpdates([]));
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
  function goScan(e: React.FormEvent) {
    e.preventDefault();
    const v = scan.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) router.push(`/analytics/bsc/${v}`);
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) router.push(`/analytics/solana/${v}`);
    else setMsg("Paste a token address (0x… or a Solana address).");
  }

  return (
    <div className="mp">
      <div className="mp-head">
        <button type="button" className="mp-photo" onClick={() => file.current?.click()} disabled={busy} aria-label="Change your profile photo">
          <Avatar className="me-av mp-av" alias={me.alias} color={me.color} url={photo} logo />
          <span className="mp-cam" aria-hidden="true">📷</span>
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      {crop && <PhotoCrop file={crop} onCancel={() => setCrop(null)} onDone={upload} />}
        <div className="mp-name">
          <b>{sum?.profile?.alias || me.alias}</b>
          {sum?.profile?.handle && <small>@{sum.profile.handle}</small>}
          <small><Link href="/members?tab=following">{sum?.following ?? "–"} following</Link> · <Link href="/members?tab=followers">{sum?.followers ?? "–"} followers</Link></small>
        </div>
      </div>
      <div className="mp-row">
        <button type="button" className="btn small" onClick={() => file.current?.click()} disabled={busy}>{photo ? "Change photo" : "Add a photo"}</button>
        {photo && <button type="button" className="btn small" onClick={removePhoto} disabled={busy}>Remove</button>}
        <Link className="btn small" href="/me">My profile</Link>
      </div>
      {msg && <small className="mp-msg">{msg}</small>}

      <section className="mp-sec">
        <div className="mp-sec-h"><b>👛 Wallet</b><Link href="/wallet">Open</Link></div>
        {!sum ? <small className="mp-dim">Loading…</small> : sum.wallet ? (
          <>
            <div className="mp-total"><b>{usd(sum.wallet.totalUsd)}</b><small className="mono">{sum.wallet.short}</small></div>
            {sum.wallet.funds.slice(0, 3).map((f) => <div key={f.symbol} className="mp-line"><span>{f.symbol}</span><span>{usd(f.valueUsd)}</span></div>)}
            <div className="mp-row"><Link className="btn small" href="/wallet">Send</Link><Link className="btn small" href="/wallet">Receive</Link><Link className="btn small" href="/swap">Swap</Link></div>
          </>
        ) : <small className="mp-dim">No wallet yet. <Link href="/wallet">Set one up</Link>.</small>}
      </section>

      <section className="mp-sec">
        <div className="mp-sec-h"><b>🔔 Updates from people you follow</b><Link href="/members">All</Link></div>
        {updates === null ? <small className="mp-dim">Loading…</small> : updates.length === 0 ? (
          <small className="mp-dim">Nothing new. <Link href="/members?tab=find">Find people to follow</Link>.</small>
        ) : updates.map((u) => (
          <Link key={u.id} className="mp-up" href={u.author ? `/members/${u.author.id}` : "/community"}>
            {u.author && <Avatar className="me-av" alias={u.author.alias} color={u.author.color} url={u.author.avatar_url} />}
            <span><b>{u.author?.alias || "Member"}</b> <small>{ago(u.at)}</small><br /><span className="mp-clamp">{u.body}</span></span>
          </Link>
        ))}
      </section>

      <section className="mp-sec">
        <div className="mp-sec-h"><b>🔎 Token scanner</b><Link href="/analytics">Open</Link></div>
        <form className="mp-scan" onSubmit={goScan}>
          <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Paste a token address" spellCheck={false} aria-label="Token address to scan" />
          <button type="submit" className="btn small primary">Scan</button>
        </form>
      </section>

      <section className="mp-sec">
        <div className="mp-sec-h"><b>🚀 My launches &amp; locks</b><Link href="/lockers">Lockers</Link></div>
        {!sum ? <small className="mp-dim">Loading…</small> : !sum.launches?.length ? (
          <small className="mp-dim">No launches yet. <Link href="/launchpad/new">Launch a token</Link>.</small>
        ) : sum.launches.slice(0, 4).map((l) => (
          <Link key={l.chain + l.token} className="mp-line" href={`/launchpad/${l.chain}/${l.token}`}>
            <span>${l.symbol}</span>
            <small>{l.lp_lock === "burn" ? "🔥 burned" : l.lp_unlock_at ? `🔒 to ${new Date(l.lp_unlock_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : "🔒 locked"}</small>
          </Link>
        ))}
      </section>

      <section className="mp-sec mp-settings">{settings}</section>
    </div>
  );
}
