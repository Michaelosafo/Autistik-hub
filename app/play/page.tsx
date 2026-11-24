import Link from "next/link";

export const metadata = { title: "Tik Play · AUTISTIK games", description: "All AUTISTIK games in one place: Hyperfocus GP racing, Roll the Dice and free-chip Dice." };

/** Tik Play: the collection of AUTISTIK games. Add a game here (and to the Tik Play menu in AppShell) to list it. */
const GAMES: { href: string; emoji: string; name: string; tag: string; about: string; color: string }[] = [
  { href: "/hyperfocus#race", emoji: "🏎️", name: "Hyperfocus GP", tag: "Racing · free or win $AUTISTIK", about: "Race every holder of a coin in 3D, race your friends, or play to win $AUTISTIK.", color: "#EA580C" },
  { href: "/roll", emoji: "🎲", name: "Roll the Dice", tag: "Real AUTISTIK · 18+", about: "Hold $10 of AUTISTIK, put $0.50 in the pot, roll two dice: the highest roll takes it all.", color: "#F0B90B" },
  { href: "/dice", emoji: "🎯", name: "Dice", tag: "Free chips · no money", about: "Put free play chips in the pot every 30 seconds. Highest roll wins the chips.", color: "#7C3AED" },
];

export default function PlayPage() {
  return (
    <div className="tp stack">
      <header>
        <div className="dz-kick">AUTISTIK · TIK PLAY</div>
        <h1>🎮 Tik Play</h1>
        <p className="muted">All our games in one place. More games are on the way.</p>
      </header>
      <div className="tp-grid">
        {GAMES.map((g) => (
          <Link key={g.href} href={g.href} className="tp-card" style={{ ["--tp" as string]: g.color }}>
            <span className="tp-emoji" aria-hidden="true">{g.emoji}</span>
            <span className="tp-body">
              <b>{g.name}</b>
              <small>{g.tag}</small>
              <span className="muted">{g.about}</span>
            </span>
            <span className="tp-go" aria-hidden="true">Play ›</span>
          </Link>
        ))}
        <div className="tp-card tp-soon" aria-label="More games coming soon">
          <span className="tp-emoji" aria-hidden="true">✨</span>
          <span className="tp-body"><b>More games soon</b><span className="muted">New games will show up here.</span></span>
        </div>
      </div>
    </div>
  );
}
