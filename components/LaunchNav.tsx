import Link from "next/link";

// The Launch section, as big cards so every part is easy to find.
const ITEMS = [
  { href: "/launchpad/new", icon: "🚀", name: "Launch", blurb: "Make your own token in minutes", tone: "coral" },
  { href: "/launchpad", icon: "📈", name: "Trending", blurb: "What everyone is watching", tone: "violet" },
  { href: "/momentum", icon: "🔥", name: "Momentum", blurb: "Fast movers & quick 2x ideas", tone: "sun" },
  { href: "/lockers", icon: "🔒", name: "Lockers", blurb: "Lock liquidity & tokens", tone: "teal" },
  { href: "/perps", icon: "⚡", name: "Perps", blurb: "Trade long or short", tone: "ink" },
] as const;

export default function LaunchNav({ active }: { active: string }) {
  return (
    <nav className="launch-nav" aria-label="Launch">
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className={`ln-card ${i.tone}`} aria-current={i.href === active ? "page" : undefined}>
          <span className="ln-icon" aria-hidden="true">{i.icon}</span>
          <span className="ln-text"><b>{i.name}</b><small>{i.blurb}</small></span>
        </Link>
      ))}
    </nav>
  );
}
