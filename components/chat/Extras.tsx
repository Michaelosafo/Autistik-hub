"use client";
import { useEffect, useRef, useState } from "react";

const EMOJIS = "😀 😂 🤣 😊 😍 🥰 😎 🤩 🥳 😇 🙂 😉 😜 🤪 😏 🤔 🤗 🙃 😴 🥺 😢 😭 😤 😡 🤯 😱 😳 🤭 🫡 🫶 👍 👎 👏 🙌 🙏 💪 🤝 ✌️ 🤞 👀 🔥 💯 ✅ ❌ ⭐ 🌟 ✨ 💥 💎 🚀 🌙 ☀️ 🌈 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 🎉 🎊 🎁 🏆 🥇 🎯 🎮 ⚽ 🎵 📈 📉 💰 🪙 💸 🐶 🐱 🦊 🐸 🦁 🐵 🦄 🐳 🍕 🍔 🍟 🍩 ☕ 🍺 🥂 🌍 🧠 ♾️".split(" ");
const BGS = ["#F0B90B", "#0E8A4F", "#6141D4", "#FF6B9A", "#16111F", "#2F80ED", "#FFFFFF"];

export type Sticker = { id: string; url: string; name: string | null };

/** Picture → square sticker (256px WebP). Animated GIFs are kept as they are so they still move. */
async function toSticker(f: File): Promise<Blob> {
  if (f.type === "image/gif") return f;
  const img = await createImageBitmap(f);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const s = Math.min(img.width, img.height);
  x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
  return await new Promise((r) => c.toBlob((b) => r(b!), "image/webp", 0.9));
}

/** Your own emoji: a big emoji with a word on a colour, made into a sticker. */
async function makeSticker(emoji: string, word: string, bg: string): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  x.fillStyle = bg;
  x.beginPath(); x.roundRect(8, 8, 240, 240, 48); x.fill();
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `${word ? 120 : 160}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  x.fillText(emoji, 128, word ? 108 : 132);
  if (word) {
    const dark = bg === "#FFFFFF" || bg === "#F0B90B";
    x.font = "900 38px system-ui, sans-serif";
    x.lineWidth = 8; x.strokeStyle = dark ? "#FFFFFF" : "#16111F"; x.fillStyle = dark ? "#16111F" : "#FFFFFF";
    const t = word.toUpperCase().slice(0, 12);
    x.strokeText(t, 128, 206); x.fillText(t, 128, 206);
  }
  return await new Promise((r) => c.toBlob((b) => r(b!), "image/webp", 0.92));
}

/** Emojis, your stickers, add a picture or GIF as a sticker, or make your own. */
export function EmojiTray({ sb, me, onEmoji, onSticker, onClose }: { sb: any; me: string; onEmoji: (e: string) => void; onSticker: (url: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"emoji" | "stickers" | "make">("emoji");
  const [stickers, setStickers] = useState<Sticker[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [mk, setMk] = useState({ emoji: "🚀", word: "", bg: BGS[0] });
  const file = useRef<HTMLInputElement>(null);
  const load = () => sb.from("chat_stickers").select("id,url,name").order("created_at", { ascending: false }).then(({ data }: any) => setStickers(data || []));
  useEffect(() => { if (tab !== "emoji") load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);

  async function save(blob: Blob, ext: string, name: string | null) {
    setBusy(true); setMsg("");
    try {
      if (blob.size > 2_000_000) throw new Error("That one is too big (2 MB max).");
      const path = `${me}/sticker-${Date.now()}.${ext}`;
      const { error } = await sb.storage.from("chat-media").upload(path, blob, { contentType: blob.type || (ext === "gif" ? "image/gif" : "image/webp") });
      if (error) throw new Error("Couldn't upload it. Try again.");
      const url = sb.storage.from("chat-media").getPublicUrl(path).data.publicUrl;
      const { error: e2 } = await sb.from("chat_stickers").insert({ url, name });
      if (e2) throw new Error(/row-level|policy/i.test(e2.message) ? "You can keep up to 100 stickers. Remove some first." : "Couldn't save it.");
      setTab("stickers"); load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function remove(s: Sticker) {
    await sb.from("chat_stickers").delete().eq("id", s.id);
    setStickers((l) => l?.filter((x) => x.id !== s.id) ?? l);
  }

  return (
    <div className="ch-tray" role="dialog" aria-label="Emojis and stickers">
      <div className="ch-tray-tabs">
        <button type="button" aria-pressed={tab === "emoji"} onClick={() => setTab("emoji")}>😀 Emojis</button>
        <button type="button" aria-pressed={tab === "stickers"} onClick={() => setTab("stickers")}>🖼️ My stickers</button>
        <button type="button" aria-pressed={tab === "make"} onClick={() => setTab("make")}>✨ Make one</button>
        <button type="button" className="ch-x" onClick={onClose} aria-label="Close">×</button>
      </div>
      {msg && <p className="ch-err">{msg}</p>}
      {tab === "emoji" && <div className="ch-emojis">{EMOJIS.map((e) => <button key={e} type="button" onClick={() => onEmoji(e)} aria-label={e}>{e}</button>)}</div>}
      {tab === "stickers" && (
        <div className="ch-stickers">
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) save(await toSticker(f), f.type === "image/gif" ? "gif" : "webp", f.name.slice(0, 40)); }} />
          <button type="button" className="ch-st-add" disabled={busy} onClick={() => file.current?.click()}>{busy ? "…" : "+"}<small>Picture or GIF</small></button>
          {!stickers ? <p className="muted">Loading…</p> : stickers.map((s) => (
            <span key={s.id} className="ch-st">
              <button type="button" onClick={() => onSticker(s.url)} aria-label={`Send sticker ${s.name ?? ""}`}><img src={s.url} alt="" /></button>
              <button type="button" className="ch-st-x" onClick={() => remove(s)} aria-label="Remove sticker">×</button>
            </span>
          ))}
          {stickers && !stickers.length && <p className="muted" style={{ gridColumn: "1 / -1" }}>No stickers yet. Add a picture or animated GIF, or make your own.</p>}
        </div>
      )}
      {tab === "make" && (
        <div className="ch-make">
          <div className="ch-make-prev" style={{ background: mk.bg }}>
            <span>{mk.emoji}</span>{mk.word && <b style={{ color: mk.bg === "#FFFFFF" || mk.bg === "#F0B90B" ? "#16111F" : "#fff" }}>{mk.word.toUpperCase().slice(0, 12)}</b>}
          </div>
          <div className="stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
            <div className="ch-emojis small">{EMOJIS.slice(0, 40).map((e) => <button key={e} type="button" aria-pressed={mk.emoji === e} onClick={() => setMk({ ...mk, emoji: e })}>{e}</button>)}</div>
            <input className="ch-search" style={{ margin: 0 }} value={mk.word} onChange={(e) => setMk({ ...mk, word: e.target.value })} maxLength={12} placeholder="A word (optional), e.g. WAGMI" />
            <div className="row" style={{ gap: 6 }}>{BGS.map((b) => <button key={b} type="button" className="ch-swatch" style={{ background: b }} aria-pressed={mk.bg === b} aria-label={`Colour ${b}`} onClick={() => setMk({ ...mk, bg: b })} />)}</div>
            <button type="button" className="btn primary small" disabled={busy} onClick={async () => save(await makeSticker(mk.emoji, mk.word, mk.bg), "webp", mk.word || mk.emoji)}>{busy ? "Saving…" : "Save to my stickers"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tap to record a voice note, tap again to send (or ✕ to throw it away). Up to 2 minutes. */
export function VoiceButton({ disabled, onDone, onError }: { disabled?: boolean; onDone: (blob: Blob, secs: number, type: string) => void; onError: (m: string) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const parts = useRef<Blob[]>([]);
  const cancel = useRef(false);
  const started = useRef(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= 120) rec.stop();
    }, 250);
    return () => clearInterval(t);
  }, [rec]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) || "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      parts.current = []; cancel.current = false; started.current = Date.now(); setSecs(0);
      r.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const s = Math.max(1, Math.round((Date.now() - started.current) / 1000));
        setRec(null);
        if (!cancel.current && parts.current.length) onDone(new Blob(parts.current, { type: r.mimeType || "audio/webm" }), s, r.mimeType || "audio/webm");
      };
      r.start(250);
      setRec(r);
    } catch { onError("Allow the microphone to send voice notes."); }
  }
  if (rec) return (
    <span className="ch-rec">
      <button type="button" className="ch-ic" onClick={() => { cancel.current = true; rec.stop(); }} aria-label="Cancel voice note">✕</button>
      <i className="ch-rec-dot" aria-hidden="true" /> <b>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</b>
      <button type="button" className="ch-send" onClick={() => rec.stop()} aria-label="Send voice note">➤</button>
    </span>
  );
  return <button type="button" className="ch-ic ch-mic" disabled={disabled} onClick={start} aria-label="Record a voice note">🎤</button>;
}
