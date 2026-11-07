"use client";
import { useId } from "react";

/** A star-burst outline with `n` points (for the rosette and the star). */
function burst(n: number, r1: number, r2: number, cx = 12, cy = 12) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = (Math.PI * i) / n - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/**
 * The 10 AUTISTIK verified badges. Every one carries the white check, so it always reads as "verified"; the shape and
 * colours are the member's choice. Drawn as SVG, so they stay sharp at any size.
 */
export const BADGES: { name: string; colors: [string, string, string?]; shape: string; glow: string }[] = [
  { name: "Classic", colors: ["#4F8BFF", "#8B5CF6"], shape: burst(12, 11.2, 9.4), glow: "#6D7BFF" },
  { name: "Fire", colors: ["#FFB020", "#FF3D00", "#C2185B"], shape: "M12 .8c2.3 3.4 7.2 6 7.2 12.3A7.2 7.2 0 0 1 12 23.2a7.2 7.2 0 0 1-7.2-7.2c0-3.4 1.8-5.5 3.4-7 .3 2 1.2 3.4 2.6 4C10.3 9 11 4.4 12 .8Z", glow: "#FF5A1F" },
  { name: "Diamond", colors: ["#7DF9FF", "#2D9CFF", "#5B3DF5"], shape: "M6.2 2.5h11.6L22.6 9 12 22.5 1.4 9Z", glow: "#3BB8FF" },
  { name: "Crown", colors: ["#FFE57A", "#F5B300", "#D97706"], shape: "M1.8 6.5l5.3 4.2L12 3.2l4.9 7.5 5.3-4.2-2.1 13.8H3.9Z", glow: "#F5B300" },
  { name: "Puzzle", colors: ["#FF4D8D", "#FFB020", "#22C55E"], shape: "M3.5 3.5h5.6a2.9 2.9 0 1 1 5.8 0h5.6v5.6a2.9 2.9 0 1 0 0 5.8v5.6H3.5Z", glow: "#FF6FA5" },
  { name: "Emerald", colors: ["#6EE7B7", "#10B981", "#047857"], shape: "M12 1.2l9.4 5.4v10.8L12 22.8l-9.4-5.4V6.6Z", glow: "#10B981" },
  { name: "Moon", colors: ["#A78BFA", "#4C1D95"], shape: "M14.8 1.5A10.5 10.5 0 1 0 22.6 18 8.6 8.6 0 0 1 14.8 1.5Z", glow: "#8B5CF6" },
  { name: "Shield", colors: ["#F472B6", "#DB2777", "#7E22CE"], shape: "M12 1.5l8.6 3.2v6.6c0 5.4-3.6 9.9-8.6 11.6-5-1.7-8.6-6.2-8.6-11.6V4.7Z", glow: "#EC4899" },
  { name: "Star", colors: ["#FFF3A3", "#FBBF24", "#F97316"], shape: burst(5, 11.8, 5.6, 12, 12.8), glow: "#FBBF24" },
  { name: "Galaxy", colors: ["#22D3EE", "#A855F7", "#F43F5E"], shape: "M12 1a11 11 0 1 1 0 22 11 11 0 0 1 0-22Z", glow: "#A855F7" },
];

/** A member's verified badge (1–10; no choice yet shows Classic). */
export default function VerifiedBadge({ n, size = 16, title = "Verified by AUTISTIK", className }: { n?: number | null; size?: number; title?: string; className?: string }) {
  const b = BADGES[(n && n >= 1 && n <= 10 ? n : 1) - 1];
  const id = useId().replace(/:/g, "");
  const [c1, c2, c3] = b.colors;
  return (
    <svg className={"vbadge" + (className ? ` ${className}` : "")} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={`${title} · ${b.name}`} style={{ filter: `drop-shadow(0 0 ${Math.max(1, size / 8)}px ${b.glow}88)` }}>
      <title>{title}</title>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1} />
          {c3 ? <><stop offset=".55" stopColor={c2} /><stop offset="1" stopColor={c3} /></> : <stop offset="1" stopColor={c2} />}
        </linearGradient>
        <linearGradient id={`s${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={b.shape} fill={`url(#g${id})`} />
      <path d={b.shape} fill={`url(#s${id})`} />
      {b.name === "Galaxy" && <><circle cx="6.5" cy="7" r=".9" fill="#fff" opacity=".85" /><circle cx="17.8" cy="16.5" r=".7" fill="#fff" opacity=".75" /><circle cx="18" cy="6.5" r=".5" fill="#fff" opacity=".7" /></>}
      <path d={b.name === "Fire" ? "M8.6 15.4l2.4 2.4 4.6-5" : b.name === "Moon" ? "M7 12.6l2.6 2.6 5-5.6" : b.name === "Star" ? "M8.6 13.2l2.4 2.4 4.6-5" : b.name === "Crown" ? "M8.4 13.8l2.5 2.5 4.8-5.2" : "M7.4 12.4l3 3 6.2-6.6"}
        fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
