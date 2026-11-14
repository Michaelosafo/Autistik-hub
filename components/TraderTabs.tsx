"use client";
/** The switch at the top of the AI pages: the Telegram copy-trading Bot, Futures, Forex, Turbo or Sniper. Each side has its own Practice / Live mode. */
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TraderTabs() {
  const path = usePathname() || "";
  const tabs = [
    { href: "/admin/ai-trader", label: "🤖 TG Bot", sub: "Telegram calls · spot coins" },
    { href: "/admin/ai-futures", label: "📊 Futures", sub: "Crypto · Hyperliquid / Aster" },
    { href: "/admin/ai-forex", label: "💱 Forex", sub: "Currencies · trade.xyz" },
    { href: "/admin/ai-turbo", label: "🚀 Turbo", sub: "High risk · 15x futures" },
    { href: "/admin/ai-sniper", label: "🎯 Sniper", sub: "High risk · new launches" },
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
