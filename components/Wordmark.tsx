"use client";
/**
 * The AUTISTIK wordmark: the name in heavy display letters with the infinity logo standing in for the first "I".
 * The two loops of the infinity sign are a pair of eyes: the pupils follow the pointer and blink now and then.
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
      svg.style.setProperty("--px", ((dx / d) * 4.2 * k).toFixed(2) + "px");
      svg.style.setProperty("--py", ((dy / d) * 3.2 * k).toFixed(2) + "px");
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
  return (
    <svg ref={ref} className="eye-logo" viewBox="0 0 64 40" aria-hidden="true">
      <defs>
        <linearGradient id="el-loop" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FF6B9A" />
          <stop offset=".28" stopColor="#FFD84D" />
          <stop offset=".55" stopColor="#5BE38F" />
          <stop offset=".78" stopColor="#4FD1FF" />
          <stop offset="1" stopColor="#B57CFF" />
        </linearGradient>
      </defs>
      <ellipse cx="18" cy="20" rx="12.5" ry="13" fill="#fff" />
      <ellipse cx="46" cy="20" rx="12.5" ry="13" fill="#fff" />
      <g className="el-pupils">
        <circle cx="18" cy="21" r="5.6" fill="#120C20" /><circle cx="20" cy="18.6" r="1.7" fill="#fff" />
        <circle cx="46" cy="21" r="5.6" fill="#120C20" /><circle cx="48" cy="18.6" r="1.7" fill="#fff" />
      </g>
      <g className="el-lids"><rect x="4" y="5" width="28" height="30" rx="14" /><rect x="32" y="5" width="28" height="30" rx="14" /></g>
      <path d="M18 6c-8 0-14 6.2-14 14s6 14 14 14c6.6 0 10.2-5.4 14-14 3.8-8.6 7.4-14 14-14 8 0 14 6.2 14 14s-6 14-14 14c-6.6 0-10.2-5.4-14-14-3.8-8.6-7.4-14-14-14z"
        fill="none" stroke="url(#el-loop)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
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
