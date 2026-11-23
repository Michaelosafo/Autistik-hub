"use client";
/**
 * The switch at the top of the AI pages: the AI traders, then the token tools grouped by chain.
 * Helper admins you add see everything except 🔷 EthRise, 🪶 WanaRobinhood, 🟣 LobbySol (with their snipers) and
 * 🔒 Personal RageBNB: those are yours alone (the pages and their APIs check that too).
 */
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = { href: string; label: string; sub: string; acc: string; shared?: boolean };
export const TRADER_TABS: Tab[] = [
  { href: "/admin/ai-trader", label: "🤖 TG Bot", sub: "Telegram calls · spot", acc: "#3b82f6", shared: true },
  { href: "/admin/ai-futures", label: "📊 Futures", sub: "Crypto · Hyperliquid", acc: "#10b981", shared: true },
  { href: "/admin/ai-forex", label: "💱 Forex", sub: "Currencies · trade.xyz", acc: "#06b6d4", shared: true },
  { href: "/admin/ai-copy", label: "👥 Copy", sub: "Copies wallets", acc: "#ec4899", shared: true },
  { href: "/signal", label: "📡 Signal", sub: "Swap · bridge via Bitget · only you", acc: "#00c2ff" },
];
/**
 * Each chain group is ONE tab (its deploy tool). Open it and a menu inside switches between the group's tools
 * (deploy / add / remove, and its sniper), instead of showing every pair side by side.
 */
export const CHAIN_GROUPS: { name: string; label: string; sub: string; acc: string; ownerOnly: boolean; tabs: Tab[] }[] = [
  { name: "🟡 BNB Chain · shared with your admins", label: "💧 BnbRage", sub: "Rage + SniperBNB · shared", acc: "#F0B90B", ownerOnly: false, tabs: [
    { href: "/admin/rage", label: "💧 Deploy · liquidity", sub: "Team wallets · deploy · add · remove", acc: "#ef4444", shared: true },
    { href: "/admin/ai-snipe-bsc", label: "⚡ SniperBNB", sub: "Buys when liquidity lands · team wallets", acc: "#22c55e", shared: true },
  ] },
  { name: "🔒 Personal BNB", label: "🔒 Personal RageBNB", sub: "Rage + SniperBNB · only you", acc: "#F0B90B", ownerOnly: true, tabs: [
    { href: "/admin/rage-personal", label: "💧 Deploy · liquidity", sub: "Your wallet · deploy · add · remove", acc: "#ef4444" },
    { href: "/admin/ai-snipe-bsc?g=personal", label: "⚡ SniperBNB", sub: "Buys when liquidity lands", acc: "#22c55e" },
  ] },
  { name: "🔷 Ethereum", label: "🔷 EthRise", sub: "Rage + SniperEth", acc: "#627EEA", ownerOnly: true, tabs: [
    { href: "/admin/ethrise", label: "💧 Deploy · liquidity", sub: "Deploy · add · remove", acc: "#627EEA" },
    { href: "/admin/sniper-eth", label: "🔷 SniperEth", sub: "Buys when liquidity lands", acc: "#627EEA" },
  ] },
  { name: "🪶 Robinhood Chain", label: "🪶 WanaRobinhood", sub: "Rage + SniperRobinhood", acc: "#00C805", ownerOnly: true, tabs: [
    { href: "/admin/wanarobinhood", label: "💧 Deploy · liquidity", sub: "Deploy · add · remove", acc: "#00C805" },
    { href: "/admin/sniper-robinhood", label: "🪶 SniperRobinhood", sub: "Buys when liquidity lands", acc: "#00C805" },
  ] },
  { name: "🟣 Solana", label: "🟣 LobbySol", sub: "Rage + SniperLobbySol", acc: "#9945FF", ownerOnly: true, tabs: [
    { href: "/admin/lobbysol", label: "💧 Deploy · liquidity", sub: "Deploy · add · remove", acc: "#9945FF" },
    { href: "/admin/sniperlobbysol", label: "🎯 SniperLobbySol", sub: "Buys when it can be bought", acc: "#14F195" },
  ] },
];

let ownerCache: boolean | null = null;

export default function TraderTabs() {
  const path = usePathname() || "";
  const g = useSearchParams()?.get("g") || "";
  /** Same page can sit in two menus (SniperBNB: shared BnbRage and your Personal RageBNB); ?g= says which one you opened. */
  const hit = (href: string) => {
    const [base, q] = href.split("?");
    const want = new URLSearchParams(q || "").get("g") || "";
    return (path === base || path.startsWith(base + "/")) && want === g;
  };
  const [owner, setOwner] = useState<boolean>(ownerCache ?? false);
  useEffect(() => {
    if (ownerCache != null) return;
    fetch("/api/admin/whoami", { cache: "no-store" }).then((r) => r.json()).then((d) => { ownerCache = d?.owner === true; setOwner(ownerCache); }).catch(() => {});
  }, []);
  const tab = (t: Tab) => {
    const on = hit(t.href);
    return (
      <Link key={t.href} href={t.href} role="tab" aria-selected={on} className={on ? "on" : ""} style={{ ["--acc" as any]: t.acc }}>
        <b>{t.label}</b><br /><small className="muted">{t.sub}</small>
      </Link>
    );
  };
  const groups = CHAIN_GROUPS.filter((g) => owner || !g.ownerOnly);
  const inGroup = (g: (typeof CHAIN_GROUPS)[number]) => g.tabs.some((t) => hit(t.href));
  const open = groups.find(inGroup);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <nav className="ait-tabs" role="tablist" aria-label="Choose the AI to use">{TRADER_TABS.filter((t) => owner || t.shared).map(tab)}</nav>
      <nav className="ait-tabs" role="tablist" aria-label="Token tools">
        {groups.map((g) => {
          const on = inGroup(g);
          return (
            <Link key={g.name} href={g.tabs[0].href} role="tab" aria-selected={on} className={on ? "on" : ""} style={{ ["--acc" as any]: g.acc }}>
              <b>{g.label}</b><br /><small className="muted">{g.sub}</small>
            </Link>
          );
        })}
      </nav>
      {open && open.tabs.length > 1 && (
        <div className="stack" style={{ gap: 4, borderLeft: `3px solid ${open.acc}`, paddingLeft: 8 }}>
          <small style={{ fontWeight: 800 }}>{open.label} menu{open.ownerOnly ? <span className="muted" style={{ fontWeight: 400 }}> · only you</span> : null}</small>
          <nav className="ait-tabs" role="tablist" aria-label={`${open.label} menu`}>{open.tabs.map(tab)}</nav>
        </div>
      )}
    </div>
  );
}
