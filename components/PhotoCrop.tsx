"use client";
/**
 * Choose how your photo sits in the circle before it's saved: drag it to move it, use the slider (or pinch, or the
 * mouse wheel) to zoom. Saves a 384px square WebP of exactly what's inside the frame.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const V = 280; // the frame on screen, in CSS pixels
const OUT = 384; // the saved photo

export default function PhotoCrop({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (b: Blob) => void }) {
  const [url, setUrl] = useState("");
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; px: number; py: number } | null>(null);
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const s = V / Math.min(i.naturalWidth, i.naturalHeight);
      setZoom(1);
      setPos({ x: (V - i.naturalWidth * s) / 2, y: (V - i.naturalHeight * s) / 2 });
    };
    i.onerror = () => setErr("This picture can't be opened here. Try a JPG or PNG.");
    i.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onCancel]);

  const base = img ? V / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const w = img ? img.naturalWidth * scale : V, h = img ? img.naturalHeight * scale : V;
  // The photo always fills the frame.
  const clamp = (p: { x: number; y: number }, ww = w, hh = h) => ({ x: Math.min(0, Math.max(V - ww, p.x)), y: Math.min(0, Math.max(V - hh, p.y)) });

  function setZoomAt(z: number, cx = V / 2, cy = V / 2) {
    if (!img) return;
    const nz = Math.min(4, Math.max(1, z));
    const ns = base * nz, r = ns / scale;
    const nx = cx - (cx - pos.x) * r, ny = cy - (cy - pos.y) * r;
    setZoom(nz);
    setPos(clamp({ x: nx, y: ny }, img.naturalWidth * ns, img.naturalHeight * ns));
  }

  function down(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
      drag.current = null;
    } else drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  }
  function move(e: React.PointerEvent) {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      setZoomAt(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d));
      return;
    }
    const d = drag.current;
    if (d && d.id === e.pointerId) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  }
  function up(e: React.PointerEvent) {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) pinch.current = null;
    if (drag.current?.id === e.pointerId) drag.current = null;
  }
  function wheel(e: React.WheelEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setZoomAt(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
  }
  function nudge(dx: number, dy: number) { setPos(clamp({ x: pos.x + dx, y: pos.y + dy })); }

  async function save() {
    if (!img) return;
    setBusy(true);
    const c = document.createElement("canvas");
    c.width = c.height = OUT;
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, -pos.x / scale, -pos.y / scale, V / scale, V / scale, 0, 0, OUT, OUT);
    c.toBlob((b) => { setBusy(false); if (b) onDone(b); else setErr("Couldn't make the photo. Try another one."); }, "image/webp", 0.9);
  }

  return createPortal(
    <div className="pc-bg" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pc" role="dialog" aria-modal="true" aria-label="Choose how your photo fits">
        <div className="pc-h"><b>Fit your photo</b><button type="button" className="mp-x" aria-label="Cancel" onClick={onCancel}>✕</button></div>
        <small className="pc-tip">Drag to move it. Use the slider (or pinch) to zoom. What&apos;s inside the circle is what people see.</small>
        <div className="pc-frame" style={{ width: V, height: V }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
          tabIndex={0} aria-label="Photo position: use the arrow keys to move it"
          onKeyDown={(e) => { const k: Record<string, [number, number]> = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }; if (k[e.key]) { e.preventDefault(); nudge(...k[e.key]); } }}>
          {url && img && <img src={url} alt="" draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
          {!img && !err && <span className="pc-wait">Opening…</span>}
          <span className="pc-ring" aria-hidden="true" />
        </div>
        <label className="pc-zoom">
          <span aria-hidden="true">−</span>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoomAt(Number(e.target.value))} aria-label="Zoom" disabled={!img} />
          <span aria-hidden="true">+</span>
        </label>
        <div className="pc-sizes" role="group" aria-label="Quick sizes">
          {[["Whole", 1], ["Close", 1.6], ["Closer", 2.4]].map(([l, z]) => (
            <button key={l as string} type="button" className={"btn small" + (Math.abs(zoom - (z as number)) < 0.02 ? " primary" : "")} onClick={() => setZoomAt(z as number)} disabled={!img}>{l}</button>
          ))}
        </div>
        {err && <div className="notice warn" role="alert">{err}</div>}
        <div className="pc-r">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={!img || busy}>{busy ? "Saving…" : "Use this photo"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
