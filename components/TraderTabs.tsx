"use client";
/** The switch at the top of the AI pages. Rage deploys. Add LP and Remove LP are separate. */
import Link from "next/link";
import { usePathname } from "next/navigation";

export const TRADER_TABS = [
  { href: "/admin/ai-trader", label: "🤖 TG Bot", sub: "Telegram calls · spot", acc: "#3b82f6" },
  { href: "/admin/ai-futures", label: "📊 Futures", sub: "Crypto · Hyperliquid", acc: "#10b981" },
  { href: "/admin/ai-forex", label: "💱 Forex", sub: "Currencies · trade.xyz", acc: "#06b6d4" },
  { href: "/admin/ai-copy", label: "👥 Copy", sub: "Copies wallets", acc: "#ec4899" },
  { href: "/admin/rage", label: "💧 Rage", sub: "Deploy the token", acc: "#ef4444" },
  { href: "/admin/add-lp", label: "➕ Add LP", sub: "Add liquidity", acc: "#f0b90b" },
  { href: "/admin/remove-lp", label: "➖ Remove LP", sub: "Take liquidity out", acc: "#f97316" },
  { href: "/admin/ai-earn", label: "💰 Earn", sub: "HLP vault · steady", acc: "#eab308" },
];

export default function TraderTabs() {
  const path = usePathname() || "";
  return (
    <nav className="ait-tabs" role="tablist" aria-label="Choose the AI to use">
      {TRADER_TABS.map((t) => {
        const on = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={on ? "on" : ""} style={{ ["--acc" as any]: t.acc }}>
            <b>{t.label}</b><br /><small className="muted">{t.sub}</small>
          </Link>
        );
      })}
    </nav>
  );
}
