"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { linkWallet } from "@/lib/wallet-link-client";
import { streamOf } from "@/lib/live";

/**
 * Join a live session: sign in, connect a wallet (once), then join. Joining ties your Hub name and wallet to the
 * session, so the team can airdrop to everyone who was there. YouTube streams play right here.
 */
export default function JoinLive({ sessionId, link, uid, wallet: w0, joined: j0, live }: {
  sessionId: string; link: string | null; uid: string | null; wallet: boolean; joined: boolean; live: boolean;
}) {
  const router = useRouter();
  const [wallet, setWallet] = useState(w0);
  const [joined, setJoined] = useState(j0);
  const [watch, setWatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const stream = streamOf(link);

  if (!uid) {
    return (
      <div className="join-live stack">
        <div className="steps3"><span className="on">1 · Sign in</span><span>2 · Connect wallet</span><span>3 · Join</span></div>
        <Link className="btn primary" href="/login?next=/live">Sign in to join</Link>
      </div>
    );
  }

  async function connect() {
    setBusy(true); setMsg("Check your wallet app: you'll sign a free message. No funds move.");
    try { await linkWallet(uid!); setWallet(true); setMsg("Wallet connected. Now press Join."); router.refresh(); }
    catch (e: any) { setMsg(e.message === "No wallet chosen." ? "" : e.message); }
    setBusy(false);
  }
  async function join() {
    setBusy(true); setMsg("");
    const { error } = await supabaseBrowser().from("session_joins").insert({ session_id: sessionId });
    setBusy(false);
    if (error && error.code !== "23505") {
      setMsg(/row-level|policy/i.test(error.message) ? (live ? "Connect your wallet first, then join." : "This session isn't live yet. Come back when it starts.") : "Couldn't join. Try again.");
      return;
    }
    setJoined(true); router.refresh();
    open();
  }
  function open() {
    if (stream.kind === "youtube") setWatch(true);
    else if (link) window.open(link, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="join-live stack">
      <div className="steps3">
        <span className="done">1 · Signed in ✓</span>
        <span className={wallet ? "done" : "on"}>2 · {wallet ? "Wallet connected ✓" : "Connect wallet"}</span>
        <span className={joined ? "done" : wallet ? "on" : ""}>3 · {joined ? "Joined ✓" : "Join"}</span>
      </div>
      {!wallet ? (
        <button className="btn primary" type="button" disabled={busy} onClick={connect}>Connect wallet to join</button>
      ) : !joined ? (
        <button className="btn primary" type="button" disabled={busy || !live} onClick={join}>{live ? "🎙️ Join live" : "Opens when it starts"}</button>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          {link && <button className="btn primary" type="button" onClick={open}>{stream.label}</button>}
          <span className="chip-flag ok">You&apos;re in. Airdrops for this session go to your linked wallet.</span>
        </div>
      )}
      {msg && <span className="muted" role="status" style={{ fontSize: ".88em" }}>{msg}</span>}
      {watch && stream.embed && (
        <div className="live-player"><iframe src={stream.embed} title="Live session" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /></div>
      )}
    </div>
  );
}
