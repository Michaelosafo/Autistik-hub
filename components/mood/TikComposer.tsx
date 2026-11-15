"use client";
import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import Avatar from "@/components/Avatar";

/** The signed-in member's picture for the post box (looked up once per page). */
type MeP = { alias: string; color: string | null; avatar_url: string | null } | null;
let meP: Promise<MeP> | null = null;
function myProfile(): Promise<MeP> {
  if (!meP) meP = (async () => {
    const sb = supabaseBrowser();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from("profiles").select("alias,color,avatar_url").eq("id", user.id).maybeSingle();
    return (data as MeP) || null;
  })().catch(() => null);
  return meP;
}
import { TIK_STYLES, canStyle, type TikStyle } from "./tik-styles";
import { MoodSticker, STICKERS } from "./MoodStickers";

/** The AUTISTIK stickers, small, to drop into what you type (saved as :name:). */
function StickerTray({ onPick }: { onPick: (code: string) => void }) {
  return (
    <div className="st-tray" role="group" aria-label="Stickers">
      {STICKERS.map((s) => <button key={s.key} type="button" onClick={() => onPick(`:${s.key}:`)} aria-label={s.label} title={s.label}><MoodSticker k={s.key} size={30} /></button>)}
    </div>
  );
}

/** Shrinks a picture to at most 1280px and saves it as WebP (smaller, strips location data). */
export async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that picture."))), "image/webp", 0.85));
}

/** Write a Tik: just type and post, with an optional picture. Also used for replies. Ctrl/Cmd+Enter posts. */
/** big: the "What's happening" box on TIK's page, a large card with a colour cover like a member's profile. */
export default function TikComposer({ replyTo, replyUser, onPosted, compact, placeholder, big }: { replyTo?: string; replyUser?: string | null; onPosted?: () => void; compact?: boolean; placeholder?: string; big?: boolean }) {
  const [body, setBody] = useState("");
  const [pic, setPic] = useState<{ blob: Blob; url: string } | null>(null);
  const [stickers, setStickers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [style, setStyle] = useState<TikStyle | null>(null);
  const [designs, setDesigns] = useState(false);
  const [mine, setMine] = useState<MeP>(null);
  const file = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { myProfile().then(setMine); }, []);
  // The box grows with what you write (up to about 10 lines), like X.
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 260)}px`; }, [body]);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setMsg("Pick a JPG, PNG, WebP or GIF picture."); return; }
    if (f.size > 15 * 1024 * 1024) { setMsg("That picture is too big (15 MB max)."); return; }
    try { const blob = await shrink(f); setPic({ blob, url: URL.createObjectURL(blob) }); setMsg(""); } catch (e: any) { setMsg(e.message); }
  }

  async function post() {
    const text = body.trim();
    if (!text) { setMsg(replyTo ? "Write a reply first." : "Write something first."); return; }
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
    const useStyle = !replyTo && style && canStyle(text, !!pic) ? style : null;
    const { error } = await sb.from("tiks").insert({ body: text.slice(0, 500), image_url, ...(useStyle ? { style: useStyle } : {}), reply_to: replyTo ?? null, ...(replyTo && replyUser ? { reply_user: replyUser } : {}) });
    setBusy(false);
    if (error) { setMsg(/slow down/i.test(error.message) ? error.message : "Couldn't post. Try again."); return; }
    setBody(""); setStyle(null); setDesigns(false); if (pic) URL.revokeObjectURL(pic.url); setPic(null);
    onPosted?.();
  }

  const styled = !replyTo && !!style && canStyle(body, !!pic);
  const addSticker = (code: string) => {
    const el = ta.current, at = el ? el.selectionStart ?? body.length : body.length;
    const next = (body.slice(0, at) + (at && !/\s$/.test(body.slice(0, at)) ? " " : "") + code + " " + body.slice(at)).slice(0, 500);
    setBody(next);
    setTimeout(() => el?.focus(), 0);
  };
  if (replyTo) return (
    <div className="tik-chatbox-wrap">
    {stickers && <StickerTray onPick={addSticker} />}
    <div className="tik-chatbox">
      <button type="button" className={"tik-sticker-btn" + (stickers ? " on" : "")} onClick={() => setStickers(!stickers)} aria-pressed={stickers} aria-label="Stickers" title="Stickers"><MoodSticker k="stimmy" size={22} /></button>
      <textarea ref={ta} value={body} maxLength={500} rows={1} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy && body.trim()) { e.preventDefault(); post(); } }}
        placeholder={placeholder || "Write a comment…"} aria-label="Your comment" />
      <button type="button" className="tik-send" disabled={busy || !body.trim()} onClick={post} aria-label="Send comment">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l16-8-6 16-2.5-6.5z" /><path d="M11.5 13.5L20 4" /></svg>
      </button>
      {msg && <small className="tik-msg" role="status">{msg}</small>}
    </div>
    </div>
  );
  return (
    <div className={"tik-new x" + (compact ? " compact" : "") + (big ? " big" : "")}>
      {big && <div className="tik-new-cover" aria-hidden="true"><b>What&apos;s happening?</b></div>}
      <span className="tik-new-av" aria-hidden="true"><Avatar className="me-av" alias={mine?.alias || "Me"} color={mine?.color ?? undefined} url={mine?.avatar_url ?? null} /></span>
      <div className="tik-new-col">
      <div className={"tik-new-box" + (styled ? ` tik-style s-${style}` : "")}>
      <textarea ref={ta} value={body} maxLength={500} rows={2} onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy && body.trim()) { e.preventDefault(); post(); } }}
        placeholder={placeholder || (replyTo ? "Write a reply…" : "What's happening?")} aria-label={replyTo ? "Your reply" : "Your Tik"} />
      </div>
      {!pic && designs && (
        <div className="tik-styles" role="radiogroup" aria-label="Post design">
          <button type="button" role="radio" aria-checked={!style} className={"none" + (!style ? " on" : "")} onClick={() => setStyle(null)} title="No design">Aa</button>
          {TIK_STYLES.map((s) => <button key={s} type="button" role="radio" aria-checked={style === s} aria-label={`${s} design`} title={s} className={`s-${s}` + (style === s ? " on" : "")} onClick={() => setStyle(s)} />)}
          {style && !canStyle(body, false) && <small className="muted">Designs show on posts up to 160 letters.</small>}
        </div>
      )}
      {pic && (
        <div className="tik-pic-prev">
          <img src={pic.url} alt="Your picture" />
          <button type="button" onClick={() => { URL.revokeObjectURL(pic.url); setPic(null); }} aria-label="Remove the picture">Remove</button>
        </div>
      )}
      <div className="tik-new-row">
        <button type="button" className="tik-tool" onClick={() => file.current?.click()} aria-label="Add a picture" title="Picture">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>
        </button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" className={"tik-tool st" + (stickers ? " on" : "")} onClick={() => setStickers(!stickers)} aria-pressed={stickers} aria-label="Stickers" title="Stickers"><MoodSticker k="stimmy" size={20} /></button>
        {!pic && <button type="button" className={"tik-tool aa" + (designs || style ? " on" : "")} onClick={() => setDesigns(!designs)} aria-pressed={designs} aria-label="Post designs" title="Designs">Aa</button>}
        <span className="tik-grow" />
        <span className="tik-ring" style={{ ["--p" as any]: `${Math.min(100, body.length / 5)}%` }} data-warn={body.length > 450 || undefined} title={`${body.length}/500`} aria-label={`${500 - body.length} letters left`}>{body.length > 450 ? 500 - body.length : ""}</span>
        <button type="button" className="tik-post" disabled={busy || !body.trim()} onClick={post}>{busy ? "Posting…" : "Post"}</button>
      </div>
      {stickers && <StickerTray onPick={addSticker} />}
      {msg && <small className="tik-msg" role="status">{msg}</small>}
      </div>
    </div>
  );
}
