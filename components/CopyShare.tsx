"use client";
import { useState } from "react";

/** Copy a link (or a snippet) and share it on X / Telegram. */
export default function CopyShare({ url, text, snippet }: { url: string; text: string; snippet?: string }) {
  const [done, setDone] = useState("");
  const copy = async (v: string, what: string) => {
    try { await navigator.clipboard.writeText(v); setDone(`${what} copied`); } catch { setDone("Couldn't copy: select and copy it by hand."); }
    setTimeout(() => setDone(""), 2500);
  };
  const enc = encodeURIComponent;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn small primary" onClick={() => copy(url, "Link")}>🔗 Copy link</button>
        <a className="btn small" href={`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer">Post on X</a>
        <a className="btn small" href={`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`} target="_blank" rel="noopener noreferrer">Share on Telegram</a>
        {snippet && <button type="button" className="btn small" onClick={() => copy(snippet, "Badge code")}>🏷️ Copy badge for your website</button>}
      </div>
      {done && <small className="muted" role="status">{done}</small>}
    </div>
  );
}
