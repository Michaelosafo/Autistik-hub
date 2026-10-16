"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AIPass from "@/components/AIPass";
import Art from "@/components/Art";
import { COMPANIONS, DRAW_RE, MOODS, isMood, type CompanionId, type Mood } from "@/lib/companions";
import { cleanSvg } from "@/lib/svg-clean";
import { useVoice } from "@/lib/voice";
import { Handwritten, WritingNote } from "@/components/Handwriting";

type Msg =
  | { kind: "me"; text: string }
  | { kind: "ai"; text: string; pending?: boolean; writing?: boolean; born?: number }
  | { kind: "img"; svg: string; title: string; request: string }
  | { kind: "drawing" }
  | { kind: "sys"; text: string };
type Turn = { role: "user" | "assistant"; content: string };

// Both speak with a natural male voice: Believer slower and heartfelt, Purity quicker and brighter.
const VOICES: Record<CompanionId, { rate: number; pitch: number }> = { believer: { rate: 0.92, pitch: 0.95 }, purity: { rate: 1.08, pitch: 1.12 } };

const MOOD_ICONS: Record<Mood, JSX.Element> = {
  okay: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1.8 2 5.2 2 7 0M9 9.5h.01M15 9.5h.01" /></svg>,
  overwhelmed: <svg viewBox="0 0 24 24"><path d="M7 18h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.5A3.3 3.3 0 0 0 7 18z" /></svg>,
  motivation: <svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
  chat: <svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>,
};

export default function CompanionChat({ signedIn, start }: { signedIn: boolean; start?: CompanionId }) {
  const [who, setWho] = useState<CompanionId>(start || "believer");
  const [msgs, setMsgs] = useState<Record<CompanionId, Msg[]>>({ believer: [], purity: [] });
  const turns = useRef<Record<CompanionId, Turn[]>>({ believer: [], purity: [] });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(false);
  const [passKey, setPassKey] = useState(0);
  const [needPass, setNeedPass] = useState(false);
  const [mood, setMood] = useState<Mood>("okay");
  const [sheet, setSheet] = useState<null | "pass" | "privacy" | "help">(null);
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const c = COMPANIONS[who];
  const voice = useVoice("companion-voice", VOICES[who]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("companion") as CompanionId | null;
      if (!start && saved && COMPANIONS[saved]) setWho(saved);
      const m = localStorage.getItem("mood"); if (isMood(m)) setMood(m);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("companion", who); } catch {} }, [who]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs, who]);

  const push = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id], m] }));
  const replaceLast = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id].slice(0, -1), m] }));
  const lowBattery = () => { try { return Number(localStorage.getItem("battery")) > 0 && Number(localStorage.getItem("battery")) <= 2; } catch { return false; } };

  function choose(id: CompanionId) { ctl.current?.abort(); voice.stopSpeaking(); setWho(id); }
  function pickMood(m: Mood) {
    if (m === mood) return;
    setMood(m);
    try { localStorage.setItem("mood", m); } catch {}
    if (msgs[who].length) push(who, { kind: "sys", text: `Mood: ${MOODS[m].label}` });
  }

  function voiceNote() {
    if (!signedIn) { push(who, { kind: "sys", text: "Please sign in to talk with Believer and Purity." }); return; }
    voice.listen((text) => send(text, true), (message) => push(who, { kind: "sys", text: message }));
  }

  async function send(text: string, spoken = false) {
    text = text.trim();
    if (!text || busy) return;
    if (!signedIn) { push(who, { kind: "sys", text: "Please sign in to talk with Believer and Purity." }); return; }
    setInput("");
    if (draw || DRAW_RE.test(text)) return makePicture(text);
    const id = who;
    push(id, { kind: "me", text });
    turns.current[id].push({ role: "user", content: text });
    push(id, { kind: "ai", text: `${COMPANIONS[id].name} is thinking…`, pending: true });
    setBusy(true);
    ctl.current = new AbortController();
    let reply = "";
    const born = Date.now(); // replies written in the last 20 seconds are shown being written out
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal,
        body: JSON.stringify({ companion: id, messages: turns.current[id], prefs: { lowBattery: lowBattery(), mood } }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        replaceLast(id, { kind: "sys", text: e.error || "Something went wrong. Try again." });
        if (e.needPass) showPass();
        turns.current[id].pop();
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        reply += dec.decode(value, { stream: true });
        replaceLast(id, { kind: "ai", text: reply, writing: true, born });
      }
      replaceLast(id, { kind: "ai", text: reply, born });
      turns.current[id].push({ role: "assistant", content: reply || "…" });
      // Voice notes get a spoken reply; typed messages too when "Read replies aloud" is on.
      if (reply && (spoken || voice.autoRead)) voice.speak(reply);
    } catch (e: any) {
      if (reply) { turns.current[id].push({ role: "assistant", content: reply }); replaceLast(id, { kind: "ai", text: reply, born }); }
      else { replaceLast(id, { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Couldn't reach the companion. Check your connection." }); turns.current[id].pop(); }
    } finally {
      setBusy(false); ctl.current = null; setPassKey((k) => k + 1);
    }
  }

  function showPass() { setNeedPass(true); setSheet("pass"); }

  async function makePicture(request: string) {
    const id = who;
    push(id, { kind: "me", text: request });
    push(id, { kind: "drawing" });
    setBusy(true);
    ctl.current = new AbortController();
    try {
      const res = await fetch("/api/draw", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal, body: JSON.stringify({ companion: id, request }) });
      const data = await res.json().catch(() => ({}));
      if (data.refusal) { replaceLast(id, { kind: "ai", text: data.refusal }); return; }
      if (!res.ok || !data.svg) { replaceLast(id, { kind: "sys", text: data.error || "That picture didn't come out right." }); if (data.needPass) showPass(); return; }
      const img = cleanSvg(data.svg);
      if (!img) { replaceLast(id, { kind: "sys", text: "That picture didn't come out right. Try describing it differently." }); return; }
      replaceLast(id, { kind: "img", svg: img.svg, title: img.title, request: request.replace(/ \(draw a new version\)$/, "") });
      turns.current[id].push({ role: "user", content: `(Asked for a picture) ${request}` }, { role: "assistant", content: `(I drew a picture: ${img.title})` });
    } catch (e: any) {
      replaceLast(id, { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Something went wrong while drawing." });
    } finally {
      setBusy(false); ctl.current = null; setPassKey((k) => k + 1);
    }
  }

  function save(svg: string, title: string, kind: "png" | "svg") {
    const name = title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40).toLowerCase() || "autistik-picture";
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const download = (href: string, file: string) => { const a = document.createElement("a"); a.href = href; a.download = file; a.click(); };
    if (kind === "svg") { download(svgUrl, name + ".svg"); return; }
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 1024;
      cv.getContext("2d")!.drawImage(img, 0, 0, 1024, 1024);
      cv.toBlob((b) => { if (b) download(URL.createObjectURL(b), name + ".png"); }, "image/png");
    };
    img.src = svgUrl;
  }

  const list = msgs[who];

  return (
    <div className="kai companions">
      <div className="card chat lux" data-c={who} data-mood={mood}>
        <div className="lux-top">
          <div className="lux-who" role="tablist" aria-label="Choose a companion">
            {(Object.keys(COMPANIONS) as CompanionId[]).map((id) => (
              <button key={id} type="button" role="tab" data-c={id} aria-selected={who === id} onClick={() => choose(id)}>
                <Art kind="robot" who={id} mood={who === id ? mood : "okay"} className="av" /><span>{COMPANIONS[id].name}</span>
              </button>
            ))}
          </div>
          <span className="lux-online"><i />AI online</span>
          {voice.canSpeak && (
            <button className="lux-icon" type="button" aria-pressed={voice.autoRead} onClick={() => voice.setRead(!voice.autoRead)}
              title={voice.autoRead ? "Replies are read aloud. Tap to turn off." : "Read replies aloud"}>
              {voice.talking ? "🔊" : voice.autoRead ? "🔉" : "🔈"}<span className="sr-only">Read replies aloud</span>
            </button>
          )}
        </div>

        <div className="msgs" ref={box} aria-live="polite">
          <div className="lux-hero" data-small={list.length > 0 ? "1" : undefined}>
            <div className="lux-ring"><Art kind="robot" who={who} mood={mood} className="lux-bot" /></div>
            <div className="lux-hello">
              <h2>Hi, I&apos;m <span className="lux-name">{c.name}</span></h2>
              <p>{MOODS[mood].line}</p>
              <span className="lux-here"><i />Always here for you</span>
            </div>
          </div>
          {list.map((m, i) => {
            if (m.kind === "me") return <div key={i} className="msg me">{m.text}</div>;
            if (m.kind === "sys") return <div key={i} className="msg sys">{m.text}</div>;
            if (m.kind === "drawing") return (
              <div key={i} className="msgrow"><Art kind="robot" who={who} mood={mood} className="av" /><div className="msg ai paper"><div className="drawing"><span>{c.name} is drawing…</span><i><b style={{ width: "60%" }} /></i></div></div></div>
            );
            if (m.kind === "img") return (
              <div key={i} className="msgrow"><Art kind="robot" who={who} mood={mood} className="av" />
                <div className="msg ai paper"><div className="genwrap">
                  <span>{m.title}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="genimg" alt={m.title} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(m.svg)} />
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn small" type="button" onClick={() => save(m.svg, m.title, "png")}>Save as PNG</button>
                    <button className="btn small" type="button" onClick={() => save(m.svg, m.title, "svg")}>Save as SVG</button>
                    <button className="btn small" type="button" disabled={busy} onClick={() => makePicture(m.request + " (draw a new version)")}>Try another</button>
                  </div>
                </div></div>
              </div>
            );
            return (
              <div key={i} className="msgrow"><Art kind="robot" who={who} mood={mood} className="av" />
                {m.pending ? <WritingNote name={c.name} /> : (
                  <Handwritten text={m.text} done={!m.writing} fresh={!!m.born && Date.now() - m.born < 20_000}
                    after={voice.canSpeak && <button className="listen" type="button" onClick={() => voice.speak(m.text)} title="Listen to this reply">▶ Listen</button>} />
                )}
              </div>
            );
          })}
          {voice.listening && <div className="msg me listening">🎙️ {voice.heard || "Listening… speak now"}</div>}
        </div>

        <div className="lux-moods" role="radiogroup" aria-label="How are you feeling?">
          {(Object.keys(MOODS) as Mood[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={mood === k} data-m={k} onClick={() => pickMood(k)}>
              {MOOD_ICONS[k]}<span>{MOODS[k].label}</span>
            </button>
          ))}
        </div>
        <form className="lux-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <button className="lux-plus" type="button" aria-pressed={draw} onClick={() => setDraw(!draw)} title={draw ? "Picture mode is on: describe what to draw" : "Make a picture"}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg><span className="sr-only">Make a picture</span>
          </button>
          <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={!signedIn ? "Sign in to chat" : draw ? `Describe a picture for ${c.name} to draw…` : "Write a message…"} aria-label={`Message ${c.name}`}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
          {voice.canListen && (
            <button className={"lux-mic" + (voice.listening ? " rec" : "")} type="button" aria-pressed={voice.listening} onClick={voiceNote} disabled={busy}
              title={voice.listening ? "Stop and send" : "Send a voice note"}>
              {voice.listening ? <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg> : <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
              <span className="sr-only">{voice.listening ? "Stop and send" : "Send a voice note"}</span>
            </button>
          )}
          {busy
            ? <button className="lux-send" type="button" onClick={() => ctl.current?.abort()} title="Stop"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg><span className="sr-only">Stop</span></button>
            : <button className="lux-send" type="submit" title="Send"><svg viewBox="0 0 24 24"><path d="M4 12 20 4l-6 16-3-7z" /><path d="m11 13 9-9" /></svg><span className="sr-only">Send</span></button>}
        </form>
        <div className="lux-chips">
          {signedIn
            ? <button type="button" onClick={() => setSheet("pass")} data-hot={needPass ? "1" : undefined}>🎟️ AI Pass</button>
            : <Link href="/login?next=/companions">🔑 Sign in to chat</Link>}
          <button type="button" onClick={() => setSheet("privacy")}>🔒 Privacy</button>
          <button type="button" onClick={() => setSheet("help")}>🆘 Help now</button>
        </div>
      </div>

      {sheet && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet stack" role="dialog" aria-modal="true" aria-label={sheet === "pass" ? "AI Pass" : sheet === "privacy" ? "Privacy" : "Help now"} onClick={(e) => e.stopPropagation()}>
            <button className="sheet-x" type="button" onClick={() => setSheet(null)} aria-label="Close">✕</button>
            {sheet === "pass" && <AIPass refreshKey={passKey} highlight={needPass} onPaid={() => { setNeedPass(false); setSheet(null); }} />}
            {sheet === "privacy" && (
              <div className="card stack">
                <h3>🔒 Privacy</h3>
                <p className="muted">Chats aren&apos;t saved on our servers. Voice notes are turned into text by your browser and aren&apos;t recorded.</p>
                <div className="row"><button className="btn small" type="button" onClick={() => { ctl.current?.abort(); voice.stopSpeaking(); turns.current[who] = []; setMsgs((a) => ({ ...a, [who]: [] })); setSheet(null); }}>Clear this chat</button></div>
              </div>
            )}
            {sheet === "help" && (
              <div className="card stack">
                <h3>🆘 In danger right now?</h3>
                <p>Call your local emergency number now, or find a free crisis line in your country at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</p>
                <p className="muted">Believer and Purity are AIs, not doctors or therapists. Please also reach out to someone you trust.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
