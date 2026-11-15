/** Tik text with links: web links open, @username goes to the profile, #tags and $COINS are highlighted. */
import Link from "next/link";
import { Fragment } from "react";
import { MoodSticker, STICKERS } from "./MoodStickers";

const ST = new Set<string>(STICKERS.map((s) => s.key));

const RX = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])|(@[a-z0-9_]{3,30})|(#[\p{L}0-9_]{2,40})|(\$[A-Za-z][A-Za-z0-9]{1,11}\b)|(:[a-z]{2,12}:)/giu;

export default function RichText({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let last = 0, k = 0;
  for (const m of text.matchAll(RX)) {
    const i = m.index ?? 0;
    if (i > last) out.push(<Fragment key={k++}>{text.slice(last, i)}</Fragment>);
    const s = m[0];
    if (m[1]) out.push(<a key={k++} className="rt-link" href={s} target="_blank" rel="noopener noreferrer nofollow ugc">{s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}{s.length > 48 ? "…" : ""}</a>);
    else if (m[2]) out.push(<Link key={k++} className="rt-at" href={`/@${s.slice(1).toLowerCase()}`}>{s}</Link>);
    else if (m[3]) out.push(<span key={k++} className="rt-tag">{s}</span>);
    else if (m[5]) {
      const key = s.slice(1, -1).toLowerCase();
      // A message that is just one sticker shows it big; inside text it's small, like an emoji.
      if (ST.has(key)) out.push(<span key={k++} className={"rt-st" + (text.trim() === s ? " solo" : "")} title={STICKERS.find((x) => x.key === key)?.label}><MoodSticker k={key} size={text.trim() === s ? 56 : 22} /></span>);
      else out.push(<Fragment key={k++}>{s}</Fragment>);
    }
    else out.push(<span key={k++} className="rt-coin">{s.toUpperCase()}</span>);
    last = i + s.length;
  }
  if (last < text.length) out.push(<Fragment key={k++}>{text.slice(last)}</Fragment>);
  return <>{out}</>;
}
