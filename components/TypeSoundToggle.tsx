"use client";
/** The front page's 🔊 / 🔇 button for the typing sound (bottom corner). Remembered on this device. */
import { useEffect, useState } from "react";
import { onTypeSound, setTypeSound, typeSoundOn, typeSoundReady } from "@/lib/type-sound";

export default function TypeSoundToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setOn(typeSoundOn()); setReady(typeSoundReady()); return onTypeSound((v) => { setOn(v); setReady(typeSoundReady()); }); }, []);
  if (on === null) return null;
  return (
    <button type="button" className={"type-sound" + (on && !ready ? " wait" : "")} aria-pressed={on} aria-label={on ? "Turn the typing sound off" : "Turn the typing sound on"}
      title={on ? (ready ? "Typing sound on (tap to mute)" : "Tap to hear the typing sound") : "Typing sound off"} onClick={() => { if (on && !ready) setTypeSound(true); else setTypeSound(!on); }}>
      {on ? "🔊" : "🔇"}
    </button>
  );
}
