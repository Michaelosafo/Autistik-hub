import Link from "next/link";

export type SectionCard = { href: string; icon: string; name: string; blurb: string; tone: "coral" | "violet" | "sun" | "teal" | "ink" };

// Launch: make a token, then everything about trading and protecting them.
export const LAUNCH_CARDS: SectionCard[] = [
  { href: "/launchpad/new", icon: "🚀", name: "Launch", blurb: "Make your own token in minutes", tone: "coral" },
  { href: "/launchpad", icon: "📈", name: "Trending", blurb: "What everyone is watching", tone: "violet" },
  { href: "/momentum", icon: "🔥", name: "Momentum", blurb: "Fast movers & quick 2x ideas", tone: "sun" },
  { href: "/lockers", icon: "🔒", name: "Lockers", blurb: "Lock liquidity & tokens", tone: "teal" },
  { href: "/perps", icon: "⚡", name: "Perps", blurb: "Trade long or short", tone: "ink" },
];

// Chat & Community: talking to Believer and Purity comes first, then the groups and live sessions.
export const COMMUNITY_CARDS: SectionCard[] = [
  { href: "/companions", icon: "💬", name: "Chat", blurb: "Talk with Believer & Purity", tone: "violet" },
  { href: "/community", icon: "👥", name: "Groups", blurb: "Find people like you", tone: "teal" },
  { href: "/sessions", icon: "🎙️", name: "Live sessions", blurb: "Join talks & events live", tone: "coral" },
];

// $AUTISTIK: buy the token, earn airdrops, and the community fund.
export const TOKEN_CARDS: SectionCard[] = [
  { href: "/buy", icon: "💰", name: "Buy $AUTISTIK", blurb: "Official contract & how to buy", tone: "sun" },
  { href: "/rewards", icon: "🎁", name: "Rewards", blurb: "Points & airdrops", tone: "violet" },
  { href: "/fund", icon: "💚", name: "AUTISTIK Fund", blurb: "Support for individuals", tone: "teal" },
];

/** A section's pages as big cards, so every part is easy to find. The current page is highlighted. */
export default function SectionCards({ items, active, label }: { items: SectionCard[]; active: string; label: string }) {
  return (
    <nav className={`launch-nav n${items.length}`} aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`ln-card ${i.tone}`} aria-current={i.href === active ? "page" : undefined}>
          <span className="ln-icon" aria-hidden="true">{i.icon}</span>
          <span className="ln-text"><b>{i.name}</b><small>{i.blurb}</small></span>
        </Link>
      ))}
    </nav>
  );
}
