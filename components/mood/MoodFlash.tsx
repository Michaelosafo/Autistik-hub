"use client";
/**
 * A member's mood sticker on their profile picture for 5 hours after they pick it. It flashes in, holds a moment,
 * fades away, and comes back every few seconds, until the 5 hours are up.
 */
import { useEffect, useState } from "react";
import { MoodSticker, stickerOf } from "./MoodStickers";

export default function MoodFlash({ mood, until, size = 22 }: { mood?: string | null; until?: string | null; size?: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const live = () => !!mood && !!until && Date.parse(until) > Date.now() && !!stickerOf(mood);
    setOn(live());
    if (!live()) return;
    const t = setInterval(() => setOn(live()), 60_000);
    return () => clearInterval(t);
  }, [mood, until]);
  if (!on || !mood) return null;
  return <span className="moodflash" title={`Feeling: ${stickerOf(mood)!.label}`} aria-label={`Feeling: ${stickerOf(mood)!.label}`}><MoodSticker k={mood} size={size} /></span>;
}
