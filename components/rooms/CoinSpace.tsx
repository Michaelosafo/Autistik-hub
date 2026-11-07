"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Live = { id: string; title: string; host: string };

/**
 * A live voice/video call (Space) tied to a coin, for before, during and after launch. Before launch (no token): a
 * button to host a pre-launch Space. On a coin page: "Live now: join" when the creator (or anyone) is live about this
 * coin, and a button to host one. Rooms are the ordinary live rooms (/spaces), with the coin attached.
 */
export default function CoinSpace({ chain, token, symbol, canHost, signedIn, compact }: { chain?: string; token?: string; symbol?: string; canHost: boolean; signedIn: boolean; compact?: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState<Live[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(symbol ? `$${symbol} live: talk with the dev` : "Pre-launch talk: what we're building");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!token) return;
    let stop = false;
    const load = async () => {
      const since = new Date(Date.now() - 12 * 3600e3).toISOString();
      const { data } = await supabaseBrowser().from("live_rooms").select("id,title,host:profiles!live_rooms_host_id_fkey(alias)").eq("chain", chain).eq("token", token).is("ended_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(3);
      if (!stop) setLive(((data || []) as any[]).map((r) => ({ id: r.id, title: r.title, host: (Array.isArray(r.host) ? r.host[0] : r.host)?.alias || "a member" })));
    };
    load();
    const t = setInterval(load, 20000);
    return () => { stop = true; clearInterval(t); };
  }, [chain, token]);

  async function start() {
    const t = title.trim();
    if (t.length < 3) { setMsg("Give your Space a short title."); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.push(`/login?next=${encodeURIComponent(location.pathname)}`); return; }
    // One open live per host: close an old one left open.
    await sb.from("live_rooms").update({ ended_at: new Date().toISOString() }).eq("host_id", user.id).is("ended_at", null);
    const { data, error } = await sb.from("live_rooms").insert({ title: t.slice(0, 80), ...(token ? { chain, token } : {}) }).select("id").single();
    setBusy(false);
    if (error || !data) { setMsg("Couldn't start the Space. Try again."); return; }
    router.push(`/spaces/${data.id}`);
  }

  return (
    <div id={token ? "space" : undefined} className={"coin-space" + (compact ? " compact" : "")}>
      {live.map((r) => (
        <Link key={r.id} href={`/spaces/${r.id}`} className="live-row coin-live">
          <span className="room-live"><i />Live</span>
          <span className="live-t"><b>{r.title}</b><small>{r.host} is talking about ${symbol} now</small></span>
          <span className="live-join">Join</span>
        </Link>
      ))}
      {canHost && (open ? (
        <div className="card stack" style={{ gap: 8 }}>
          <b>🎙️ {token ? `Host a Space for $${symbol}` : "Host a Space before you launch"}</b>
          <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Space title" />
          <small className="muted">Voice (and camera if you like). Talk about your project, invite people up to speak, and drop tokens to listeners. {token ? "Everyone on this coin's page sees you're live." : "While you're live, press 🚀 Launch in the room: it opens launching in a new tab so your Space keeps going."} Nothing is recorded.</small>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small primary" disabled={busy} onClick={start}>{busy ? "Starting…" : "🎙️ Go live"}</button>
            <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {msg && <small className="muted" role="status">{msg}</small>}
        </div>
      ) : (
        <button type="button" className="btn small coin-space-btn" onClick={() => (signedIn ? setOpen(true) : router.push(`/login?next=${encodeURIComponent(location.pathname)}`))}>
          🎙️ {token ? (live.length ? "Host another Space" : `Host a Space for $${symbol}`) : "Host a Space / VC before launch"}
        </button>
      ))}
    </div>
  );
}
