import Link from "next/link";

export type SectionCard = { href: string; name: string; blurb: string; tone: "coral" | "violet" | "sun" | "teal" | "ink" };

// $AUTISTIK on the website: buy the token and the community fund.
export const TOKEN_CARDS: SectionCard[] = [
  { href: "/buy", name: "Buy $AUTISTIK", blurb: "Official contract & how to buy", tone: "sun" },
  { href: "/fund", name: "AUTISTIK Fund", blurb: "Support for individuals", tone: "teal" },
];

// Earn, inside the App: staking and rewards.
export const EARN_CARDS: SectionCard[] = [
  { href: "/stake", name: "Stake", blurb: "Earn from platform fees", tone: "sun" },
  { href: "/rewards", name: "Rewards", blurb: "Points & airdrops", tone: "violet" },
];

/** A section's pages as big cards, so every part is easy to find. The current page is highlighted. */
export default function SectionCards({ items, active, label }: { items: SectionCard[]; active: string; label: string }) {
  return (
    <nav className={`launch-nav n${items.length}`} aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`ln-card ${i.tone}`} aria-current={i.href === active ? "page" : undefined}>
          <span className="ln-text"><b>{i.name}</b></span>
        </Link>
      ))}
    </nav>
  );
}
