import Link from "next/link";

export type SectionTab = { href: string; label: string };

/** Tabs at the top of a section that groups several pages under one menu item. */
export default function SectionTabs({ tabs, active, label }: { tabs: SectionTab[]; active: string; label: string }) {
  return (
    <nav className="section-tabs" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="section-tab" aria-current={t.href === active ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

// Chat & Community: talking to Believer and Purity comes first, then the groups and live sessions.
export const COMMUNITY_TABS: SectionTab[] = [
  { href: "/companions", label: "💬 Chat" },
  { href: "/community", label: "Groups" },
  { href: "/sessions", label: "Live sessions" },
];

// Launch: make a token, then everything about trading them.
export const LAUNCH_TABS: SectionTab[] = [
  { href: "/launchpad/new", label: "🚀 Launch" },
  { href: "/launchpad", label: "Trending" },
  { href: "/perps", label: "Perps" },
  { href: "/lockers", label: "🔒 Lockers" },
];

export const TOKEN_TABS: SectionTab[] = [
  { href: "/buy", label: "Buy $AUTISTIK" },
  { href: "/rewards", label: "Rewards & airdrops" },
  { href: "/fund", label: "AUTISTIK Fund" },
];
