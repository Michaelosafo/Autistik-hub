"use client";
/** The switch at the top of the AI pages: the copy-trading Bot or Futures. Each side has its own Practice / Live mode. */
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TraderTabs() {
  const path = usePathname() || "";
  const tabs = [
    { href: "/admin/ai-trader", label: "🤖 Bot", sub: "Copy calls · spot coins" },
    { href: "/admin/ai-futures", label: "📊 Futures", sub: "News, X & charts · Hyperliquid / Aster" },
  ];
  return (
    <nav className="ait-tabs" role="tablist" aria-label="Choose the AI to use">
      {tabs.map((t) => {
        const on = path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={on ? "on" : ""}>
            <b>{t.label}</b><br /><small className="muted">{t.sub}</small>
          </Link>
        );
      })}
    </nav>
  );
}
