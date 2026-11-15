"use client";
/**
 * The AUTISTIK wordmark: the name in heavy display letters, the first "I" drawn as a rainbow stem with one eye that
 * follows the pointer and blinks now and then (so it still reads AUTISTIK).
 * Screen readers read "AUTISTIK".
 */
import { useEffect, useRef } from "react";

function EyeLogo() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const calm = () => document.documentElement.dataset.calm === "on" || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const move = (x: number, y: number) => {
      if (calm()) return;
      const r = svg.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      svg.style.setProperty("--px", ((dx / d) * 2.6 * k).toFixed(2) + "px");
      svg.style.setProperty("--py", ((dy / d) * 2.6 * k).toFixed(2) + "px");
    };
    const onMove = (e: PointerEvent) => move(e.clientX, e.clientY);
    window.addEventListener("pointermove", onMove, { passive: true });
    // On phones there is no pointer, so the eyes glance around by themselves.
    let i = 0;
    const spots = [[-1, 0], [1, -0.4], [0.3, 1], [-0.8, 0.6], [0, 0]];
    const t = window.setInterval(() => {
      if (calm()) return;
      const r = svg.getBoundingClientRect(), [sx, sy] = spots[i++ % spots.length];
      if (matchMedia("(hover: none)").matches) move(r.left + r.width / 2 + sx * 300, r.top + r.height / 2 + sy * 300);
    }, 1800);
    return () => { window.removeEventListener("pointermove", onMove); window.clearInterval(t); };
  }, []);
  // The letter "I" of AUTISTIK: a rounded rainbow stem with one eye near the top (the pupil follows the pointer).
  return (
    <svg ref={ref} className="eye-logo" viewBox="0 0 24 60" aria-hidden="true">
      <defs>
        <linearGradient id="el-i" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FF6B9A" />
          <stop offset=".3" stopColor="#FFD84D" />
          <stop offset=".55" stopColor="#5BE38F" />
          <stop offset=".78" stopColor="#4FD1FF" />
          <stop offset="1" stopColor="#B57CFF" />
        </linearGradient>
      </defs>
      <rect x="2" y="1" width="20" height="58" rx="10" fill="url(#el-i)" />
      <circle cx="12" cy="13" r="7.4" fill="#fff" />
      <g className="el-pupils"><circle cx="12" cy="14" r="3.7" fill="#120C20" /><circle cx="13.3" cy="12.4" r="1.2" fill="#fff" /></g>
      <g className="el-lids"><rect x="4.6" y="5.6" width="14.8" height="14.8" rx="7.4" /></g>
    </svg>
  );
}

export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={"wordmark " + className} role="img" aria-label="AUTISTIK">
      <span aria-hidden="true">AUT</span>
      <span className="wm-logo" aria-hidden="true"><EyeLogo /></span>
      <span aria-hidden="true">STIK</span>
    </span>
  );
}
