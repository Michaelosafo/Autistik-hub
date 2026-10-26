"use client";
import { useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MOODS } from "@/lib/mood";

/** Shrinks a picture to at most 1280px and saves it as WebP (smaller, strips location data). */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that picture."))), "image/webp", 0.85));
}

/** Write a Tik: how you feel (a mood), a few words and an optional picture. Also used for replies. */
export default function TikComposer({ replyTo, onPosted, compact, placeholder }: { replyTo?: string; onPosted?: () => void; compact?: boolean; placeholder?: string }) {
  const [body, setBody] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [pic, setPic] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setMsg("Pick a JPG, PNG, WebP or GIF picture."); return; }
    if (f.size > 15 * 1024 * 1024) { setMsg("That picture is too big (15 MB max)."); return; }
    try { const blob = await shrink(f); setPic({ blob, url: URL.createObjectURL(blob) }); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }

  async function post() {
    const text = body.trim();
    if (!text) { setMsg(replyTo ? "Write a reply first." : "Write how you feel first."); return; }
    setBusy(true); setMsg("");
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
    let image_url: string | null = null;
    if (pic) {
      const path = `${user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.webp`;
      const { error } = await sb.storage.from("tik-images").upload(path, pic.blob, { contentType: "image/webp" });
      if (error) { setBusy(false); setMsg("Couldn't upload the picture. Try again."); return; }
      image_url = sb.storage.from("tik-images").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await sb.from("tiks").insert({ body: text.slice(0, 500), mood: replyTo ? null : mood, image_url, reply_to: replyTo ?? null });
    setBusy(false);
    if (error) { setMsg(/slow down/i.test(error.message) ? error.message : "Couldn't post. Try again."); return; }
    setBody(""); setMood(null); if (pic) URL.revokeObjectURL(pic.url); setPic(null);
    onPosted?.();
  }

  return (
    <div className={"tik-new" + (compact ? " compact" : "") + (replyTo ? " reply" : "")}>
      {!replyTo && (
        <div className="tik-moods" role="group" aria-label="How are you feeling?">
          {MOODS.map((m) => (
            <button key={m.key} type="button" className={mood === m.key ? "on" : ""} style={{ ["--mc" as any]: m.color }} aria-pressed={mood === m.key} onClick={() => setMood(mood === m.key ? null : m.key)}>{m.label}</button>
          ))}
        </div>
      )}
      <textarea value={body} maxLength={500} rows={compact ? 2 : 3} onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder || (replyTo ? "Write a reply…" : "How are you feeling today? Write a Tik…")} aria-label={replyTo ? "Your reply" : "Your Tik"} />
      {pic && (
        <div className="tik-pic-prev">
          <img src={pic.url} alt="Your picture" />
          <button type="button" onClick={() => { URL.revokeObjectURL(pic.url); setPic(null); }} aria-label="Remove the picture">Remove</button>
        </div>
      )}
      <div className="tik-new-row">
        {!replyTo && (
          <>
            <button type="button" className="tik-attach" onClick={() => file.current?.click()} aria-label="Add a picture">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>
              Picture
            </button>
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </>
        )}
        <small className="tik-count">{body.length}/500</small>
        <button type="button" className="tik-post" disabled={busy || !body.trim()} onClick={post}>{busy ? "Posting…" : replyTo ? "Reply" : "Post Tik"}</button>
      </div>
      {msg && <small className="tik-msg" role="status">{msg}</small>}
    </div>
  );
}
