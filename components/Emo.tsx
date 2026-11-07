"use client";
import { useState } from "react";

/**
 * Animated emoji (Noto Emoji animation by Google, CC BY 4.0: googlefonts.github.io/noto-emoji-animation). Falls back
 * to the plain emoji if the image can't load. Credit is shown in live rooms.
 */
const CODE: Record<string, string> = { "🔥": "1f525", "🚀": "1f680", "💎": "1f48e", "❤️": "2764_fe0f", "😂": "1f602", "👏": "1f44f", "🎉": "1f389", "🎁": "1f381", "🎙️": "1f399_fe0f", "👀": "1f440", "💯": "1f4af", "🙌": "1f64c" };
export const emoUrl = (e: string) => (CODE[e] ? `https://fonts.gstatic.com/s/e/notoemoji/latest/${CODE[e]}/512.webp` : null);

export default function Emo({ e, size = 28, className }: { e: string; size?: number; className?: string }) {
  const [bad, setBad] = useState(false);
  const url = emoUrl(e);
  if (!url || bad) return <span className={className} style={{ fontSize: size * 0.86, lineHeight: 1 }} aria-hidden="true">{e}</span>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={"emo" + (className ? ` ${className}` : "")} src={url} alt="" width={size} height={size} loading="eager" decoding="async" draggable={false} onError={() => setBad(true)} />;
}
