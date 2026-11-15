"use client";
/**
 * "Welcome to TIK: how's your brain today?" Once a day, right after the language question (and never on top of
 * it), members pick one of TIK's 10 mood stickers. It posts to their TIK for them, with an optional line and
 * picture. Signed out: the pick is kept on this device and posted right after they sign in.
 * "Check others" opens TIK without posting; "Not today" hides it until tomorrow.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { MoodSticker, STICKERS, stickerOf } from "./MoodStickers";
import { shrink } from "./TikComposer";

let owner = 0, seq = 0; // several page frames mount this; only the first one acts
const today = () => new Date().toISOString().slice(0, 10);
const DONE = "tik-mood-day", PENDING = "tik-mood-pending";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage off */ } };

async function postMood(key: string, note: string, blob: Blob | null): Promise<string | null> {
  const s = stickerOf(key);
  if (!s) return "Pick a mood first.";
  const sb = supabaseBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return "signin";
  let image_url: string | null = null;
  if (blob) {
    const path = `${user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.webp`;
    const { error } = await sb.storage.from("tik-images").upload(path, blob, { contentType: "image/webp" });
    if (error) return "Couldn't upload the picture. Try again or post without it.";
    image_url = sb.storage.from("tik-images").getPublicUrl(path).data.publicUrl;
  }
  const body = (note.trim() ? `${s.say}\n${note.trim()}` : s.say).slice(0, 500);
  const { error } = await sb.from("tiks").insert({ body, mood: key, image_url });
  return error ? "Couldn't post right now. Try again." : null;
}

export default function DailyMood() {
  const [show, setShow] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pic, setPic] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const path = usePathname() || "";
  const router = useRouter();

  const me = useRef(0);
  useEffect(() => { me.current = ++seq; if (!owner) owner = me.current; return () => { if (owner === me.current) owner = 0; }; }, []);
  useEffect(() => {
    if (owner && owner !== me.current) return;
    if (/^\/(login|admin|auth)/.test(path)) return;
    // Picked before signing in: post it now (once).
    const pending = get(PENDING);
    if (pending) {
      const [key, ...rest] = pending.split("|");
      postMood(key, rest.join("|"), null).then((r) => {
        if (r === "signin") return;
        put(PENDING, null); put(DONE, today());
        if (!r) { setDone(key); setShow(true); }
      });
      return;
    }
    if (get(DONE) === today()) return;
    // Only after the language question has been answered, and never over another popup.
    const t = setInterval(() => {
      const langDone = !!get("site-lang") || get("lang-asked") === "1";
      if (!langDone || document.querySelector(".welcome,.lp-bg,.dmood-bg")) return;
      clearInterval(t); setShow(true);
    }, 1200);
    return () => clearInterval(t);
  }, [path]);

  const close = (later = true) => { if (later) put(DONE, today()); setShow(false); };
  const post = async () => {
    if (!pick) { setMsg("Pick a mood first."); return; }
    setBusy(true); setMsg("");
    const r = await postMood(pick, note, pic?.blob ?? null);
    setBusy(false);
    if (r === "signin") { put(PENDING, `${pick}|${note.slice(0, 200)}`); window.location.href = "/login?next=/mood"; return; }
    if (r) { setMsg(r); return; }
    put(DONE, today()); setDone(pick);
  };
  const addPic = async (f?: File) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { setMsg("Pick a JPG, PNG, WebP or GIF picture."); return; }
    try { const blob = await shrink(f); setPic({ blob, url: URL.createObjectURL(blob) }); setMsg(""); } catch (e) { setMsg((e as Error).message); }
  };

  if (!show || typeof document === "undefined") return null;
  const chosen = stickerOf(done || pick);
  return createPortal(
    <div className="dmood-bg" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="dmood" role="dialog" aria-modal="true" aria-label="Your mood today">
        <button type="button" className="dmood-x" onClick={() => close()} aria-label="Not today">✕</button>
        {done && chosen ? (
          <div className="dmood-done">
            <MoodSticker k={chosen.key} size={96} />
            <b>Posted to your TIK!</b>
            <small>“{chosen.say}”</small>
            <div className="dmood-row">
              <button type="button" className="dmood-btn main" onClick={() => { close(); router.push("/mood"); }}>See how everyone feels →</button>
            </div>
          </div>
        ) : (
          <>
            <div className="dmood-h"><small>Welcome to TIK 👋</small><b>How&apos;s your brain today?</b><span>Pick one and we post it to your TIK for you.</span></div>
            <div className="dmood-grid" role="radiogroup" aria-label="Moods">
              {STICKERS.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={pick === s.key} className={pick === s.key ? "on" : ""} onClick={() => { setPick(s.key); setMsg(""); }} style={{ ["--mc" as any]: s.c2 }}>
                  <MoodSticker k={s.key} size={52} /><small>{s.label}</small>
                </button>
              ))}
            </div>
            {pick && (
              <div className="dmood-extra">
                <input className="ait-text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Add a line (optional)" aria-label="Add a line" />
                <div className="dmood-row">
                  <button type="button" className="dmood-btn" onClick={() => file.current?.click()}>{pic ? "🖼 Change picture" : "🖼 Add a picture"}</button>
                  {pic && <span className="dmood-pic"><img src={pic.url} alt="" /><button type="button" onClick={() => setPic(null)} aria-label="Remove picture">✕</button></span>}
                </div>
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { addPic(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            )}
            {msg && <small className="dmood-msg" role="status">{msg}</small>}
            <div className="dmood-row">
              <button type="button" className="dmood-btn main" disabled={!pick || busy} onClick={post}>{busy ? "Posting…" : "Post my mood"}</button>
              <button type="button" className="dmood-btn" onClick={() => { close(); router.push("/mood"); }}>👀 Check others</button>
            </div>
            <button type="button" className="dmood-later" onClick={() => close()}>Not today</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
