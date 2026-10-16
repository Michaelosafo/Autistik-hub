"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import AIPass from "@/components/AIPass";
import Art from "@/components/Art";
import { COMPANIONS, DRAW_RE, type CompanionId } from "@/lib/companions";
import { cleanSvg } from "@/lib/svg-clean";
import { useVoice } from "@/lib/voice";

type Msg =
  | { kind: "me"; text: string }
  | { kind: "ai"; text: string; pending?: boolean }
  | { kind: "img"; svg: string; title: string; request: string }
  | { kind: "drawing" }
  | { kind: "sys"; text: string };
type Turn = { role: "user" | "assistant"; content: string };

// Both speak with a natural male voice: Believer slower and heartfelt, Purity quicker and brighter.
const VOICES: Record<CompanionId, { rate: number; pitch: number }> = { believer: { rate: 0.92, pitch: 0.95 }, purity: { rate: 1.08, pitch: 1.12 } };

export default function CompanionChat({ signedIn, start }: { signedIn: boolean; start?: CompanionId }) {
  const [who, setWho] = useState<CompanionId>(start || "believer");
  const [msgs, setMsgs] = useState<Record<CompanionId, Msg[]>>({ believer: [], purity: [] });
  const turns = useRef<Record<CompanionId, Turn[]>>({ believer: [], purity: [] });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(false);
  const [passKey, setPassKey] = useState(0);
  const [needPass, setNeedPass] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const c = COMPANIONS[who];
  const voice = useVoice("companion-voice", VOICES[who]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("companion") as CompanionId | null;
      if (!start && saved && COMPANIONS[saved]) setWho(saved);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("companion", who); } catch {} }, [who]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs, who]);

  const push = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id], m] }));
  const replaceLast = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id].slice(0, -1), m] }));
  const lowBattery = () => { try { return Number(localStorage.getItem("battery")) > 0 && Number(localStorage.getItem("battery")) <= 2; } catch { return false; } };

  function choose(id: CompanionId) { ctl.current?.abort(); voice.stopSpeaking(); setWho(id); }

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
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal,
        body: JSON.stringify({ companion: id, messages: turns.current[id], prefs: { lowBattery: lowBattery() } }),
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
        replaceLast(id, { kind: "ai", text: reply });
      }
      turns.current[id].push({ role: "assistant", content: reply || "…" });
      // Voice notes get a spoken reply; typed messages too when "Read replies aloud" is on.
      if (reply && (spoken || voice.autoRead)) voice.speak(reply);
    } catch (e: any) {
      if (reply) turns.current[id].push({ role: "assistant", content: reply });
      else { replaceLast(id, { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Couldn't reach the companion. Check your connection." }); turns.current[id].pop(); }
    } finally {
      setBusy(false); ctl.current = null; setPassKey((k) => k + 1);
    }
  }

  function showPass() {
    setNeedPass(true);
    setTimeout(() => document.getElementById("ai-pass")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

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
      <div className="card chat" data-c={who}>
        <div className="chat-head">
          <div className="who-switch" role="tablist" aria-label="Choose a companion">
            {(Object.keys(COMPANIONS) as CompanionId[]).map((id) => (
              <button key={id} type="button" role="tab" data-c={id} aria-selected={who === id} onClick={() => choose(id)}>
                <Art kind={id} className="av" /><span><b>{COMPANIONS[id].name}</b><small>{COMPANIONS[id].tagline}</small></span>
              </button>
            ))}
          </div>
          {voice.canSpeak && (
            <button className="icon-btn" type="button" aria-pressed={voice.autoRead} onClick={() => voice.setRead(!voice.autoRead)}
              title={voice.autoRead ? "Replies are read aloud. Click to turn off." : "Read replies aloud"}>
              {voice.talking ? "🔊" : voice.autoRead ? "🔉" : "🔈"}<span className="sr-only">Read replies aloud</span>
            </button>
          )}
        </div>

        <div className="msgs" ref={box} aria-live="polite">
          <div className="msgrow"><Art kind={who} className="av" /><div className="msg ai">{c.hello}</div></div>
          {list.map((m, i) => {
            if (m.kind === "me") return <div key={i} className="msg me">{m.text}</div>;
            if (m.kind === "sys") return <div key={i} className="msg sys">{m.text}</div>;
            if (m.kind === "drawing") return (
              <div key={i} className="msgrow"><Art kind={who} className="av" /><div className="msg ai"><div className="drawing"><span>{c.name} is drawing…</span><i><b style={{ width: "60%" }} /></i></div></div></div>
            );
            if (m.kind === "img") return (
              <div key={i} className="msgrow"><Art kind={who} className="av" />
                <div className="msg ai"><div className="genwrap">
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
              <div key={i} className="msgrow"><Art kind={who} className="av" />
                <div className={"msg ai" + (m.pending ? " muted" : "")}>
                  {m.text}
                  {!m.pending && voice.canSpeak && <button className="listen" type="button" onClick={() => voice.speak(m.text)} title="Listen to this reply">▶ Listen</button>}
                </div>
              </div>
            );
          })}
          {voice.listening && <div className="msg me listening">🎙️ {voice.heard || "Listening… speak now"}</div>}
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
          <button className="icon-btn" id="kaiDraw" type="button" aria-pressed={draw} onClick={() => setDraw(!draw)} title={draw ? "Picture mode is on: describe what to draw" : "Make a picture"}>🖼️<span className="sr-only">Make a picture</span></button>
          <textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={!signedIn ? "Sign in to chat" : draw ? `Describe the picture for ${c.name} to draw…` : `Message ${c.name}…`} aria-label={`Message ${c.name}`}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
          {voice.canListen && (
            <button className={"icon-btn" + (voice.listening ? " rec" : "")} type="button" aria-pressed={voice.listening} onClick={voiceNote} disabled={busy}
              title={voice.listening ? "Stop and send" : "Send a voice note"}>{voice.listening ? "⏹" : "🎤"}<span className="sr-only">{voice.listening ? "Stop and send" : "Send a voice note"}</span></button>
          )}
          {busy ? <button className="btn" type="button" onClick={() => ctl.current?.abort()}>Stop</button> : <button className="btn c" type="submit">Send</button>}
        </form>
      </div>

      <div className="stack side">
        {!signedIn && <div className="notice warn"><Link href="/login?next=/companions">Sign in</Link> or <Link href="/login?mode=join&next=/companions">create a free account</Link> to chat.</div>}
        {signedIn && <AIPass refreshKey={passKey} highlight={needPass} onPaid={() => setNeedPass(false)} />}
        <div className="card stack" style={{ fontSize: ".86em", gap: 8 }}>
          <b>Privacy</b>
          <p className="muted">Chats aren&apos;t saved on our servers. Voice notes are turned into text by your browser and aren&apos;t recorded.</p>
          <button className="btn small" type="button" onClick={() => { ctl.current?.abort(); voice.stopSpeaking(); turns.current[who] = []; setMsgs((a) => ({ ...a, [who]: [] })); }}>Clear this chat</button>
        </div>
        <p className="notice alert" style={{ fontSize: ".82em" }}><b>In danger right now?</b> Call your local emergency number, or find a free crisis line at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</p>
      </div>
    </div>
  );
}
