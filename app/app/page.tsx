import Link from "next/link";

export const metadata = { title: "App · AUTISTIK Hub", description: "Every AUTISTIK tool in one place: swap, buy, launch, lock, stake and check any coin." };

type Tool = { href: string; icon: string; name: string; text: string; tone: string };

// The App's home: only the tools, one big tile each, the ones people use most first. One tap opens the tool.
const TOOLS: Tool[] = [
  { href: "/wallet?quick=1", icon: "🛒", name: "Buy a coin", text: "Pick a coin, pay a dollar amount, done.", tone: "sun" },
  { href: "/swap", icon: "🔄", name: "Swap", text: "Change one coin for another at the best price.", tone: "violet" },
  { href: "/wallet", icon: "👛", name: "My wallet", text: "See your coins, send and receive.", tone: "teal" },
  { href: "/analytics", icon: "🛡️", name: "Check a coin", text: "Paste an address: is it safe?", tone: "green" },
  { href: "/launchpad", icon: "🔥", name: "Trending", text: "Coins people are buying now.", tone: "coral" },
  { href: "/launchpad/new", icon: "🚀", name: "Launch a coin", text: "Your own coin in minutes, no code.", tone: "orange" },
  { href: "/lockers", icon: "🔒", name: "Lock", text: "Lock liquidity or team tokens.", tone: "teal" },
  { href: "/stake", icon: "🌱", name: "Stake", text: "Earn BNB with your $AUTISTIK.", tone: "green" },
  { href: "/momentum", icon: "⚡", name: "Momentum", text: "New coins picking up speed.", tone: "sun" },
  { href: "/rewards", icon: "🎁", name: "Rewards", text: "Points and $AUTISTIK airdrops.", tone: "violet" },
  { href: "/analytics/pins", icon: "👀", name: "Watchlist", text: "Coins you follow, in one list.", tone: "coral" },
  { href: "/perps", icon: "⚖️", name: "Perpetuals", text: "Long or short with leverage. Risky.", tone: "orange" },
];

export default function AppHome() {
  return (
    <div className="ah">
      <h1 className="ah-title">What do you want to do?</h1>
      <nav className="ah-grid" aria-label="Tools">
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className={"ah-tool " + t.tone}>
            <span className="ah-icon" aria-hidden="true">{t.icon}</span>
            <b>{t.name}</b>
            <small>{t.text}</small>
          </Link>
        ))}
      </nav>
      <p className="ah-note">New to crypto? <Link href="/start">Start here</Link> for plain-English help. Never share your seed phrase.</p>
    </div>
  );
}
