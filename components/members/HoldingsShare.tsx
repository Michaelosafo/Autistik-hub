"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

type Mode = "private" | "followers" | "public";
const MODES: [Mode, string, string][] = [
  ["private", "🔒 Only me", "Nobody else sees what you hold"],
  ["followers", "👥 Followers", "People who follow you"],
  ["public", "🌍 Everyone", "Every signed-in member"],
];

/** Your choice of who sees your wallet holdings, plus a private link for people you pick. The address stays hidden. */
export default function HoldingsShare({ uid, initial }: { uid: string; initial: Mode }) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [mode, setMode] = useState<Mode>(initial);
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const url = (k: string) => `${location.origin}/members/${uid}?share=${k}`;

  useEffect(() => {
    sb.from("holdings_links").select("key").eq("user_id", uid).maybeSingle().then(({ data }) => data?.key && setLink(url(data.key)));
  }, [uid]);

  async function pick(m: Mode) {
    setBusy(true); setMsg("");
    const { error } = await sb.from("profiles").update({ holdings_share: m }).eq("id", uid);
    setBusy(false);
    if (error) { setMsg("Couldn't save. Try again."); return; }
    setMode(m); router.refresh();
  }
  async function makeLink() {
    setBusy(true); setMsg("");
    const { data, error } = await sb.rpc("new_holdings_link");
    setBusy(false);
    if (error || typeof data !== "string") { setMsg("Couldn't make a link right now."); return; }
    setLink(url(data));
    try { await navigator.clipboard.writeText(url(data)); setMsg("Link copied. Anyone signed in who has it can see your holdings."); } catch { setMsg("Link ready. Copy it below."); }
  }
  async function stopLink() {
    await sb.from("holdings_links").delete().eq("user_id", uid);
    setLink(null); setMsg("The link no longer works.");
  }

  return (
    <div className="card stack">
      <h2>Who sees your holdings</h2>
      <div className="share-modes" role="radiogroup" aria-label="Who sees your holdings">
        {MODES.map(([m, name, note]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className="share-mode" disabled={busy} onClick={() => pick(m)}>
            <b>{name}</b><small>{note}</small>
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <b style={{ fontSize: ".92em" }}>Or share with people you choose</b>
        {link ? (
          <>
            <input type="text" readOnly className="mono" value={link} onFocus={(e) => e.target.select()} aria-label="Your private holdings link" />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" type="button" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg("Link copied."))}>Copy link</button>
              <button className="btn small" type="button" disabled={busy} onClick={makeLink}>New link</button>
              <button className="btn small" type="button" onClick={stopLink}>Turn off link</button>
            </div>
          </>
        ) : <div className="row"><button className="btn small primary" type="button" disabled={busy} onClick={makeLink}>🔗 Make a private link</button></div>}
      </div>
      {msg && <span className="muted" role="status" style={{ fontSize: ".88em" }}>{msg}</span>}
      <p className="muted" style={{ fontSize: ".82em" }}>Only token amounts are shown, never your wallet address. Swaps and trades are never shown.</p>
    </div>
  );
}
