"use client";
import { useEffect, useRef, useState } from "react";
import Ctl from "./Ctl";

type Out = { id: string; label: string };
const canPick = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
/** How much louder the loudspeaker makes the room (with a limiter so loud voices don't crackle). */
const BOOST = 2.6;

/**
 * Loudspeaker for the live, like on a phone call: one tap and the room plays out loud and much louder (the voices are
 * boosted through Web Audio with a limiter, and sent to the loudspeaker output where the browser lets us pick it).
 * The ▾ menu picks another output (earpiece, headphones, Bluetooth) where supported, turns sound off, and sets the
 * volume. On iPhone the output can't be picked by a website, so it says how to switch in Control Centre.
 */
export default function SpeakerOut({ audios }: { audios: () => HTMLAudioElement[] }) {
  const [loud, setLoud] = useState(false);
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(1);
  const [sink, setSink] = useState("");
  const [outs, setOuts] = useState<Out[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const ctx = useRef<AudioContext | null>(null);
  const gain = useRef<GainNode | null>(null);
  const srcs = useRef(new Map<HTMLAudioElement, { node: MediaStreamAudioSourceNode; stream: MediaStream }>());
  const st = useRef({ loud, on, vol, sink });
  st.current = { loud, on, vol, sink };

  /** Builds the loudspeaker chain once: voices → gain (boost) → limiter → speaker. */
  function chain() {
    if (!ctx.current) {
      const c = new (window.AudioContext || (window as any).webkitAudioContext)();
      const g = c.createGain();
      const lim = c.createDynamicsCompressor();
      lim.threshold.value = -10; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.2;
      g.connect(lim); lim.connect(c.destination);
      ctx.current = c; gain.current = g;
    }
    if (ctx.current.state === "suspended") ctx.current.resume().catch(() => {});
    return ctx.current;
  }

  // Applied to every voice now, and to new voices as people join (checked every second).
  useEffect(() => {
    const apply = () => {
      const { loud, on, vol, sink } = st.current;
      const list = audios();
      if (loud && on) {
        const c = chain();
        gain.current!.gain.value = BOOST * vol;
        const cs = c as any;
        if (typeof cs.setSinkId === "function" && cs.sinkId !== sink) cs.setSinkId(sink).catch(() => {});
        for (const a of list) {
          const stream = a.srcObject as MediaStream | null;
          if (!stream || !stream.getAudioTracks().length) continue;
          const cur = srcs.current.get(a);
          if (cur?.stream === stream) continue;
          try { cur?.node.disconnect(); } catch {}
          try { const node = c.createMediaStreamSource(stream); node.connect(gain.current!); srcs.current.set(a, { node, stream }); } catch { continue; }
          // The element keeps playing (Chrome needs that for the stream to flow) but silent: the sound comes from the chain.
          a.muted = true;
        }
        for (const [a, s] of srcs.current) if (!list.includes(a)) { try { s.node.disconnect(); } catch {} srcs.current.delete(a); }
      } else {
        for (const [, s] of srcs.current) { try { s.node.disconnect(); } catch {} }
        srcs.current.clear();
        for (const a of list) {
          a.muted = !on;
          a.volume = vol;
          if (canPick() && (a as any).sinkId !== sink) (a as any).setSinkId(sink).catch(() => {});
        }
      }
    };
    apply();
    const t = setInterval(apply, 1000);
    return () => clearInterval(t);
  }, [loud, on, vol, sink, audios]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { ctx.current?.close().catch(() => {}); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (!open || !canPick()) return;
    navigator.mediaDevices?.enumerateDevices().then((all) => setOuts(all.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` })))).catch(() => setOuts([]));
  }, [open]);

  function toggleLoud() {
    const next = !loud;
    if (next || !on) {
      chain(); // started from the tap, so phones allow the sound
      // Prefer an output named "speaker" when the browser lists one.
      const sp = outs.find((o) => /speaker|haut-parleur|altavoz/i.test(o.label) && !/headphone|ear|bluetooth/i.test(o.label));
      if (sp) setSink(sp.id);
      setOn(true);
    }
    setLoud(!on ? true : next);
  }

  const ios = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <div className="spk" ref={box}>
      <Ctl icon={!on ? "speakerOff" : loud ? "speaker" : "speakerLow"} label={!on ? "Muted" : "Speaker"} on={loud && on} tone={loud && on ? "green" : !on ? "red" : undefined} onClick={toggleLoud} pressed={loud && on} title={loud ? "Loudspeaker on: tap for normal" : "Tap for loudspeaker"} />
      <button type="button" className="spk-more" aria-label="Sound options" aria-expanded={open} onClick={() => setOpen((o) => !o)}>▾</button>
      {open && (
        <div className="spk-pop" role="dialog" aria-label="Sound output">
          <b>Sound</b>
          <button type="button" className={"spk-opt" + (loud && on ? " sel" : "")} onClick={() => { if (!loud) toggleLoud(); setOn(true); }}>📢 Loudspeaker (extra loud)</button>
          <button type="button" className={"spk-opt" + (!loud && on && !sink ? " sel" : "")} onClick={() => { setLoud(false); setSink(""); setOn(true); }}>🔈 Normal</button>
          {canPick() && outs.map((o) => (
            <button key={o.id} type="button" className={"spk-opt" + (on && sink === o.id ? " sel" : "")} onClick={() => { setSink(o.id); setOn(true); }}>
              {/bluetooth|airpods|buds|headphone|headset|ear/i.test(o.label) ? "🎧" : "🔈"} {o.label}
            </button>
          ))}
          <button type="button" className={"spk-opt" + (!on ? " sel" : "")} onClick={() => setOn((x) => !x)}>{on ? "🔇 Turn sound off" : "🔊 Turn sound on"}</button>
          <label className="spk-vol"><small>Volume</small>
            <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { setVol(Number(e.target.value)); setOn(true); }} aria-label="Volume" />
          </label>
          {!canPick() && <small className="spk-tip">{ios ? "On iPhone, use Control Centre (the AirPlay button) to switch between the loudspeaker, AirPods and Bluetooth." : "To switch to headphones or Bluetooth, use your phone or computer's sound settings."}</small>}
        </div>
      )}
    </div>
  );
}
