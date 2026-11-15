/**
 * TIK's own mood stickers: 10 small, funny, slightly weird faces drawn for AUTISTIK (not the launch emoji).
 * Used by the daily "How's your brain today?" check-in, and shown on a Tik that carries one.
 */
export const STICKERS = [
  { key: "buffering", label: "Brain buffering", say: "Brain still loading… please hold 🔄", c1: "#7CC4FF", c2: "#3B82F6" },
  { key: "goblin", label: "Hyperfocus goblin", say: "Hyperfocus goblin mode: do not disturb the project 🧌", c1: "#9BE37A", c2: "#2EBD85" },
  { key: "lowbatt", label: "Social battery 1%", say: "Social battery at 1%. Recharging in my cave 🔋", c1: "#FFB199", c2: "#FF5A5F" },
  { key: "stimmy", label: "Stim party", say: "Stim party! Everything is wiggly and good ✨", c1: "#FFE27A", c2: "#F5A70B" },
  { key: "noodle", label: "Chaos noodle", say: "Chaos noodle today. Nothing is straight 🍜", c1: "#FFC6E2", c2: "#FF6B9A" },
  { key: "potato", label: "Cozy potato", say: "Cozy potato. Blanket. Snacks. No plans 🥔", c1: "#E9C99A", c2: "#B98545" },
  { key: "bigfeels", label: "Big feels", say: "Big feels today, being gentle with myself 💜", c1: "#D7B8FF", c2: "#9B6BFF" },
  { key: "zoomies", label: "Zoomies", say: "Zoomies! Too much energy, must move 💨", c1: "#8AF0E0", c2: "#14B8A6" },
  { key: "dnd", label: "Do not disturb", say: "Do not disturb. Headphones on, world off 🎧", c1: "#C9CEDD", c2: "#6B7280" },
  { key: "mainchar", label: "Main character", say: "Main character energy today 🌟", c1: "#FFD84D", c2: "#FF9F5A" },
] as const;
export type StickerKey = (typeof STICKERS)[number]["key"];
export const stickerOf = (k: string | null | undefined) => STICKERS.find((s) => s.key === k) || null;

/** One sticker: a soft blob face with its own silly detail. */
export function MoodSticker({ k, size = 56 }: { k: string; size?: number }) {
  const s = stickerOf(k);
  if (!s) return null;
  const id = `ms-${s.key}`;
  const eye = (x: number, y: number, r = 4.2) => <><circle cx={x} cy={y} r={r} fill="#1B1430" /><circle cx={x + 1.3} cy={y - 1.4} r={1.3} fill="#fff" /></>;
  const body = s.key === "noodle" ? "M32 6c14 0 24 9 24 24 0 13-6 26-24 28C14 60 8 46 8 32 8 15 18 6 32 6z" : s.key === "potato" ? "M18 12c8-8 26-7 34 2s9 26 2 36-26 13-36 5S6 30 10 22c2-4 5-7 8-10z" : "M32 6c15 0 26 11 26 26S47 58 32 58 6 47 6 32 17 6 32 6z";
  return (
    <svg className="msticker" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><radialGradient id={id} cx=".35" cy=".3" r=".8"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".25" stopColor={s.c1} /><stop offset="1" stopColor={s.c2} /></radialGradient></defs>
      <ellipse cx="32" cy="60" rx="18" ry="3" fill="#000" opacity=".12" />
      <path d={body} fill={`url(#${id})`} stroke="#1B1430" strokeWidth="2.2" />
      {s.key === "buffering" && <><circle cx="32" cy="14" r="5" fill="none" stroke="#fff" strokeWidth="2.4" strokeDasharray="20 12" className="ms-spin" />{eye(24, 32)}{eye(40, 32)}<path d="M24 45h16" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /></>}
      {s.key === "goblin" && <><path d="M8 26 2 18l10 3M56 26l6-8-10 3" fill={s.c1} stroke="#1B1430" strokeWidth="2" strokeLinejoin="round" />{eye(23, 30, 5.5)}{eye(41, 30, 5.5)}<path d="M22 44c6 5 14 5 20 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M27 46l2 4 2-4M34 46l2 4 2-4" fill="#fff" stroke="#1B1430" strokeWidth="1.2" /></>}
      {s.key === "lowbatt" && <><rect x="22" y="12" width="20" height="9" rx="2" fill="#fff" stroke="#1B1430" strokeWidth="1.8" /><rect x="23.5" y="13.5" width="2" height="6" fill="#FF3B3B" /><path d="M20 33h8M36 33h8" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M26 46c4-3 8-3 12 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M46 38c0 3 2 5 2 5s2-2 2-5-2-5-2-5-2 2-2 5z" fill="#7CC4FF" /></>}
      {s.key === "stimmy" && <><path d="M4 24l6 2M6 36l6-1M60 24l-6 2M58 36l-6-1" stroke="#1B1430" strokeWidth="2.2" strokeLinecap="round" /><path d="M19 29c2-3 6-3 8 0M37 29c2-3 6-3 8 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M20 40c6 9 18 9 24 0z" fill="#1B1430" /><path d="M27 45c3 2 7 2 10 0" fill="#FF6B9A" /><path d="M50 10l1.5 3.5L55 15l-3.5 1.5L50 20l-1.5-3.5L45 15l3.5-1.5z" fill="#fff" /></>}
      {s.key === "noodle" && <><path d="M18 30c3-4 6 4 9 0M37 30c3-4 6 4 9 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M22 44c4 3 6-3 10 0s6-3 10 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M30 6c-2-4 4-6 2-10" fill="none" stroke="#1B1430" strokeWidth="2" strokeLinecap="round" /></>}
      {s.key === "potato" && <><circle cx="20" cy="22" r="1.6" fill="#8a5a2b" /><circle cx="46" cy="44" r="1.8" fill="#8a5a2b" /><path d="M20 32c2 2 6 2 8 0M36 32c2 2 6 2 8 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M27 42c3 2 7 2 10 0" fill="none" stroke="#1B1430" strokeWidth="2.4" strokeLinecap="round" /><path d="M10 46c8-4 36-4 44 0v10H10z" fill="#FF9FC7" stroke="#1B1430" strokeWidth="2" /></>}
      {s.key === "bigfeels" && <>{eye(23, 30, 6.5)}{eye(41, 30, 6.5)}<path d="M18 38c-1 5 0 8 2 9M46 38c1 5 0 8-2 9" stroke="#7CC4FF" strokeWidth="3" strokeLinecap="round" /><path d="M26 47c4-3 8-3 12 0" fill="none" stroke="#1B1430" strokeWidth="2.4" strokeLinecap="round" /><path d="M32 14c-2-3-7-1-5 3l5 4 5-4c2-4-3-6-5-3z" fill="#FF6B9A" /></>}
      {s.key === "zoomies" && <><path d="M2 22h10M0 32h12M2 42h10" stroke="#1B1430" strokeWidth="2.4" strokeLinecap="round" /><circle cx="26" cy="30" r="6" fill="#fff" stroke="#1B1430" strokeWidth="2" /><circle cx="42" cy="30" r="6" fill="#fff" stroke="#1B1430" strokeWidth="2" /><circle cx="28" cy="30" r="2.6" fill="#1B1430" /><circle cx="44" cy="30" r="2.6" fill="#1B1430" /><ellipse cx="34" cy="45" rx="6" ry="5" fill="#1B1430" /></>}
      {s.key === "dnd" && <><path d="M12 28c0-14 40-14 40 0" fill="none" stroke="#1B1430" strokeWidth="3" /><rect x="7" y="26" width="8" height="14" rx="3" fill="#B57CFF" stroke="#1B1430" strokeWidth="1.8" /><rect x="49" y="26" width="8" height="14" rx="3" fill="#B57CFF" stroke="#1B1430" strokeWidth="1.8" /><path d="M21 34h8M35 34h8" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><path d="M27 45h10" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /><text x="44" y="16" fontSize="9" fontWeight="900" fill="#1B1430">z</text></>}
      {s.key === "mainchar" && <><path d="M18 10l4 7 4-9 6 8 6-8 4 9 4-7-2 12H20z" fill="#FFE27A" stroke="#1B1430" strokeWidth="1.8" strokeLinejoin="round" /><rect x="15" y="27" width="14" height="8" rx="3" fill="#1B1430" /><rect x="35" y="27" width="14" height="8" rx="3" fill="#1B1430" /><path d="M29 30h6" stroke="#1B1430" strokeWidth="2" /><path d="M23 44c6 6 12 6 18 0" fill="none" stroke="#1B1430" strokeWidth="2.6" strokeLinecap="round" /></>}
    </svg>
  );
}
