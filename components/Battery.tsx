"use client";
import { useEffect, useState } from "react";

const LABELS = ["Empty", "Low", "Okay", "Good", "Full"];

/** Social battery check-in. Stored only in this browser, never on the server. */
export default function Battery() {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    try { const v = Number(localStorage.getItem("battery")); if (v) setLevel(v); } catch {}
  }, []);
  function pick(n: number) {
    setLevel(n);
    try { localStorage.setItem("battery", String(n)); localStorage.setItem("batteryAt", String(Date.now())); } catch {}
  }
  return (
    <div className="card stack">
      <div><div className="label">Check in</div><h2 style={{ marginTop: 4 }}>How full is your social battery today?</h2></div>
      <div className="battery">
        {LABELS.map((l, i) => (
          <button key={l} type="button" aria-pressed={level === i + 1} onClick={() => pick(i + 1)}>
            <span className="cells" aria-hidden="true">{[0, 1, 2, 3, 4].map((c) => <i key={c} className={c <= i ? "f" : ""} />)}</span>
            <span>{l}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: ".9em" }}>
        {level && level <= 2
          ? "Low battery noted. Purity is a good choice on low-battery days; she keeps things slow and quiet."
          : "Only you can see this. It's saved on this device and helps your companion adapt to you."}
      </p>
    </div>
  );
}
