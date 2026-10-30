"use client";
/**
 * The AI chat, laid out like a modern assistant app:
 *  - left: New chat, Believer / Purity, recent chats (kept on this device only), Pass, Privacy, Help, read aloud
 *  - middle: one big conversation column
 *  - bottom: one large composer (type on top; picture, voice note and send underneath)
 * On phones the left column slides in from the ☰ button.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AIPass from "@/components/AIPass";
import Art from "@/components/Art";
import { COMPANIONS, DRAW_RE, type CompanionId, type Mood } from "@/lib/companions";
import { cleanSvg } from "@/lib/svg-clean";
import { useVoice } from "@/lib/voice";
import { Handwritten, WritingNote } from "@/components/Handwriting";
import { useStickToBottom } from "@/lib/use-stick-bottom";

type Msg =
  | { kind: "me"; text: string }
  | { kind: "ai"; text: string; pending?: boolean; writing?: boolean; born?: number }
  | { kind: "img"; svg: string; title: string; request: string }
  | { kind: "drawing" }
  | { kind: "sys"; text: string };
type Turn = { role: "user" | "assistant"; content: string };
type Conv = { id: string; who: CompanionId; title: string; at: number; msgs: Msg[]; turns: Turn[] };

// Both speak with a natural male voice: Believer slower and heartfelt, Purity quicker and brighter.
const VOICES: Record<CompanionId, { rate: number; pitch: number }> = { believer: { rate: 0.92, pitch: 0.95 }, purity: { rate: 1.08, pitch: 1.12 } };
const STORE = "companion-chats-v1";
const KEEP = 30;
const STARTERS: [string, string][] = [
  ["Plan my day", "Can you help me plan my day in small, easy steps?"],
  ["Explain a situation", "Can you help me understand a social situation that confused me?"],
  ["I feel overwhelmed", "I feel overwhelmed right now. Can you help me calm down?"],
  ["Draw a picture", ""],
];

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const blank = (who: CompanionId): Conv => ({ id: newId(), who, title: "New chat", at: Date.now(), msgs: [], turns: [] });
const titleOf = (text: string) => { const t = text.replace(/\s+/g, " ").trim(); return t.length > 42 ? t.slice(0, 40) + "…" : t || "New chat"; };
const when = (ms: number) => {
  const d = Date.now() - ms;
  if (d < 60_000) return "now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
};

export default function CompanionChat({ signedIn, start }: { signedIn: boolean; start?: CompanionId }) {
  const [convs, setConvs] = useState<Conv[]>(() => [blank(start || "believer")]);
  const [active, setActive] = useState<string>(() => convs[0].id);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(false);
  const [passKey, setPassKey] = useState(0);
  const [needPass, setNeedPass] = useState(false);
  const [side, setSide] = useState(false);
  const mood: Mood = "okay";
  const [sheet, setSheet] = useState<null | "pass" | "privacy" | "help">(null);
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const loaded = useRef(false);

  const conv = convs.find((x) => x.id === active) ?? convs[0];
  const who = conv.who;
  const c = COMPANIONS[who];
  const voice = useVoice("companion-voice", VOICES[who]);

  // Recent chats live only in this browser (never on our servers).
  useEffect(() => {
    try {
      const saved: Conv[] = JSON.parse(localStorage.getItem(STORE) || "[]");
      const last = localStorage.getItem("companion") as CompanionId | null;
      const ok = Array.isArray(saved) ? saved.filter((x) => x && COMPANIONS[x.who] && Array.isArray(x.msgs)) : [];
      const first = blank(start || (last && COMPANIONS[last] ? last : "believer"));
      setConvs([first, ...ok]);
      setActive(first.id);
    } catch {}
    loaded.current = true;
  }, []);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      const keep = convs.filter((x) => x.msgs.length).slice(0, KEEP)
        .map((x) => ({ ...x, msgs: x.msgs.filter((m) => m.kind !== "drawing" && !(m.kind === "ai" && m.pending)).map((m) => (m.kind === "ai" ? { kind: "ai", text: m.text } : m)) }));
      localStorage.setItem(STORE, JSON.stringify(keep));
      localStorage.setItem("companion", who);
    } catch {}
  }, [convs, who]);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);
  useStickToBottom(box, [active]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [conv.msgs.length, active]);
  // The composer grows with what you type, up to a limit.
  useEffect(() => { const t = field.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 220) + "px"; } }, [input]);

  const edit = (id: string, f: (x: Conv) => Conv) => setConvs((all) => all.map((x) => (x.id === id ? f(x) : x)));
  const push = (id: string, m: Msg) => edit(id, (x) => ({ ...x, msgs: [...x.msgs, m], at: Date.now() }));
  const replaceLast = (id: string, m: Msg) => edit(id, (x) => ({ ...x, msgs: [...x.msgs.slice(0, -1), m] }));
  const lowBattery = () => { try { return Number(localStorage.getItem("battery")) > 0 && Number(localStorage.getItem("battery")) <= 2; } catch { return false; } };

  function stop() { ctl.current?.abort(); voice.stopSpeaking(); }
  function newChat(id: CompanionId = who) {
    stop();
    setSide(false); setDraw(false); setInput("");
    // Reuse an empty chat instead of piling up blanks.
    const empty = convs.find((x) => !x.msgs.length);
    if (empty) { edit(empty.id, (x) => ({ ...x, who: id, at: Date.now() })); setActive(empty.id); }
    else { const n = blank(id); setConvs((all) => [n, ...all]); setActive(n.id); }
    setTimeout(() => field.current?.focus(), 0);
  }
  function open(id: string) { stop(); setActive(id); setSide(false); }
  function remove(id: string) {
    stop();
    setConvs((all) => {
      const rest = all.filter((x) => x.id !== id);
      const list = rest.length ? rest : [blank(who)];
      if (id === active) setActive(list[0].id);
      return list;
    });
  }
  function choose(id: CompanionId) {
    if (id === who) return;
    // An empty chat just switches companion; otherwise a new chat starts with the other one.
    if (!conv.msgs.length) { stop(); edit(conv.id, (x) => ({ ...x, who: id })); setSide(false); }
    else newChat(id);
  }

  function voiceNote() {
    if (!signedIn) { push(conv.id, { kind: "sys", text: "Please sign in to talk with Believer and Purity." }); return; }
    voice.listen((text) => send(text, true), (message) => push(conv.id, { kind: "sys", text: message }));
  }

  async function send(text: string, spoken = false) {
    text = text.trim();
    if (!text || busy) return;
    const id = conv.id, companion = who;
    if (!signedIn) { push(id, { kind: "sys", text: "Please sign in to talk with Believer and Purity." }); return; }
    setInput("");
    if (draw || DRAW_RE.test(text)) return makePicture(text);
    const turns: Turn[] = [...conv.turns, { role: "user", content: text }];
    edit(id, (x) => ({ ...x, title: x.msgs.length ? x.title : titleOf(text), turns, msgs: [...x.msgs, { kind: "me", text }, { kind: "ai", text: `${COMPANIONS[companion].name} is thinking…`, pending: true }], at: Date.now() }));
    setBusy(true);
    ctl.current = new AbortController();
    let reply = "";
    const born = Date.now(); // replies written in the last 20 seconds are shown being written out
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal,
        body: JSON.stringify({ companion, messages: turns, prefs: { lowBattery: lowBattery(), mood } }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        edit(id, (x) => ({ ...x, turns: turns.slice(0, -1), msgs: [...x.msgs.slice(0, -1), { kind: "sys", text: e.error || "Something went wrong. Try again." }] }));
        if (e.needPass) showPass();
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
      edit(id, (x) => ({ ...x, turns: [...turns, { role: "assistant", content: reply || "…" }], msgs: [...x.msgs.slice(0, -1), { kind: "ai", text: reply, born }] }));
      // Voice notes get a spoken reply; typed messages too when "Read replies aloud" is on.
      if (reply && (spoken || voice.autoRead)) voice.speak(reply);
    } catch (e: any) {
      if (reply) edit(id, (x) => ({ ...x, turns: [...turns, { role: "assistant", content: reply }], msgs: [...x.msgs.slice(0, -1), { kind: "ai", text: reply, born }] }));
      else edit(id, (x) => ({ ...x, turns: turns.slice(0, -1), msgs: [...x.msgs.slice(0, -1), { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Couldn't reach the companion. Check your connection." }] }));
    } finally {
      setBusy(false); ctl.current = null; setPassKey((k) => k + 1);
    }
  }

  function showPass() { setNeedPass(true); setSheet("pass"); }

  async function makePicture(request: string) {
    const id = conv.id, companion = who;
    edit(id, (x) => ({ ...x, title: x.msgs.length ? x.title : titleOf(request), msgs: [...x.msgs, { kind: "me", text: request }, { kind: "drawing" }], at: Date.now() }));
    setBusy(true);
    ctl.current = new AbortController();
    try {
      const res = await fetch("/api/draw", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.current.signal, body: JSON.stringify({ companion, request }) });
      const data = await res.json().catch(() => ({}));
      if (data.refusal) { replaceLast(id, { kind: "ai", text: data.refusal }); return; }
      if (!res.ok || !data.svg) { replaceLast(id, { kind: "sys", text: data.error || "That picture didn't come out right." }); if (data.needPass) showPass(); return; }
      const img = cleanSvg(data.svg);
      if (!img) { replaceLast(id, { kind: "sys", text: "That picture didn't come out right. Try describing it differently." }); return; }
      const asked = request.replace(/ \(draw a new version\)$/, "");
      edit(id, (x) => ({
        ...x,
        msgs: [...x.msgs.slice(0, -1), { kind: "img", svg: img.svg, title: img.title, request: asked }],
        turns: [...x.turns, { role: "user", content: `(Asked for a picture) ${request}` }, { role: "assistant", content: `(I drew a picture: ${img.title})` }],
      }));
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

  const recent = useMemo(() => convs.filter((x) => x.msgs.length).sort((a, b) => b.at - a.at), [convs]);
  const list = conv.msgs;
  const empty = list.length === 0;

  const composer = (
    <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
      <textarea ref={field} rows={1} value={input} onChange={(e) => setInput(e.target.value)}
        placeholder={!signedIn ? "Sign in to chat" : draw ? `Describe a picture for ${c.name} to draw…` : voice.listening ? "Listening… speak now" : `Message ${c.name}…`}
        aria-label={`Message ${c.name}`}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
      <div className="ai-tools">
        <button className={"ai-tool" + (draw ? " on" : "")} type="button" aria-pressed={draw} onClick={() => setDraw(!draw)} title={draw ? "Picture mode is on: describe what to draw" : "Make a picture"}>
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg><span className="sr-only">Make a picture</span>
        </button>
        {draw && <span className="ai-mode">🎨 Picture mode</span>}
        <span className="ai-grow" />
        {voice.canListen && (
          <button className={"ai-tool ai-mic" + (voice.listening ? " rec" : "")} type="button" aria-pressed={voice.listening} onClick={voiceNote} disabled={busy}
            title={voice.listening ? "Stop and send" : "Send a voice note"}>
            {voice.listening ? <svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg> : <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>}
            <span className="sr-only">{voice.listening ? "Stop and send" : "Send a voice note"}</span>
          </button>
        )}
        {busy
          ? <button className="ai-send" type="button" onClick={() => ctl.current?.abort()} title="Stop"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg><span className="sr-only">Stop</span></button>
          : <button className="ai-send" type="submit" disabled={!input.trim()} title="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6" /></svg><span className="sr-only">Send</span></button>}
      </div>
    </form>
  );

  return (
    <div className="kai companions">
      <div className={"card chat lux gpt ai-app" + (side ? " side-open" : "")} data-c={who} data-mood={mood}>
        <aside className="ai-side" aria-label="Chats">
          <button type="button" className="ai-new" onClick={() => newChat()}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New chat
          </button>
          <div className="ai-who" role="radiogroup" aria-label="Choose a companion">
            {(Object.keys(COMPANIONS) as CompanionId[]).map((id) => (
              <button key={id} type="button" role="radio" data-c={id} aria-checked={who === id} onClick={() => choose(id)}>
                <Art kind="robot" who={id} mood="okay" className="av" /><span>{COMPANIONS[id].name}</span>
              </button>
            ))}
          </div>
          <div className="ai-recent">
            <small>Recent</small>
            {recent.length === 0 ? <p className="muted">Your chats show here. They stay on this device only.</p> : recent.map((x) => (
              <div key={x.id} className={"ai-conv" + (x.id === active ? " on" : "")}>
                <button type="button" onClick={() => open(x.id)} aria-current={x.id === active ? "true" : undefined}>
                  <span>{x.title}</span><small>{COMPANIONS[x.who].name} · {when(x.at)}</small>
                </button>
                <button type="button" className="ai-del" onClick={() => remove(x.id)} aria-label={`Delete chat: ${x.title}`} title="Delete">✕</button>
              </div>
            ))}
          </div>
          <div className="ai-foot">
            {signedIn
              ? <button type="button" onClick={() => setSheet("pass")} data-hot={needPass ? "1" : undefined}>🎟️ Assistant Pass</button>
              : <Link href="/login?next=/companions">🔑 Sign in to chat</Link>}
            {voice.canSpeak && (
              <button type="button" aria-pressed={voice.autoRead} onClick={() => voice.setRead(!voice.autoRead)}>
                {voice.talking ? "🔊" : voice.autoRead ? "🔉" : "🔈"} Read replies aloud{voice.autoRead ? ": on" : ""}
              </button>
            )}
            <button type="button" onClick={() => setSheet("privacy")}>🔒 Privacy</button>
            <button type="button" onClick={() => setSheet("help")}>🆘 Help now</button>
          </div>
        </aside>
        {side && <button type="button" className="ai-scrim" aria-label="Close chats" onClick={() => setSide(false)} />}

        <section className={"ai-main" + (empty ? " empty" : "")}>
          <header className="ai-head">
            <button type="button" className="ai-menu" onClick={() => setSide(true)} aria-label="Open chats" aria-expanded={side}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <span className="ai-title"><Art kind="robot" who={who} mood="okay" className="av" />{empty ? c.name : conv.title}</span>
            <button type="button" className="ai-menu" onClick={() => newChat()} aria-label="New chat" title="New chat">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </header>

          <div className="msgs" ref={box} aria-live="polite">
            {list.map((m, i) => {
              if (m.kind === "me") return <div key={i} className="msg me">{m.text}</div>;
              if (m.kind === "sys") return <div key={i} className="msg sys">{m.text}</div>;
              if (m.kind === "drawing") return (
                <div key={i} className="msgrow"><div className="msg ai paper"><div className="drawing"><span>{c.name} is drawing…</span><i><b style={{ width: "60%" }} /></i></div></div></div>
              );
              if (m.kind === "img") return (
                <div key={i} className="msgrow">
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
                <div key={i} className="msgrow">
                  {m.pending ? <WritingNote name={c.name} /> : (
                    <Handwritten text={m.text} done={!m.writing} fresh={!!m.born && Date.now() - m.born < 20_000}
                      after={voice.canSpeak && <button className="listen" type="button" onClick={() => voice.speak(m.text)} title="Listen to this reply">▶ Listen</button>} />
                  )}
                </div>
              );
            })}
            {voice.listening && <div className="msg me listening">🎙️ {voice.heard || "Listening… speak now"}</div>}
          </div>

          <div className="ai-dock">
            {composer}
            {empty && (
              <div className="ai-starters">
                {STARTERS.map(([t, q]) => (
                  <button key={t} type="button" disabled={busy} onClick={() => (q ? send(q) : (setDraw(true), field.current?.focus()))}>{t}</button>
                ))}
              </div>
            )}
            <p className="ai-note">{c.name} is an AI assistant and can make mistakes. Not a doctor or therapist.</p>
          </div>
        </section>
      </div>

      {sheet && (
        <div className="sheet-back" onClick={() => setSheet(null)}>
          <div className="sheet stack" role="dialog" aria-modal="true" aria-label={sheet === "pass" ? "Assistant Pass" : sheet === "privacy" ? "Privacy" : "Help now"} onClick={(e) => e.stopPropagation()}>
            <button className="sheet-x" type="button" onClick={() => setSheet(null)} aria-label="Close">✕</button>
            {sheet === "pass" && <AIPass refreshKey={passKey} highlight={needPass} onPaid={() => { setNeedPass(false); setSheet(null); }} />}
            {sheet === "privacy" && (
              <div className="card stack">
                <h3>🔒 Privacy</h3>
                <p className="muted">Chats aren&apos;t saved on our servers. Your recent chats are kept only in this browser on this device, so you can come back to them. Voice notes are turned into text by your browser and aren&apos;t recorded.</p>
                <div className="row">
                  <button className="btn small" type="button" onClick={() => { remove(conv.id); setSheet(null); }}>Delete this chat</button>
                  <button className="btn small" type="button" onClick={() => { stop(); const n = blank(who); setConvs([n]); setActive(n.id); try { localStorage.removeItem(STORE); } catch {} setSheet(null); }}>Delete all chats</button>
                </div>
              </div>
            )}
            {sheet === "help" && (
              <div className="card stack">
                <h3>🆘 In danger right now?</h3>
                <p>Call your local emergency number now, or find a free crisis line in your country at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</p>
                <p className="muted">Believer and Purity are assistants, not doctors or therapists. Please also reach out to someone you trust.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
