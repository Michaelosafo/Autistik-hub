"use client";
import { useEffect, useState } from "react";

/** A "Watch how" button: the walkthrough video opens in a window only when asked for (nothing loads before). */
export default function VideoButton({ label, title, src, poster, captions, minutes }: { label: string; title: string; src: string; poster: string; captions: string; minutes: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open]);
  return (
    <>
      <button type="button" className="ln-watch" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
        {label}<small>{minutes} min</small>
      </button>
      {open && (
        <div className="vb-bg" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="vb">
            <div className="vb-h"><b>{title}</b><button type="button" className="mp-x" aria-label="Close the video" onClick={() => setOpen(false)}>✕</button></div>
            <video controls autoPlay playsInline poster={poster}>
              <source src={src} type="video/mp4" />
              <track kind="captions" src={captions} srcLang="en" label="English" default />
              Your browser can&apos;t play this video.
            </video>
            <small className="muted">Captions are on. {minutes} minutes.</small>
          </div>
        </div>
      )}
    </>
  );
}
