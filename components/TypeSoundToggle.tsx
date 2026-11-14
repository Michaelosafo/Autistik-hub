"use client";
/** The front page's 🔊 / 🔇 button for the typing sound (bottom corner). Remembered on this device. */
import { useEffect, useState } from "react";
import { onTypeSound, setTypeSound, typeSoundOn } from "@/lib/type-sound";

export default function TypeSoundToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { setOn(typeSoundOn()); return onTypeSound(setOn); }, []);
  if (on === null) return null;
  return (
    <button type="button" className="type-sound" aria-pressed={on} aria-label={on ? "Turn the typing sound off" : "Turn the typing sound on"}
      title={on ? "Typing sound on (tap to mute)" : "Typing sound off"} onClick={() => setTypeSound(!on)}>
      {on ? "🔊" : "🔇"}
    </button>
  );
}
