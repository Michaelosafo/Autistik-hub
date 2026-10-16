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

export const COMMUNITY_TABS: SectionTab[] = [
  { href: "/community", label: "Groups" },
  { href: "/sessions", label: "Live sessions" },
];

export const TRENDING_TABS: SectionTab[] = [
  { href: "/launchpad/new", label: "🚀 Launch" },
  { href: "/launchpad", label: "Trending" },
  { href: "/trade", label: "Trade" },
];

export const TOKEN_TABS: SectionTab[] = [
  { href: "/buy", label: "Buy $AUTISTIK" },
  { href: "/rewards", label: "Rewards & airdrops" },
  { href: "/fund", label: "AUTISTIK Fund" },
];
