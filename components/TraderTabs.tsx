"use client";
/**
 * The switch at the top of the AI pages: the AI traders, then the token tools grouped by chain.
 * Helper admins you add see only 📊 Futures and the shared 💧 BnbRage. Everything else is yours alone (the pages and
 * their APIs check that too), including 🔒 Personal BNB: Personal RageBNB + SniperBNB.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = { href: string; label: string; sub: string; acc: string; shared?: boolean };
export const TRADER_TABS: Tab[] = [
  { href: "/admin/ai-trader", label: "🤖 TG Bot", sub: "Telegram calls · spot", acc: "#3b82f6" },
  { href: "/admin/ai-futures", label: "📊 Futures", sub: "Crypto · Hyperliquid", acc: "#10b981", shared: true },
  { href: "/admin/ai-forex", label: "💱 Forex", sub: "Currencies · trade.xyz", acc: "#06b6d4" },
  { href: "/admin/ai-copy", label: "👥 Copy", sub: "Copies wallets", acc: "#ec4899" },
];
export const CHAIN_GROUPS: { name: string; acc: string; ownerOnly: boolean; tabs: Tab[] }[] = [
  { name: "🟡 BNB Chain · shared with your admins", acc: "#F0B90B", ownerOnly: false, tabs: [
    { href: "/admin/rage", label: "💧 BnbRage", sub: "Team wallets · deploy · add · remove", acc: "#ef4444", shared: true },
  ] },
  { name: "🔒 Personal BNB", acc: "#F0B90B", ownerOnly: true, tabs: [
    { href: "/admin/rage-personal", label: "🔒 Personal RageBNB", sub: "Your wallet · deploy · add · remove", acc: "#ef4444" },
    { href: "/admin/ai-snipe-bsc", label: "⚡ SniperBNB", sub: "Buys when liquidity lands", acc: "#22c55e" },
  ] },
  { name: "🔷 Ethereum", acc: "#627EEA", ownerOnly: true, tabs: [
    { href: "/admin/ethrise", label: "🔷 EthRise", sub: "Deploy · add · remove", acc: "#627EEA" },
    { href: "/admin/sniper-eth", label: "🔷 SniperEth", sub: "Buys when liquidity lands", acc: "#627EEA" },
  ] },
  { name: "🪶 Robinhood Chain", acc: "#00C805", ownerOnly: true, tabs: [
    { href: "/admin/wanarobinhood", label: "🪶 WanaRobinhood", sub: "Deploy · add · remove", acc: "#00C805" },
    { href: "/admin/sniper-robinhood", label: "🪶 SniperRobinhood", sub: "Buys when liquidity lands", acc: "#00C805" },
  ] },
  { name: "🟣 Solana", acc: "#9945FF", ownerOnly: true, tabs: [
    { href: "/admin/lobbysol", label: "🟣 LobbySol", sub: "Deploy · add · remove", acc: "#9945FF" },
    { href: "/admin/sniperlobbysol", label: "🎯 SniperLobbySol", sub: "Buys when it can be bought", acc: "#14F195" },
  ] },
];

let ownerCache: boolean | null = null;

export default function TraderTabs() {
  const path = usePathname() || "";
  const [owner, setOwner] = useState<boolean>(ownerCache ?? false);
  useEffect(() => {
    if (ownerCache != null) return;
    fetch("/api/admin/whoami", { cache: "no-store" }).then((r) => r.json()).then((d) => { ownerCache = d?.owner === true; setOwner(ownerCache); }).catch(() => {});
  }, []);
  const tab = (t: Tab) => {
    const on = path === t.href || path.startsWith(t.href + "/");
    return (
      <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={on ? "on" : ""} style={{ ["--acc" as any]: t.acc }}>
        <b>{t.label}</b><br /><small className="muted">{t.sub}</small>
      </Link>
    );
  };
  const groups = CHAIN_GROUPS.filter((g) => owner || !g.ownerOnly);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <nav className="ait-tabs" role="tablist" aria-label="Choose the AI to use">{TRADER_TABS.filter((t) => owner || t.shared).map(tab)}</nav>
      {groups.map((g) => (
        <div key={g.name} className="stack" style={{ gap: 4, borderLeft: `3px solid ${g.acc}`, paddingLeft: 8 }}>
          <small style={{ fontWeight: 800 }}>{g.name}{g.ownerOnly ? <span className="muted" style={{ fontWeight: 400 }}> · only you</span> : null}</small>
          <nav className="ait-tabs" role="tablist" aria-label={`${g.name} tools`}>{g.tabs.map(tab)}</nav>
        </div>
      ))}
    </div>
  );
}
