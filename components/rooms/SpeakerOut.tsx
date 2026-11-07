"use client";
import { useEffect, useRef, useState } from "react";

type Out = { id: string; label: string };
const canPick = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

/**
 * Where the live's sound comes out: the phone's loudspeaker, the earpiece, headphones or Bluetooth, plus sound
 * on/off and volume. Choosing the output works where the browser allows it (Chrome and Edge on Android and computers);
 * on iPhone, sound always plays through the loudspeaker or whatever is connected, so it shows a tip instead.
 */
export default function SpeakerOut({ audios }: { audios: () => HTMLAudioElement[] }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(1);
  const [sink, setSink] = useState("");
  const [outs, setOuts] = useState<Out[]>([]);
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const state = useRef({ on, vol, sink });
  state.current = { on, vol, sink };

  // Apply to every voice in the room now, and to new ones as they join (checked every second).
  useEffect(() => {
    const apply = () => audios().forEach((a) => {
      a.muted = !state.current.on;
      a.volume = state.current.vol;
      const s = state.current.sink;
      if (canPick() && (a as any).sinkId !== s) (a as any).setSinkId(s).catch(() => {});
    });
    apply();
    const t = setInterval(apply, 1000);
    return () => clearInterval(t);
  }, [on, vol, sink, audios]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function list() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setOuts(all.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })));
    } catch { setOuts([]); }
  }
  useEffect(() => { if (open && canPick()) list(); }, [open]);

  /** Loudspeaker: the output whose name says speaker, else the device's normal output (which is the loudspeaker on phones). */
  function loud() {
    const sp = outs.find((o) => /speaker|haut-parleur|altavoz/i.test(o.label) && !/headphone|ear|bluetooth/i.test(o.label));
    setSink(sp?.id || ""); setOn(true); setVol(1);
    setNote("🔊 Playing through the loudspeaker.");
  }

  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div className="spk" ref={box}>
      <button type="button" className={"room-btn" + (on ? " on" : "")} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{on ? "🔊 Speaker" : "🔇 Sound off"}</button>
      {open && (
        <div className="spk-pop" role="dialog" aria-label="Sound output">
          <b>Sound</b>
          <button type="button" className={"spk-opt" + (on && !sink ? " sel" : "")} onClick={loud}>🔊 Loudspeaker</button>
          {canPick() && outs.map((o) => (
            <button key={o.id} type="button" className={"spk-opt" + (on && sink === o.id ? " sel" : "")} onClick={() => { setSink(o.id); setOn(true); setNote(""); }}>
              {/bluetooth|airpods|buds/i.test(o.label) ? "🎧" : /headphone|headset|ear/i.test(o.label) ? "🎧" : "🔈"} {o.label}
            </button>
          ))}
          <button type="button" className={"spk-opt" + (!on ? " sel" : "")} onClick={() => setOn((x) => !x)}>{on ? "🔇 Turn sound off" : "🔊 Turn sound on"}</button>
          <label className="spk-vol"><small>Volume</small>
            <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { setVol(Number(e.target.value)); setOn(true); }} aria-label="Volume" />
          </label>
          {!canPick() && <small className="spk-tip">{ios ? "On iPhone, sound comes out of the loudspeaker. To switch to AirPods or Bluetooth, use Control Centre (the 🔊 AirPlay button)." : "To switch to headphones or Bluetooth, use your phone or computer's sound settings."}</small>}
          {note && <small className="spk-tip">{note}</small>}
        </div>
      )}
    </div>
  );
}
