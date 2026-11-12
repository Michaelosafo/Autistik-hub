"use client";
import type { ReactNode } from "react";

/** Line icons for the live room controls (24×24, drawn with currentColor). */
const I: Record<string, ReactNode> = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  micOff: <><path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18" /></>,
  hand: <><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 15.6L3.2 12a1.5 1.5 0 0 1 2.6-1.3L8 13" /></>,
  speaker: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  speakerLow: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  speakerOff: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6M21 9l-5 6" /></>,
  cam: <><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></>,
  camOff: <><path d="M15.5 13.5V8.5A2.5 2.5 0 0 0 13 6H8M2.5 8.5v7A2.5 2.5 0 0 0 5 18h8.5M15.5 10.5l6-3.5v10M3 3l18 18" /></>,
  rec: <><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.4" fill="currentColor" stroke="none" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
  rocket: <><path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5z" /><circle cx="15" cy="9" r="1.5" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  chat: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.7A8 8 0 1 1 21 12z" />,
  leave: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" /></>,
  end: <path d="M3 13.5c5-4.7 13-4.7 18 0l-2.3 2.6-3.4-1.6v-2.6a12 12 0 0 0-6.6 0v2.6l-3.4 1.6z" fill="currentColor" stroke="none" />,
};

/** A small round control with a tiny label underneath, like a phone call screen. */
export default function Ctl({ icon, label, on, tone, onClick, href, pressed, title }: {
  icon: keyof typeof I | string; label: string; on?: boolean; tone?: "red" | "green" | "gold"; onClick?: () => void; href?: string; pressed?: boolean; title?: string;
}) {
  const cls = "ctl" + (on ? " on" : "") + (tone ? ` ${tone}` : "");
  const body = (
    <>
      <span className="ctl-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{I[icon]}</svg></span>
      <small>{label}</small>
    </>
  );
  return href
    ? <a className={cls} href={href} target="_blank" rel="noopener" title={title || label}>{body}</a>
    : <button type="button" className={cls} onClick={onClick} aria-pressed={pressed} title={title || label}>{body}</button>;
}

/**
 * The mic: small and alive. Muted it's dark glass with a red slash; live it turns gold with a soft ring that breathes,
 * and three level bars that dance while your voice is picked up.
 */
export function MicBtn({ muted, talking, onClick }: { muted: boolean; talking: boolean; onClick: () => void }) {
  return (
    <button type="button" className={"mic" + (muted ? " off" : " live") + (talking && !muted ? " talk" : "")} onClick={onClick} aria-pressed={!muted} title={muted ? "Unmute" : "Mute"}>
      <span className="mic-core" aria-hidden="true">
        <i className="mic-ring" />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{muted ? I.micOff : I.mic}</svg>
        {!muted && <span className="mic-lv"><b /><b /><b /></span>}
      </span>
      <small>{muted ? "Unmute" : talking ? "Speaking" : "Live"}</small>
    </button>
  );
}
