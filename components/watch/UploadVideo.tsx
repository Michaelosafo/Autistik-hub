"use client";
/**
 * Upload a video (up to 30 minutes) or a fun clip (up to 90 seconds). The file goes straight from the phone to the
 * video service (Cloudflare Stream), which converts it to play smoothly anywhere; it shows up once that's done.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { videoApi } from "./data";

const MAX_MB = 200;

export default function UploadVideo({ kind, onClose }: { kind: "video" | "fun"; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [state, setState] = useState<"" | "uploading" | "processing" | "ready" | "failed">("");
  const [msg, setMsg] = useState("");
  const [id, setId] = useState("");
  const pick = useRef<HTMLInputElement>(null);

  async function check(f: File) {
    setMsg("");
    if (!/^video\//.test(f.type)) return setMsg("Pick a video file.");
    if (f.size > MAX_MB * 1024 * 1024) return setMsg(`That video is over ${MAX_MB} MB. Trim it or record a shorter one.`);
    // Fun clips are short: check the length before uploading.
    const secs = await new Promise<number>((res) => { const v = document.createElement("video"); v.preload = "metadata"; v.onloadedmetadata = () => { res(v.duration); URL.revokeObjectURL(v.src); }; v.onerror = () => res(0); v.src = URL.createObjectURL(f); });
    if (kind === "fun" && secs > 91) return setMsg("Fun clips are up to 90 seconds. Use Videos for longer ones.");
    if (secs > 30 * 60 + 5) return setMsg("Videos can be up to 30 minutes.");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120));
  }

  async function go() {
    if (!file) return;
    setMsg(""); setState("uploading"); setPct(0);
    try {
      const r = await videoApi<{ id: string; uploadURL: string }>("upload", { kind, title, about });
      setId(r.id);
      await new Promise<void>((res, rej) => {
        const x = new XMLHttpRequest();
        x.open("POST", r.uploadURL);
        x.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
        x.onload = () => (x.status < 300 ? res() : rej(new Error("The upload didn't finish. Try again.")));
        x.onerror = () => rej(new Error("The connection dropped. Try again on Wi-Fi."));
        const fd = new FormData(); fd.append("file", file); x.send(fd);
      });
      setState("processing");
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const s = await videoApi<{ status: string }>("sync", { id: r.id }).catch(() => ({ status: "processing" }));
        if (s.status === "ready") { setState("ready"); return; }
        if (s.status === "failed") { setState("failed"); setMsg("The video couldn't be converted. Try another file."); return; }
      }
    } catch (e: any) { setState("failed"); setMsg(e.message); }
  }

  return (
    <div className="wv-sheet-bg" role="dialog" aria-modal="true" aria-label={kind === "fun" ? "Post a fun clip" : "Upload a video"} onClick={(e) => e.target === e.currentTarget && state !== "uploading" && onClose()}>
      <div className="wv-sheet">
        <b className="wv-sheet-h">{kind === "fun" ? "Post a fun clip" : "Upload a video"}</b>
        {state === "ready" ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="notice ok">Your {kind === "fun" ? "clip" : "video"} is live on TIK.</div>
            <div className="row" style={{ gap: 8 }}><Link className="btn primary" href={`/watch/${id}`}>Watch it</Link><button type="button" className="btn" onClick={onClose}>Done</button></div>
          </div>
        ) : state === "processing" ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="aw-step"><span className="aw-spin" />Uploaded. Getting it ready to play everywhere…</div>
            <small className="muted">This takes a minute or two. You can close this; it&apos;ll appear on its own.</small>
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <button type="button" className="wv-drop" onClick={() => pick.current?.click()} disabled={state === "uploading"}>
              {file ? <><b>{file.name}</b><small>{(file.size / 1048576).toFixed(1)} MB · tap to change</small></> : <><b>Choose a video</b><small>{kind === "fun" ? "Up to 90 seconds, phone-shaped looks best" : `Up to 30 minutes and ${MAX_MB} MB`}</small></>}
            </button>
            <input ref={pick} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f); e.target.value = ""; }} />
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title" aria-label="Title" />
            {kind === "video" && <textarea className="input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={2000} rows={3} placeholder="What's it about? (optional)" aria-label="Description" />}
            {state === "uploading" && <div className="wv-bar" aria-label={`Uploading ${pct}%`}><i style={{ width: `${pct ?? 0}%` }} /><span>{pct}%</span></div>}
            <button type="button" className="btn primary" disabled={!file || !title.trim() || state === "uploading"} onClick={go}>{state === "uploading" ? "Uploading…" : "Post"}</button>
            <small className="muted">Keep it kind and safe. Videos that break the community rules are removed.</small>
          </>
        )}
        {msg && <div className="notice warn">{msg}</div>}
      </div>
    </div>
  );
}
