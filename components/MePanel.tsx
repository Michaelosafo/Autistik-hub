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
import FollowButton from "@/components/members/FollowButton";
import FindPeople from "@/components/FindPeople";
import { supabaseBrowser } from "@/lib/supabase/client";

type Summary = {
  signedIn: boolean;
  profile?: { alias: string; handle?: string | null } | null;
  following?: number; followers?: number;
  wallet?: { short: string; totalUsd: number | null; funds: { symbol: string; amount: number; valueUsd: number | null }[] } | null;
  launches?: { chain: string; token: string; symbol: string; lp_lock: string; lp_unlock_at: string | null }[];
  team?: { id: string; alias: string; handle: string | null; color: string; avatar_url: string | null; team_title: string | null; is_verified: boolean; following: boolean }[];
};
type Update = { kind: string; id: string; at: string; body?: string; author?: { id: string; alias: string; color: string; avatar_url?: string | null } | null };

/** Shortcuts at the top of your panel. */
const ACTIONS = [
  { href: "/board", name: "Board", note: "Every coin launched here, live", icon: "i-fire", color: "#FFD84D" },
  { href: "/launchpad/new", name: "Launch", note: "Make a new token", icon: "i-rocket", color: "#FF6B9A" },
  { href: "/liquidity", name: "Liquidity", note: "Add to a pool or create one", icon: "i-swap", color: "#4FD1FF" },
  { href: "/lockers", name: "Lock", note: "Lock LP or team tokens", icon: "i-lock", color: "#B57CFF" },
  { href: "/stake", name: "Earn", note: "Stake and rewards", icon: "i-rew", color: "#5BE38F" },
];
type Coin = { chain: string; token: string; name: string; symbol: string; logo: string | null; market: { marketCap: number | null; change24h: number | null } | null };
const short$ = (n: number | null | undefined) => n == null ? "–" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
/** A line icon from the site's icon set. */
function Ic({ id }: { id: string }) {
  return <svg className="mp-svg" aria-hidden="true"><use href={"#" + id} /></svg>;
}
const BAR = ["#F0B90B", "#B57CFF", "#4FD1FF", "#5BE38F"];
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
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [seenBoard, setSeenBoard] = useState(true);
  useEffect(() => { try { setSeenBoard(localStorage.getItem("seen-board") === "1"); } catch {} }, []);
  const markBoard = () => { try { localStorage.setItem("seen-board", "1"); } catch {} setSeenBoard(true); };
  const file = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const [view, setView] = useState(false);

  useEffect(() => {
    fetch("/api/me/summary").then((r) => r.json()).then(setSum).catch(() => setSum({ signedIn: true }));
    fetch("/api/board").then((r) => r.json()).then((d) => setCoins(Array.isArray(d?.tokens) ? d.tokens : [])).catch(() => setCoins([]));
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
  const q = scan.trim().toLowerCase();
  const isAddr = /^0x[0-9a-fA-F]{40}$/.test(scan.trim()) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(scan.trim());
  const found = q && !isAddr ? (coins || []).filter((c) => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q)).slice(0, 5) : [];
  function goScan(e: React.FormEvent) {
    e.preventDefault();
    const v = scan.trim();
    const mine = (coins || []).find((c) => c.token.toLowerCase() === v.toLowerCase());
    if (mine) router.push(`/launchpad/${mine.chain}/${mine.token}`);
    else if (/^0x[0-9a-fA-F]{40}$/.test(v)) router.push(`/analytics/bsc/${v}`);
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) router.push(`/analytics/solana/${v}`);
    else if (found[0]) router.push(`/launchpad/${found[0].chain}/${found[0].token}`);
    else setMsg("No coin with that name. Paste a token address to scan it.");
  }

  return (
    <div className="mp">
      <div className="mp-hero">
        <div className="mp-hero-bg" aria-hidden="true" />
        <div className="mp-head">
          <span className="mp-photo-wrap">
            <button type="button" className="mp-photo" onClick={() => (photo ? setView(true) : file.current?.click())} disabled={busy} aria-label={photo ? "View your photo" : "Add a profile photo"}>
              <Avatar className="me-av mp-av" alias={me.alias} color={me.color} url={photo} logo />
            </button>
            <button type="button" className="mp-cam" onClick={() => file.current?.click()} disabled={busy} aria-label="Change your profile photo"><Ic id="i-cam" /></button>
          </span>
          <div className="mp-name">
            <b>{sum?.profile?.alias || me.alias}{me.is_admin && <span className="mp-badge">Admin</span>}</b>
            {sum?.profile?.handle && <small>@{sum.profile.handle}</small>}
            <div className="mp-row" style={{ marginTop: 6 }}>
              <button type="button" className="mp-chip" onClick={() => file.current?.click()} disabled={busy}>{photo ? "Change photo" : "Add a photo"}</button>
              {photo && <button type="button" className="mp-chip" onClick={removePhoto} disabled={busy}>Remove</button>}
              <Link className="mp-chip" href="/me">Profile</Link>
            </div>
          </div>
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
        {crop && <PhotoCrop file={crop} onCancel={() => setCrop(null)} onDone={upload} />}
        {view && photo && (
          <div className="pv-bg" role="dialog" aria-modal="true" aria-label="Your photo" onClick={(e) => e.target === e.currentTarget && setView(false)}>
            <div className="pv">
              <img src={photo} alt={`${me.alias}'s photo`} />
              <b>{me.alias}</b>
              <div className="mp-row" style={{ justifyContent: "center" }}>
                <button type="button" className="btn small" onClick={() => { setView(false); file.current?.click(); }}>Change photo</button>
                <button type="button" className="btn small" onClick={() => setView(false)}>Close</button>
              </div>
            </div>
          </div>
        )}
        <div className="mp-stats">
          <Link href="/members?tab=following"><b>{sum?.following ?? "–"}</b><small>Following</small></Link>
          <Link href="/members?tab=followers"><b>{sum?.followers ?? "–"}</b><small>Followers</small></Link>
          <Link href="/launchpad"><b>{sum?.launches?.length ?? "–"}</b><small>Launches</small></Link>
        </div>
      </div>
      {msg && <small className="mp-msg">{msg}</small>}
      <FindPeople />

      <form className="mp-search" onSubmit={goScan} role="search">
        <Ic id="i-search" />
        <input value={scan} onChange={(e) => setScan(e.target.value)} placeholder="Search coins or paste an address" spellCheck={false} aria-label="Search coins or paste a token address" />
        {scan && <button type="submit" className="mp-search-go">{isAddr ? "Scan" : "Go"}</button>}
      </form>
      {(found.length > 0 || (isAddr && scan)) && (
        <div className="mp-results">
          {found.map((c) => (
            <Link key={c.chain + c.token} href={`/launchpad/${c.chain}/${c.token}`} className="mp-coin">
              {c.logo ? <img src={c.logo} alt="" /> : <span className="mp-coin-l">{c.symbol.slice(0, 2)}</span>}
              <span className="mp-coin-t"><b>{c.name}</b><small>${c.symbol} · {c.chain}</small></span>
              <small>{short$(c.market?.marketCap)}</small>
            </Link>
          ))}
          {isAddr && <button type="button" className="mp-coin" onClick={goScan as any}><span className="mp-coin-l"><Ic id="i-search" /></span><span className="mp-coin-t"><b>Scan this token</b><small className="mono">{scan.trim().slice(0, 6)}…{scan.trim().slice(-4)}</small></span></button>}
        </div>
      )}

      {sum && (() => {
        const steps: { done: boolean; label: string; note: string; href?: string; onClick?: () => void }[] = [
          { done: !!photo, label: "Add a profile photo", note: "So people recognise you", onClick: () => file.current?.click() },
          { done: !!sum.wallet, label: "Set up your wallet", note: "Free, takes a minute", href: "/wallet" },
          { done: !sum.team?.length || sum.team.every((t) => t.following), label: "Follow the AUTISTIK team", note: "News, airdrops and live sessions", href: "#mp-team" },
          { done: seenBoard, label: "Look at the Board", note: "Every coin launched here, live", href: "/board" },
        ];
        const done = steps.filter((x) => x.done).length;
        if (done === steps.length) return null;
        return (
          <section className="mp-sec mp-start" aria-label="Get started">
            <div className="mp-sec-h"><b>Get started</b><small>{done} of {steps.length} done</small></div>
            <div className="mp-progress" aria-hidden="true"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
            {steps.map((x) => {
              const body = <><span className={"mp-step-ic" + (x.done ? " ok" : "")} aria-hidden="true">{x.done ? "✓" : ""}</span><span className="mp-link-t"><b>{x.label}</b><small>{x.note}</small></span>{!x.done && <i aria-hidden="true">›</i>}</>;
              return x.done ? <div key={x.label} className="mp-step done">{body}</div>
                : x.onClick ? <button key={x.label} type="button" className="mp-step" onClick={x.onClick}>{body}</button>
                : <Link key={x.label} href={x.href!} className="mp-step" onClick={() => x.href === "/board" && markBoard()}>{body}</Link>;
            })}
          </section>
        );
      })()}

      <section className="mp-sec mp-wallet">
        <div className="mp-sec-h"><b>Wallet</b><Link href="/wallet">Open</Link></div>
        {!sum ? <small className="mp-dim">Loading…</small> : sum.wallet ? (
          <>
            <div className="mp-total"><b>{usd(sum.wallet.totalUsd)}</b><small className="mono">{sum.wallet.short}</small></div>
            {(() => {
              const funds = sum.wallet!.funds.filter((f) => (f.valueUsd ?? 0) > 0).slice(0, 4);
              const total = funds.reduce((t, f) => t + (f.valueUsd ?? 0), 0);
              return total > 0 ? <div className="mp-bar" aria-hidden="true">{funds.map((f, i) => <i key={f.symbol} style={{ width: `${((f.valueUsd ?? 0) / total) * 100}%`, background: BAR[i % BAR.length] }} />)}</div> : null;
            })()}
            {sum.wallet.funds.slice(0, 4).map((f, i) => <div key={f.symbol} className="mp-line"><span><i className="mp-dot" style={{ background: BAR[i % BAR.length] }} />{f.symbol}</span><span>{usd(f.valueUsd)}</span></div>)}
            <div className="mp-row"><Link className="mp-chip" href="/wallet">Send</Link><Link className="mp-chip" href="/wallet">Receive</Link><Link className="mp-chip" href="/swap">Swap</Link></div>
          </>
        ) : <small className="mp-dim">No wallet yet. <Link href="/wallet">Set one up</Link>.</small>}
      </section>

      <nav className="mp-links" aria-label="Create and earn">
        <small className="mp-cap">Create &amp; earn</small>
        {ACTIONS.map((a) => (
          <Link key={a.href} href={a.href} className="mp-link" style={{ ["--ic" as any]: a.color }} onClick={() => a.href === "/board" && markBoard()}><span className="mp-ic" aria-hidden="true"><Ic id={a.icon} /></span><span className="mp-link-t"><b>{a.name}</b><small>{a.note}</small></span><i aria-hidden="true">›</i></Link>
        ))}
      </nav>

      {!!sum?.team?.length && (
        <section className="mp-sec mp-team" id="mp-team" aria-label="Recommended: the AUTISTIK team">
          <div className="mp-sec-h"><b>Follow the AUTISTIK team</b><Link href="/members">Members</Link></div>
          <small className="mp-dim">Recommended for everyone: news, airdrops and live sessions first.</small>
          {sum.team.map((t) => (
            <div key={t.id} className="mp-person">
              <Link href={`/members/${t.id}`} className="mp-person-l">
                <Avatar className="me-av" alias={t.alias} color={t.color} url={t.avatar_url} />
                <span className="mp-link-t"><b>{t.alias}{t.is_verified && <span className="mp-tick" title="Verified">✓</span>}</b><small>{t.team_title ? `AUTISTIK team · ${t.team_title}` : "AUTISTIK team"}</small></span>
              </Link>
              <FollowButton id={t.id} initial={t.following} small />
            </div>
          ))}
        </section>
      )}

      {coins && coins.length > 0 && (
        <section className="mp-sec mp-live">
          <div className="mp-sec-h"><b><i className="mp-pulse" aria-hidden="true" />Live on the Board</b><Link href="/board">All</Link></div>
          {[...coins].sort((a, b) => (b.market?.marketCap ?? 0) - (a.market?.marketCap ?? 0)).slice(0, 3).map((c, i) => (
            <Link key={c.chain + c.token} href={`/launchpad/${c.chain}/${c.token}`} className="mp-coin">
              <span className="mp-rank">#{i + 1}</span>
              {c.logo ? <img src={c.logo} alt="" /> : <span className="mp-coin-l">{c.symbol.slice(0, 2)}</span>}
              <span className="mp-coin-t"><b>{c.name}</b><small>${c.symbol} · MC {short$(c.market?.marketCap)}</small></span>
              {c.market?.change24h != null && <small className={c.market.change24h >= 0 ? "mp-up-c" : "mp-down-c"}>{c.market.change24h >= 0 ? "▲" : "▼"}{Math.abs(c.market.change24h).toFixed(0)}%</small>}
            </Link>
          ))}
        </section>
      )}

      <section className="mp-sec">
        <div className="mp-sec-h"><b>Updates from people you follow</b><Link href="/members">All</Link></div>
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
        <div className="mp-sec-h"><b>My launches &amp; locks</b><Link href="/lockers">Lockers</Link></div>
        {!sum ? <small className="mp-dim">Loading…</small> : !sum.launches?.length ? (
          <small className="mp-dim">No launches yet. <Link href="/launchpad/new">Launch a token</Link>.</small>
        ) : sum.launches.slice(0, 4).map((l) => (
          <Link key={l.chain + l.token} className="mp-line" href={`/launchpad/${l.chain}/${l.token}`}>
            <span>${l.symbol}</span>
            <small>{l.lp_lock === "burn" ? "Burned" : l.lp_unlock_at ? `Locked to ${new Date(l.lp_unlock_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : "Locked"}</small>
          </Link>
        ))}
      </section>

      <section className="mp-sec mp-settings">{settings}</section>
    </div>
  );
}
