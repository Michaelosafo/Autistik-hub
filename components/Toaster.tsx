"use client";
import { useEffect, useState } from "react";
import type { Toast } from "@/lib/toast";

/** Shows the notes sent with toast(): newest on top, each one gone after a few seconds (or when closed). */
export default function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setList((l) => [t, ...l].slice(0, 3));
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), t.kind === "bad" ? 12_000 : 8_000);
    };
    addEventListener("aw-toast", on);
    return () => removeEventListener("aw-toast", on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={"toast " + t.kind}>
          <span className="toast-ic" aria-hidden="true">{t.kind === "ok" ? "✓" : t.kind === "bad" ? "!" : "i"}</span>
          <span className="toast-t"><b>{t.title}</b>{t.text && <small>{t.text}</small>}
            {t.link && <a href={t.link.href} target="_blank" rel="noopener noreferrer">{t.link.label} ↗</a>}</span>
          <button type="button" className="toast-x" aria-label="Close" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
