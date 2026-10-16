"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** How a voice sounds: Believer is brighter, Purity slower and calmer. */
export type VoiceStyle = { rate?: number; pitch?: number };

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
    // Some browsers load their voice list late.
    try { window.speechSynthesis?.getVoices(); } catch {}
    return () => { try { window.speechSynthesis?.cancel(); rec.current?.abort(); } catch {} };
  }, [storageKey]);

  const stopSpeaking = useCallback(() => { try { window.speechSynthesis?.cancel(); } catch {} setTalking(false); }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(forSpeech(text));
    u.rate = styleRef.current.rate ?? 0.95;
    u.pitch = styleRef.current.pitch ?? 1;
    const voices = synth.getVoices();
    const v = voices.find((x) => /^en/i.test(x.lang) && /female|samantha|aria|zira|jenny|google us|google uk english female/i.test(x.name)) || voices.find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
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
