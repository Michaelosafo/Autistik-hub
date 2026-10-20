"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** How a voice sounds: speed and pitch (1 = normal). */
export type VoiceStyle = { rate?: number; pitch?: number };

// The most natural-sounding male English voices that browsers ship, best first. Edge's "Online (Natural)"
// voices and Apple's Enhanced/Premium voices are neural and sound close to a real person.
const MALE_VOICES: RegExp[] = [
  /\b(Andrew|Brian|Christopher|Guy|Eric|Roger|Steffan|Davis|Tony|Jason|Ryan|Thomas|William|Liam|Connor|Kenji)\b.*(Natural|Online|Neural)/i,
  /\b(Daniel|Arthur|Aaron|Oliver|Evan|Nathan|Reed|Tom|Alex|Rishi|Gordon|Lee|Fred)\b.*(Premium|Enhanced)/i,
  /Google UK English Male/i,
  /\b(Daniel|Arthur|Aaron|Oliver|Evan|Nathan|Reed|Tom|Alex|Rishi|Gordon|Lee)\b/i,
  /\b(David|Mark|George|James|Richard|Sean|Ravi)\b/i,
  /\bmale\b/i,
];

/** Picks the most natural male English voice on this device, or null if it has none. */
export function pickMaleVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => /^en/i.test(v.lang) && !/female|woman|girl/i.test(v.name));
  for (const re of MALE_VOICES) {
    const hits = en.filter((v) => re.test(v.name));
    // Prefer the person's own accent (e.g. en-GB) when there is a choice.
    const local = hits.find((v) => v.lang.toLowerCase() === (navigator.language || "").toLowerCase());
    if (local || hits[0]) return local || hits[0];
  }
  return null;
}

/** Sets up an utterance with a natural male voice. Pitch is only lowered when the device has no male voice. */
export function maleUtterance(text: string, rate = 0.97, pitch = 1): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(forSpeech(text));
  const v = pickMaleVoice(window.speechSynthesis.getVoices());
  u.rate = rate;
  if (v) { u.voice = v; u.lang = v.lang; u.pitch = pitch; }
  else { u.pitch = 0.8 * pitch; } // no male voice installed: deepen the default one a little
  return u;
}

/** Makes text sound natural when read out: links, wallet addresses and markdown symbols are skipped. */
function forSpeech(text: string) {
  return text
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/0x[0-9a-fA-F]{6,}/g, "the address")
    .replace(/[*_#`>~|]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "");
}

/**
 * Voice for the AI chats, using the browser's own speech features (no extra cost, nothing stored):
 * - speak(): reads a reply out loud
 * - listen(): turns what the person says into text (voice note); calls onText with the final words
 * `storageKey` remembers whether "read replies aloud" is on.
 */
export function useVoice(storageKey: string, style: VoiceStyle = {}) {
  const [canSpeak, setCanSpeak] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [talking, setTalking] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const rec = useRef<any>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  useEffect(() => {
    setCanSpeak("speechSynthesis" in window);
    setCanListen(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
    try { setAutoRead(localStorage.getItem(storageKey) === "on"); } catch {}
    // Some browsers load their voice list late; ask early so the male voice is ready on the first reply.
    try { window.speechSynthesis?.getVoices(); window.speechSynthesis?.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices()); } catch {}
    return () => { try { window.speechSynthesis?.cancel(); rec.current?.abort(); } catch {} };
  }, [storageKey]);

  const stopSpeaking = useCallback(() => { try { window.speechSynthesis?.cancel(); } catch {} setTalking(false); }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = maleUtterance(text, styleRef.current.rate ?? 0.97, styleRef.current.pitch ?? 1);
    u.onstart = () => setTalking(true);
    u.onend = u.onerror = () => setTalking(false);
    synth.speak(u);
  }, []);

  const setRead = useCallback((on: boolean) => {
    setAutoRead(on);
    try { localStorage.setItem(storageKey, on ? "on" : "off"); } catch {}
    if (!on) stopSpeaking();
  }, [storageKey, stopSpeaking]);

  /** Starts (or stops) a voice note. Live words go to `heard`; the finished words go to onText. */
  const listen = useCallback((onText: (text: string) => void, onError?: (message: string) => void) => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (rec.current && listening) { rec.current.stop(); return; }
    stopSpeaking();
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    let text = "";
    r.onresult = (e: any) => { text = Array.from(e.results).map((x: any) => x[0].transcript).join(" ").trim(); setHeard(text); };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") onError?.("Allow microphone access in your browser to send voice notes.");
      else if (e.error === "no-speech") onError?.("I didn't hear anything. Tap the microphone and try again.");
    };
    r.onend = () => { setListening(false); setHeard(""); rec.current = null; if (text) onText(text); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  }, [listening, stopSpeaking]);

  return { canSpeak, canListen, autoRead, setRead, talking, listening, heard, speak, stopSpeaking, listen };
}
