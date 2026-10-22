/**
 * A goofy cartoon footballer for the game arena, drawn in SVG with its feet at (0, 0) and about 100 units tall.
 * Every wallet gets its own look (skin, hair, eyes, mouth, boots) from its address, so the same holder always looks
 * the same. Shading comes from the shared gradients in <PlayerDefs />, which every SVG that draws players includes once.
 */
export type Mood = "chill" | "nervous" | "ready" | "paper" | "gone" | "ghost";
type Props = { wallet: string; kit: string; trim?: string; number?: number; mood?: Mood; keeper?: boolean; you?: boolean; dev?: boolean };

const SKIN = ["#FFDBB8", "#F4C69E", "#E0A872", "#B97A48", "#8A5631", "#FFE4CE"];
const HAIR = ["#2B1A10", "#6B3B1F", "#E8B64A", "#D2462E", "#111111", "#7A5CFF", "#F5F5F5"];
const BOOTS = ["#111111", "#FF3D7F", "#00C2FF", "#FFD400", "#FFFFFF"];
const INK = "#1A1420";

/** A small number generator seeded from the wallet, so a look never changes between visits. */
export function seed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

/** Light and shade shared by every player (one copy per SVG). */
export function PlayerDefs() {
  return (
    <>
      <radialGradient id="pl-shine" cx=".35" cy=".28" r=".75"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" /></radialGradient>
      <linearGradient id="pl-cloth" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".35" /></linearGradient>
      <radialGradient id="pl-ground" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#000" stopOpacity=".45" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
      <radialGradient id="pl-ghost" cx=".5" cy=".4" r=".6"><stop offset="0" stopColor="#E9F1FF" /><stop offset="1" stopColor="#9FB0D0" /></radialGradient>
    </>
  );
}

export default function Player({ wallet, kit, trim = "#fff", number, mood = "chill", keeper, you, dev }: Props) {
  const r = seed(wallet.toLowerCase());
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const ghost = mood === "ghost";
  const skin = ghost ? "#DCE6F7" : pick(SKIN), hairC = pick(HAIR), hair = Math.floor(r() * 6), eyes = Math.floor(r() * 6), mouth = Math.floor(r() * 6);
  const boots = pick(BOOTS), bigNose = r() > 0.55, ears = r() > 0.4, stripes = r() > 0.6;
  const shirt = ghost ? "url(#pl-ghost)" : kit;
  const worried = mood === "nervous" || mood === "ready";
  const hy = -70; // head centre
  const glove = keeper ? "#FFD84D" : skin;
  return (
    <g className="pl-body">
      <ellipse cx="0" cy="0" rx="26" ry="8" fill="url(#pl-ground)" />
      {/* legs, socks and boots */}
      <g className="pl-legs" stroke={INK} strokeWidth="2">
        <rect x="-11" y="-21" width="8" height="18" rx="3.5" fill={skin} />
        <rect x="3" y="-21" width="8" height="18" rx="3.5" fill={skin} />
        <rect x="-12" y="-14" width="10" height="10" rx="2" fill={trim} />
        <rect x="2" y="-14" width="10" height="10" rx="2" fill={trim} />
        <path d="M-17 -1 q0 -7 8 -7 q6 0 7 6 v2 h-15z" fill={boots} />
        <path d="M17 -1 q0 -7 -8 -7 q-6 0 -7 6 v2 h15z" fill={boots} />
      </g>
      <path d="M-14 -5 h5 M9 -5 h5" stroke="#fff" strokeWidth="1.5" opacity=".7" />
      {/* shorts */}
      <path d="M-19 -26 h38 l2 10 h-16 l-3 -4 l-3 4 h-16z" fill={ghost ? "#C9D4EA" : "#1C2433"} stroke={INK} strokeWidth="2" />
      {/* arms, flapping */}
      <g className="pl-arm l"><g transform="rotate(25 -25 -45)"><rect x="-30" y="-48" width="10" height="25" rx="5" fill={shirt} stroke={INK} strokeWidth="2" /><rect x="-30" y="-48" width="10" height="25" rx="5" fill="url(#pl-cloth)" /></g>
        <circle cx="-33" cy="-25" r={keeper ? 8.5 : 5.5} fill={glove} stroke={INK} strokeWidth="2" /></g>
      <g className="pl-arm r"><g transform="rotate(-25 25 -45)"><rect x="20" y="-48" width="10" height="25" rx="5" fill={shirt} stroke={INK} strokeWidth="2" /><rect x="20" y="-48" width="10" height="25" rx="5" fill="url(#pl-cloth)" /></g>
        <circle cx="33" cy="-25" r={keeper ? 8.5 : 5.5} fill={glove} stroke={INK} strokeWidth="2" />
        {mood === "paper" && <g transform="translate(37 -34) rotate(12)"><rect x="-6" y="-9" width="12" height="16" rx="2" fill="#fff" stroke={INK} strokeWidth="1.5" /><circle cx="0" cy="-9" r="6" fill="#fff" stroke={INK} strokeWidth="1.5" /><circle cx="0" cy="-9" r="2" fill="#ccc" /></g>}
      </g>
      {/* jersey */}
      <path d="M-20 -50 Q0 -57 20 -50 L22 -24 Q0 -20 -22 -24 Z" fill={shirt} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {stripes && !ghost && <path d="M-9 -54 v32 M9 -54 v32" stroke={trim} strokeWidth="5" opacity=".55" />}
      <path d="M-20 -50 Q0 -57 20 -50 L22 -24 Q0 -20 -22 -24 Z" fill="url(#pl-cloth)" />
      <path d="M-8 -54 Q0 -46 8 -54" fill="none" stroke={trim} strokeWidth="3" strokeLinecap="round" />
      {number != null && <text y="-30" textAnchor="middle" className="pl-num" fill={trim} stroke={INK} strokeWidth="1" paintOrder="stroke">{number}</text>}
      {/* head */}
      {ears && <><circle cx="-24" cy={hy + 2} r="6" fill={skin} stroke={INK} strokeWidth="2" /><circle cx="24" cy={hy + 2} r="6" fill={skin} stroke={INK} strokeWidth="2" /></>}
      <circle cx="0" cy={hy} r="24" fill={skin} stroke={INK} strokeWidth="2.4" />
      <circle cx="0" cy={hy} r="24" fill="url(#pl-shine)" />
      <Hair kind={hair} color={you ? "#FFB300" : ghost ? "#C9D4EA" : hairC} kit={ghost ? "#C9D4EA" : kit} />
      <Eyes kind={ghost ? 2 : eyes} worried={worried} />
      {bigNose ? <><ellipse cx="2" cy={hy + 4} rx="6.5" ry="5.5" fill="#F08C7A" stroke={INK} strokeWidth="1.5" /><circle cx="0" cy={hy + 2} r="1.8" fill="#fff" opacity=".7" /></>
        : <path d={`M0 ${hy - 1} q4 6 -1 8`} stroke="rgba(0,0,0,.45)" strokeWidth="2" fill="none" strokeLinecap="round" />}
      <Mouth kind={worried || ghost ? 3 : mouth} />
      {(mood === "chill" || mood === "paper") && <><circle cx="-14" cy={hy + 9} r="4" fill="#FF7A7A" opacity=".35" /><circle cx="14" cy={hy + 9} r="4" fill="#FF7A7A" opacity=".35" /></>}
      {worried && <path className="pl-sweat" d={`M23 ${hy - 14} q5 8 0 11 q-5 -3 0 -11z`} fill="#6EC6FF" stroke="#2E8BD0" strokeWidth="1" />}
      {ghost && <ellipse cx="0" cy={hy - 30} rx="15" ry="4" fill="none" stroke="#FFE58F" strokeWidth="3" />}
      {dev && <text x="0" y={hy - 26} textAnchor="middle" fontSize="20">👑</text>}
    </g>
  );
}

function Hair({ kind, color, kit }: { kind: number; color: string; kit: string }) {
  const y = -70;
  const st = { stroke: INK, strokeWidth: 2, strokeLinejoin: "round" as const };
  switch (kind) {
    case 0: return <path d={`M-22 ${y - 6} l6 -18 l6 12 l6 -16 l6 14 l6 -15 l5 13 l6 -10 l3 20 Q0 ${y - 22} -22 ${y - 6}z`} fill={color} {...st} />; // spikes
    case 1: return <g fill={color} {...st}>{[-18, -9, 0, 9, 18, -13, 13, -4, 5].map((x, i) => <circle key={i} cx={x} cy={y - 18 - (i > 4 ? 8 : 0) + Math.abs(x) * 0.3} r="11" />)}</g>; // afro
    case 2: return <ellipse cx="-8" cy={y - 15} rx="7" ry="3.5" fill="#fff" opacity=".6" transform={`rotate(-25 -8 ${y - 15})`} />; // shiny bald
    case 3: return <path d={`M-5 ${y - 23} l2 -14 l3 10 l3 -12 l3 12 l2 -9 l2 13 Q0 ${y - 26} -5 ${y - 23}z`} fill={color} {...st} />; // mohawk
    case 4: return <g {...st}><path d={`M-24 ${y - 6} Q-22 ${y - 30} 0 ${y - 30} Q22 ${y - 30} 24 ${y - 6} z`} fill={kit} /><path d={`M4 ${y - 8} q22 -3 30 4 q-14 3 -30 2z`} fill={kit} /><path d={`M-24 ${y - 6} Q-22 ${y - 30} 0 ${y - 30} Q22 ${y - 30} 24 ${y - 6} z`} fill="url(#pl-cloth)" stroke="none" /></g>; // cap
    default: return <path d={`M-24 ${y - 2} Q-26 ${y - 30} 2 ${y - 28} Q26 ${y - 27} 24 ${y - 6} Q12 ${y - 20} -6 ${y - 16} Q-16 ${y - 14} -24 ${y - 2}z`} fill={color} {...st} />; // floppy
  }
}

function Eyes({ kind, worried }: { kind: number; worried: boolean }) {
  const y = -74;
  const brows = worried
    ? <g stroke="#2B1A10" strokeWidth="3" strokeLinecap="round"><path d={`M-16 ${y - 7} l9 -4`} /><path d={`M16 ${y - 7} l-9 -4`} /></g>
    : null;
  const glint = (x: number, yy: number) => <circle cx={x} cy={yy} r="1.3" fill="#fff" />;
  let e;
  switch (kind) {
    case 0: e = <g><circle cx="-9" cy={y} r="8" fill="#fff" stroke={INK} strokeWidth="1.8" /><circle cx="10" cy={y - 1} r="5.5" fill="#fff" stroke={INK} strokeWidth="1.8" /><circle cx="-6" cy={y + 3} r="3.5" fill="#111" /><circle cx="8" cy={y - 3} r="2.8" fill="#111" />{glint(-7, y + 2)}{glint(7.5, y - 4)}</g>; break; // googly
    case 1: e = <g><rect x="-20" y={y - 6} width="17" height="10" rx="2" fill="#111" /><rect x="3" y={y - 6} width="17" height="10" rx="2" fill="#111" /><rect x="-3" y={y - 4} width="6" height="3" fill="#111" /><rect x="-18" y={y - 5} width="6" height="2" fill="#fff" opacity=".8" /><rect x="5" y={y - 5} width="6" height="2" fill="#fff" opacity=".8" /></g>; break; // deal-with-it shades
    case 2: e = <g><circle cx="-9" cy={y} r="7" fill="#fff" stroke={INK} strokeWidth="1.8" /><circle cx="9" cy={y} r="7" fill="#fff" stroke={INK} strokeWidth="1.8" /><circle cx="-9" cy={y} r="2.2" fill="#111" /><circle cx="9" cy={y} r="2.2" fill="#111" /></g>; break; // wide stare
    case 3: e = <g stroke="#111" strokeWidth="3" strokeLinecap="round" fill="none"><path d={`M-15 ${y} q6 -6 12 0`} /><circle cx="9" cy={y} r="4" fill="#111" stroke="none" />{glint(10.5, y - 1.5)}</g>; break; // wink
    case 4: e = <g fill="#FFD84D" stroke="#B8860B" strokeWidth="1"><path d={`M-9 ${y - 7} l2 5 5 0 -4 3 2 5 -5 -3 -5 3 2 -5 -4 -3 5 0z`} /><path d={`M9 ${y - 7} l2 5 5 0 -4 3 2 5 -5 -3 -5 3 2 -5 -4 -3 5 0z`} /></g>; break; // star-struck
    default: e = <g><ellipse cx="-9" cy={y} rx="6" ry="8" fill="#fff" stroke={INK} strokeWidth="1.8" /><ellipse cx="9" cy={y} rx="6" ry="8" fill="#fff" stroke={INK} strokeWidth="1.8" /><circle cx="-7" cy={y + 1} r="3" fill="#111" /><circle cx="7" cy={y + 1} r="3" fill="#111" />{glint(-6, y)}{glint(8, y)}</g>; // cross-eyed
  }
  return <g>{e}{brows}</g>;
}

function Mouth({ kind }: { kind: number }) {
  const y = -58;
  switch (kind) {
    case 0: return <g><path d={`M-12 ${y - 2} Q0 ${y + 14} 12 ${y - 2} z`} fill="#7A1F1F" stroke={INK} strokeWidth="1.5" /><path d={`M-10 ${y - 1} h20 v3 h-20z`} fill="#fff" /><path d={`M-5 ${y + 6} q5 -3 10 0 q-5 3 -10 0z`} fill="#FF6F91" /></g>; // big grin
    case 1: return <g><path d={`M-10 ${y} Q0 ${y + 6} 10 ${y}`} stroke="#5A1A1A" strokeWidth="2.5" fill="none" strokeLinecap="round" /><path d={`M-2 ${y + 3} q4 12 9 0z`} fill="#FF6F91" stroke="#C2405F" strokeWidth="1" /></g>; // tongue out
    case 2: return <g><path d={`M-9 ${y} Q0 ${y + 7} 9 ${y}`} stroke="#5A1A1A" strokeWidth="2.5" fill="none" strokeLinecap="round" /><rect x="-5" y={y + 1} width="5" height="7" rx="1" fill="#fff" stroke="#999" strokeWidth=".8" /><rect x="0" y={y + 1} width="5" height="7" rx="1" fill="#fff" stroke="#999" strokeWidth=".8" /></g>; // buck teeth
    case 3: return <ellipse cx="0" cy={y + 3} rx="5" ry="6.5" fill="#5A1A1A" stroke={INK} strokeWidth="1.2" />; // "oh no"
    case 4: return <path d={`M-12 ${y + 1} q4 -5 8 0 q4 5 8 0 q4 -5 8 0`} stroke="#5A1A1A" strokeWidth="2.5" fill="none" strokeLinecap="round" />; // wobbly
    default: return <path d={`M-8 ${y + 2} Q4 ${y + 8} 12 ${y - 4}`} stroke="#5A1A1A" strokeWidth="3" fill="none" strokeLinecap="round" />; // smirk
  }
}
