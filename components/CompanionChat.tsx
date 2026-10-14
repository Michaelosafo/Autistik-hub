"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Art from "@/components/Art";
import { COMPANIONS, DRAW_RE, type CompanionId, type Prefs } from "@/lib/companions";
import { cleanSvg } from "@/lib/svg-clean";

type Msg =
  | { kind: "me"; text: string }
  | { kind: "ai"; text: string; pending?: boolean }
  | { kind: "img"; svg: string; title: string; request: string }
  | { kind: "drawing" }
  | { kind: "sys"; text: string };
type Turn = { role: "user" | "assistant"; content: string };

const PREF_KEYS: [keyof Prefs, string][] = [["short", "Short answers"], ["steps", "Step-by-step lists"], ["literal", "Literal language, no idioms"], ["gentle", "Extra gentle tone"], ["fewQuestions", "Ask me fewer questions"]];

export default function CompanionChat({ signedIn, start }: { signedIn: boolean; start?: CompanionId }) {
  const [who, setWho] = useState<CompanionId>(start || "believer");
  const [msgs, setMsgs] = useState<Record<CompanionId, Msg[]>>({ believer: [], purity: [] });
  const turns = useRef<Record<CompanionId, Turn[]>>({ believer: [], purity: [] });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [draw, setDraw] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ short: true, literal: true });
  const ctl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const c = COMPANIONS[who];
  const other = COMPANIONS[who === "believer" ? "purity" : "believer"];

  useEffect(() => {
    try {
      const saved = localStorage.getItem("companion") as CompanionId | null;
      if (!start && saved && COMPANIONS[saved]) setWho(saved);
      const p = localStorage.getItem("prefs"); if (p) setPrefs(JSON.parse(p));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("companion", who); } catch {} }, [who]);
  useEffect(() => { try { localStorage.setItem("prefs", JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => { box.current?.scrollTo({ top: box.current.scrollHeight }); }, [msgs, who]);

  const push = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id], m] }));
  const replaceLast = (id: CompanionId, m: Msg) => setMsgs((all) => ({ ...all, [id]: [...all[id].slice(0, -1), m] }));
  const lowBattery = () => { try { return Number(localStorage.getItem("battery")) > 0 && Number(localStorage.getItem("battery")) <= 2; } catch { return false; } };

  function choose(id: CompanionId) { ctl.current?.abort(); setWho(id); }

  async function send(text: string) {
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
        body: JSON.stringify({ companion: id, messages: turns.current[id], prefs: { ...prefs, lowBattery: lowBattery() } }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        replaceLast(id, { kind: "sys", text: e.error || "Something went wrong. Try again." });
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
    } catch (e: any) {
      if (reply) turns.current[id].push({ role: "assistant", content: reply });
      else { replaceLast(id, { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Couldn't reach the companion. Check your connection." }); turns.current[id].pop(); }
    } finally {
      setBusy(false); ctl.current = null;
    }
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
      if (!res.ok || !data.svg) { replaceLast(id, { kind: "sys", text: data.error || "That picture didn't come out right." }); return; }
      const img = cleanSvg(data.svg);
      if (!img) { replaceLast(id, { kind: "sys", text: "That picture didn't come out right. Try describing it differently." }); return; }
      replaceLast(id, { kind: "img", svg: img.svg, title: img.title, request: request.replace(/ \(draw a new version\)$/, "") });
      turns.current[id].push({ role: "user", content: `(Asked for a picture) ${request}` }, { role: "assistant", content: `(I drew a picture: ${img.title})` });
    } catch (e: any) {
      replaceLast(id, { kind: "sys", text: e?.name === "AbortError" ? "Stopped." : "Something went wrong while drawing." });
    } finally {
      setBusy(false); ctl.current = null;
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
    <>
      <div className="comp-grid">
        {(Object.keys(COMPANIONS) as CompanionId[]).map((id) => {
          const k = COMPANIONS[id];
          return (
            <div key={id} className="comp" data-c={id} aria-pressed={who === id}>
              <Art kind={id} className="av" />
              <div style={{ minWidth: 0 }}>
                <h2>{k.name}</h2><div className="tagline">{k.tagline}</div>
                <div className="traits">{k.traits.map((t) => <span key={t}>{t}</span>)}</div>
                <div className="row"><button className="btn c small" type="button" onClick={() => choose(id)}>{who === id ? `Talking to ${k.name}` : `Talk to ${k.name}`}</button></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="kai">
        <div className="card chat" data-c={who}>
          <div className="chat-head">
            <Art kind={who} className="av" />
            <div className="grow"><b>{c.name}</b><div className="muted" style={{ fontSize: ".82em" }}>{c.tagline}</div></div>
            <button className="btn small" type="button" onClick={() => choose(other.id)}>Switch to {other.name}</button>
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
              return <div key={i} className="msgrow"><Art kind={who} className="av" /><div className={"msg ai" + (m.pending ? " muted" : "")}>{m.text}</div></div>;
            })}
          </div>
          {!list.length && (
            <div className="starters">{c.starters.map((s) => <button key={s} className="btn small" type="button" onClick={() => send(s)}>{s}</button>)}</div>
          )}
          <div className="composer-tools">
            <button className="btn small" id="kaiDraw" type="button" aria-pressed={draw} onClick={() => setDraw(!draw)}>✎ Make a picture</button>
            <span className="muted" style={{ fontSize: ".82em" }}>{draw ? "Picture mode is on. Describe what to draw." : "Turn on, then describe the picture you want."}</span>
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={signedIn ? `Message ${c.name}… (Enter to send, Shift+Enter for a new line)` : "Sign in to start chatting"} aria-label={`Message ${c.name}`}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            {busy ? <button className="btn" type="button" onClick={() => ctl.current?.abort()}>Stop</button> : <button className="btn c" type="submit">Send</button>}
          </form>
        </div>

        <div className="stack">
          {!signedIn && <div className="notice warn"><Link href="/login">Sign in</Link> to chat. It&apos;s free for members.</div>}
          <div className="card prefs">
            <h3>How they talk to you</h3>
            {PREF_KEYS.map(([k, label]) => (
              <label key={k}><input type="checkbox" checked={!!prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} /> {label}</label>
            ))}
          </div>
          <div className="card stack" style={{ fontSize: ".9em" }}>
            <h3>Privacy</h3>
            <p className="muted">Your chats are not saved on our servers. Close the page and they&apos;re gone.</p>
            <button className="btn small" type="button" onClick={() => { ctl.current?.abort(); turns.current[who] = []; setMsgs((a) => ({ ...a, [who]: [] })); }}>Clear this chat</button>
          </div>
          <div className="notice alert" style={{ fontSize: ".88em" }}><b>In danger right now?</b> Call your local emergency number, or find a free crisis line at <a href="https://findahelpline.com" target="_blank" rel="noopener noreferrer">findahelpline.com</a>.</div>
        </div>
      </div>
    </>
  );
}
