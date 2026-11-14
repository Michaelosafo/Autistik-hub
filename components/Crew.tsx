/**
 * The AUTISTIK crew: original, friendly illustrated characters for the front page (drawn here in SVG, no photos).
 * Each one has their own look and a playful name; several carry things many autistic people use and love
 * (noise-cancelling headphones, a sunflower lanyard, fidget toys, a favourite cap). Colours follow the site.
 */
type Hair = "puff" | "bun" | "short" | "long" | "locs" | "buzz" | "curly";
type Acc = "headphones" | "glasses" | "cap" | "sunflower" | "fidget" | "beanie" | "star";
export type Mate = { name: string; tag: string; skin: string; hair: Hair; hairC: string; shirt: string; bg: [string, string]; acc: Acc[]; smile?: "big" | "soft" | "tongue" };

export const CREW: Mate[] = [
  { name: "Kofi", tag: "Calm mode on", skin: "#7A4A2A", hair: "puff", hairC: "#1B120C", shirt: "#B57CFF", bg: ["#FFD84D", "#FF9F5A"], acc: ["headphones"], smile: "big" },
  { name: "Ama", tag: "Pattern spotter", skin: "#5C3520", hair: "locs", hairC: "#1A110B", shirt: "#4FD1FF", bg: ["#B57CFF", "#FF6B9A"], acc: ["sunflower", "glasses"], smile: "soft" },
  { name: "Leo", tag: "Space nerd", skin: "#F1C8A5", hair: "curly", hairC: "#B5651D", shirt: "#FF6B9A", bg: ["#4FD1FF", "#5BE38F"], acc: ["fidget"], smile: "tongue" },
  { name: "Mei", tag: "Lego architect", skin: "#E9C19A", hair: "bun", hairC: "#2B1B12", shirt: "#5BE38F", bg: ["#FF6B9A", "#FFD84D"], acc: ["glasses"], smile: "big" },
  { name: "Zara", tag: "Stim queen", skin: "#9A6440", hair: "long", hairC: "#3A2214", shirt: "#FFD84D", bg: ["#5BE38F", "#4FD1FF"], acc: ["star", "headphones"], smile: "big" },
  { name: "Theo", tag: "Train facts 24/7", skin: "#FAD7B8", hair: "short", hairC: "#E0B04C", shirt: "#4FD1FF", bg: ["#FFD84D", "#B57CFF"], acc: ["cap"], smile: "soft" },
  { name: "Nana", tag: "Deep diver", skin: "#6B3F26", hair: "buzz", hairC: "#120C08", shirt: "#FF9F5A", bg: ["#B57CFF", "#4FD1FF"], acc: ["beanie", "sunflower"], smile: "big" },
  { name: "Ivy", tag: "Night owl coder", skin: "#F3D2B5", hair: "long", hairC: "#7A2E8E", shirt: "#B57CFF", bg: ["#FF9F5A", "#FF6B9A"], acc: ["headphones", "glasses"], smile: "soft" },
  { name: "Sol", tag: "Hype buddy", skin: "#C58A5E", hair: "curly", hairC: "#2A1A10", shirt: "#FF6B9A", bg: ["#FFD84D", "#5BE38F"], acc: ["cap", "fidget"], smile: "tongue" },
];

function HairBack({ h, c }: { h: Hair; c: string }) {
  if (h === "long") return <path d="M26 46c-4 18 0 34 6 44h56c6-10 10-26 6-44-6-20-62-20-68 0z" fill={c} />;
  if (h === "locs") return <g fill={c}>{[30, 38, 46, 74, 82, 90].map((x) => <rect key={x} x={x - 3} y={44} width={7} height={40} rx={3.5} />)}</g>;
  if (h === "puff") return <circle cx="60" cy="30" r="28" fill={c} />;
  if (h === "bun") return <circle cx="60" cy="16" r="13" fill={c} />;
  return null;
}
function HairFront({ h, c }: { h: Hair; c: string }) {
  switch (h) {
    case "short": return <path d="M33 50c0-18 12-28 27-28s27 10 27 28c-8-8-18-11-27-11S41 42 33 50z" fill={c} />;
    case "buzz": return <path d="M34 48c1-15 12-24 26-24s25 9 26 24c-8-6-17-8-26-8s-18 2-26 8z" fill={c} opacity=".92" />;
    case "curly": return <g fill={c}>{[38, 48, 60, 72, 82, 44, 66, 78, 54].map((x, i) => <circle key={i} cx={x} cy={i < 5 ? 34 + (i % 2) * 3 : 28} r={9} />)}</g>;
    case "long": return <path d="M32 52c0-20 12-30 28-30s28 10 28 30c-6-10-16-14-28-14S38 42 32 52z" fill={c} />;
    case "locs": return <path d="M32 50c0-19 12-29 28-29s28 10 28 29c-9-8-18-10-28-10s-19 2-28 10z" fill={c} />;
    case "puff": return <path d="M34 48c2-14 12-22 26-22s24 8 26 22c-8-5-17-7-26-7s-18 2-26 7z" fill={c} />;
    case "bun": return <path d="M33 50c0-19 12-28 27-28s27 9 27 28c-8-7-17-10-27-10s-19 3-27 10z" fill={c} />;
  }
}

/** One crew member, drawn at any size (square). */
export function Mate({ m, size = 120, id }: { m: Mate; size?: number; id: string }) {
  const g = `cg${id}`;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${m.name}, ${m.tag}`} className="mate">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={m.bg[0]} /><stop offset="1" stopColor={m.bg[1]} /></linearGradient>
      </defs>
      <rect width="120" height="120" rx="30" fill={`url(#${g})`} />
      <circle cx="96" cy="22" r="10" fill="#fff" opacity=".18" />
      <circle cx="18" cy="96" r="14" fill="#fff" opacity=".12" />
      <HairBack h={m.hair} c={m.hairC} />
      {/* body */}
      <path d="M22 120c2-20 18-32 38-32s36 12 38 32z" fill={m.shirt} />
      <path d="M50 90l10 8 10-8" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" />
      {/* neck + head */}
      <rect x="52" y="74" width="16" height="16" rx="6" fill={m.skin} />
      <ellipse cx="60" cy="54" rx="26" ry="28" fill={m.skin} />
      <ellipse cx="34" cy="56" rx="4.5" ry="6" fill={m.skin} /><ellipse cx="86" cy="56" rx="4.5" ry="6" fill={m.skin} />
      <HairFront h={m.hair} c={m.hairC} />
      {/* face */}
      <ellipse cx="49" cy="64" rx="5" ry="3.2" fill="#FF6B9A" opacity=".35" /><ellipse cx="71" cy="64" rx="5" ry="3.2" fill="#FF6B9A" opacity=".35" />
      <g fill="#1B1330"><ellipse cx="50" cy="56" rx="3.4" ry="4" /><ellipse cx="70" cy="56" rx="3.4" ry="4" /></g>
      <g fill="#fff"><circle cx="51.2" cy="54.6" r="1.2" /><circle cx="71.2" cy="54.6" r="1.2" /></g>
      {m.smile === "tongue"
        ? <g><path d="M50 67c4 6 16 6 20 0" fill="#1B1330" /><path d="M56 70c1 4 7 4 8 0" fill="#FF6B9A" /></g>
        : m.smile === "soft" ? <path d="M52 68c4 4 12 4 16 0" fill="none" stroke="#1B1330" strokeWidth="2.6" strokeLinecap="round" />
        : <path d="M49 66c4 8 18 8 22 0z" fill="#1B1330" />}
      {/* accessories */}
      {m.acc.includes("glasses") && <g fill="none" stroke="#1B1330" strokeWidth="2.4"><rect x="40" y="49" width="18" height="14" rx="6" /><rect x="62" y="49" width="18" height="14" rx="6" /><path d="M58 55h4" /></g>}
      {m.acc.includes("headphones") && <g><path d="M30 54c0-20 14-32 30-32s30 12 30 32" fill="none" stroke="#1B1330" strokeWidth="5" strokeLinecap="round" /><rect x="24" y="48" width="12" height="20" rx="6" fill="#1B1330" /><rect x="84" y="48" width="12" height="20" rx="6" fill="#1B1330" /><rect x="26" y="52" width="8" height="12" rx="4" fill="#FFD84D" /><rect x="86" y="52" width="8" height="12" rx="4" fill="#FFD84D" /></g>}
      {m.acc.includes("cap") && <g><path d="M33 42c2-14 13-22 27-22s25 8 27 22z" fill="#1B1330" /><path d="M60 40h34c0 4-6 6-14 6H60z" fill="#1B1330" /><circle cx="60" cy="30" r="4" fill="#FFD84D" /></g>}
      {m.acc.includes("beanie") && <g><path d="M33 44c0-16 12-26 27-26s27 10 27 26z" fill="#FF6B9A" /><rect x="31" y="40" width="58" height="9" rx="4.5" fill="#B57CFF" /><circle cx="60" cy="16" r="6" fill="#FFD84D" /></g>}
      {m.acc.includes("sunflower") && <g><path d="M44 88l16 18 16-18" fill="none" stroke="#2EBD85" strokeWidth="4" /><circle cx="60" cy="106" r="7" fill="#FFD84D" /><circle cx="60" cy="106" r="3" fill="#7A4A2A" /></g>}
      {m.acc.includes("fidget") && <g transform="translate(92 92)"><circle r="9" fill="#4FD1FF" /><circle cx="0" cy="-8" r="5" fill="#FFD84D" /><circle cx="7" cy="5" r="5" fill="#FF6B9A" /><circle cx="-7" cy="5" r="5" fill="#5BE38F" /><circle r="3" fill="#1B1330" /></g>}
      {m.acc.includes("star") && <path d="M94 18l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6-4.5-4 6-1z" fill="#fff" />}
    </svg>
  );
}

/** A row of the crew that keeps scrolling (pauses on hover; still for "reduce motion"). */
export function CrewMarquee() {
  const row = [...CREW, ...CREW];
  return (
    <div className="crew" aria-label="The AUTISTIK crew">
      <div className="crew-track">
        {row.map((m, i) => (
          <figure key={i} className="crew-card" aria-hidden={i >= CREW.length || undefined}>
            <Mate m={m} size={104} id={`m${i}`} />
            <figcaption><b>{m.name}</b><small>{m.tag}</small></figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** The hero's big character: Kofi with floating badges. */
export function CrewHero() {
  return (
    <div className="crew-hero" aria-hidden="true">
      <div className="crew-hero-glow" />
      <div className="crew-hero-main"><Mate m={CREW[0]} size={300} id="hero" /></div>
      <span className="crew-pill p1">∞ Different, not less</span>
      <span className="crew-pill p2">🎧 Calm mode on</span>
      <span className="crew-pill p3">💛 1 community</span>
      <div className="crew-mini m1"><Mate m={CREW[1]} size={84} id="h1" /></div>
      <div className="crew-mini m2"><Mate m={CREW[2]} size={70} id="h2" /></div>
    </div>
  );
}
