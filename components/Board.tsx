"use client";
/**
 * The Board: every token launched (or listed) on AUTISTIK, live. Refreshes every few seconds; when the ranking
 * changes, cards glide to their new place, so you can watch coins climb to #1. King of the Hill is the top coin.
 * A strip at the top shows the coins trending on the Board right now. Tabs: Trending, Listed, New, Market cap, Gainers
 * (open one directly with ?tab=listed and so on). Filter by network. Create (top right) opens the launch page.
 */
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BoardToken } from "@/lib/board";
import { CHAINS } from "@/lib/launchpad";
import { NETWORKS } from "@/lib/connect";
import NetIcon from "@/components/connect/NetIcon";
import { listedAt } from "@/lib/listings";

export type Tab = "trending" | "listed" | "new" | "mcap" | "gainers";
const TABS: [Tab, string][] = [["trending", "🔥 Trending"], ["listed", "Listed tokens"], ["new", "New"], ["mcap", "Market cap"], ["gainers", "Gainers"]];
const REFRESH = 8000;

const usd = (n: number | null | undefined) => n == null ? "–" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(n < 1 ? 4 : 0)}`;
const ago = (iso: string) => {
  const s = Math.max(1, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${Math.floor(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const heat = (t: BoardToken) => (t.market?.volume24h ?? 0) + (t.market?.txns24h ?? 0) * 10;

function rank(list: BoardToken[], tab: Tab) {
  const l = [...list];
  if (tab === "listed") return rank(l.filter((t) => t.source === "listed"), "trending");
  if (tab === "new") return l.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (tab === "mcap") return l.sort((a, b) => (b.market?.marketCap ?? 0) - (a.market?.marketCap ?? 0));
  if (tab === "gainers") return l.filter((t) => t.market?.change24h != null).sort((a, b) => (b.market!.change24h ?? 0) - (a.market!.change24h ?? 0));
  return l.filter((t) => t.trend).sort((a, b) => (!!a.promotedUntil !== !!b.promotedUntil ? (a.promotedUntil ? -1 : 1) : heat(b) - heat(a)));
}

export default function Board({ initial, initialTab = "trending" }: { initial: BoardToken[]; initialTab?: Tab }) {
  const [tokens, setTokens] = useState(initial);
  const [tab, setTabState] = useState<Tab>(initialTab);
  // Keep the tab in the address, so the menu's Trending button and shared links open the same view.
  const setTab = (t: Tab) => { setTabState(t); try { const u = new URL(location.href); u.searchParams.set("tab", t); history.replaceState(null, "", u); } catch {} };
  const [chain, setChain] = useState<string>("all");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const known = useRef(new Set(initial.map((t) => t.chain + t.token)));

  // Live: refresh every few seconds while the tab is visible.
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const d = await fetch("/api/board", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (stop || !Array.isArray(d?.tokens)) return;
      const born = d.tokens.filter((t: BoardToken) => !known.current.has(t.chain + t.token)).map((t: BoardToken) => t.chain + t.token);
      born.forEach((k: string) => known.current.add(k));
      if (born.length) { setFresh(new Set(born)); setTimeout(() => setFresh(new Set()), 6000); }
      setTokens(d.tokens);
    };
    const id = setInterval(tick, REFRESH);
    return () => { stop = true; clearInterval(id); };
  }, [live]);

  const chains = useMemo(() => [...new Set(tokens.map((t) => t.chain))], [tokens]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rank(tokens.filter((t) => (chain === "all" || t.chain === chain) && (!s || t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || t.token.toLowerCase() === s)), tab);
  }, [tokens, tab, chain, q]);
  const king = useMemo(() => rank(tokens, "trending")[0], [tokens]);
  const hot = useMemo(() => rank(tokens, "trending").slice(0, 10), [tokens]);
  const listedCount = useMemo(() => tokens.filter((t) => t.source === "listed").length, [tokens]);

  // Cards glide from their old place to their new one when the ranking changes (FLIP).
  const grid = useRef<HTMLDivElement>(null);
  const prev = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const calm = document.documentElement.dataset.calm === "on" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>("[data-k]").forEach((c) => {
      const k = c.dataset.k!, r = c.getBoundingClientRect();
      now.set(k, r);
      const p = prev.current.get(k);
      if (!calm && p && (p.top !== r.top || p.left !== r.left)) {
        c.animate([{ transform: `translate(${p.left - r.left}px, ${p.top - r.top}px)` }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    prev.current = now;
  });

  const net = (k: string) => NETWORKS.find((n) => n.key === k) ?? { key: k, id: 0, name: CHAINS[k as keyof typeof CHAINS]?.name ?? k, short: k, color: "#8E7CC3" };

  return (
    <div className="bd">
      <header className="bd-top">
        <div>
          <h1>The Board</h1>
          <p className="muted">Every coin launched on AUTISTIK, live. <span className="bd-live"><i />{live ? "Live" : "Paused"}</span></p>
        </div>
        <Link href="/launchpad/new" className="bd-create">Create coin</Link>
      </header>

      {hot.length > 0 && (
        <section className="bd-hot" aria-label="Trending on the Board now">
          <button type="button" className="bd-hot-h" onClick={() => setTab("trending")}>🔥 Trending now</button>
          <div className="bd-hot-row">
            {hot.map((t, i) => (
              <Link key={t.chain + t.token} href={`/launchpad/${t.chain}/${t.token}`} className="bd-hot-chip">
                <span className="bd-hot-n">#{i + 1}</span><Logo t={t} /><b>${t.symbol}</b><Change v={t.market?.change24h} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {king && (
        <Link href={`/launchpad/${king.chain}/${king.token}`} className="bd-king">
          <span className="bd-crown" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor"/></svg></span>
          <Logo t={king} big />
          <div className="bd-king-t">
            <small>King of the Hill · #1 right now</small>
            <b>{king.name} <span>${king.symbol}</span></b>
            <span className="muted">{net(king.chain).name} · MC {usd(king.market?.marketCap)} · Vol {usd(king.market?.volume24h)}</span>
          </div>
          <Change v={king.market?.change24h} />
        </Link>
      )}
      {king && <Link href={`/swap?chain=${king.chain}&buy=${king.token}`} className="bd-buy bd-buy-king">Buy {king.symbol} now</Link>}

      <div className="bd-bar">
        <div className="bd-tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{k === "listed" && listedCount > 0 ? ` (${listedCount})` : ""}</button>)}
        </div>
        <input className="bd-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ticker or address" aria-label="Search coins" />
        <button type="button" className="bd-pause" onClick={() => setLive(!live)} aria-pressed={!live}>{live ? "Pause" : "Resume"}</button>
      </div>
      <div className="bd-nets" role="group" aria-label="Network">
        <button type="button" className={chain === "all" ? "on" : ""} onClick={() => setChain("all")}>All networks</button>
        {chains.map((k) => <button key={k} type="button" className={chain === k ? "on" : ""} onClick={() => setChain(k)}><NetIcon n={net(k) as any} size={16} />{net(k).name}</button>)}
      </div>

      {shown.length === 0 ? (
        tab === "listed"
          ? <div className="bd-empty">No listed tokens{chain !== "all" ? " on this network" : ""} yet.</div>
          : <div className="bd-empty">No coins here yet. <Link href="/launchpad/new">Be the first: create one →</Link></div>
      ) : (
        <div className="bd-grid" ref={grid}>
          {shown.map((t, i) => {
            const k = t.chain + t.token;
            return (
              <div key={k} data-k={k} className="bd-cell">
              <Link href={`/launchpad/${t.chain}/${t.token}`} className={"bd-card" + (fresh.has(k) ? " fresh" : "") + (i < 3 ? ` top${i + 1}` : "")}>
                <span className="bd-rank">#{i + 1}</span>
                <Logo t={t} />
                <div className="bd-info">
                  <b>{t.name}</b>
                  <span className="bd-sym">${t.symbol} <NetIcon n={net(t.chain) as any} size={13} /></span>
                  <span className="bd-mc">MC <b>{usd(t.market?.marketCap)}</b> <Change v={t.market?.change24h} /></span>
                  <small className="muted">Vol {usd(t.market?.volume24h)}{t.promotedUntil ? " · Promoted" : ""}</small>
                  <small className="bd-when" title={ago(t.created_at) + " ago"}>{t.source === "listed" ? "Listed" : "Launched"} {listedAt(t.created_at)}</small>
                </div>
              </Link>
              <Link href={`/swap?chain=${t.chain}&buy=${t.token}`} className="bd-buy" aria-label={`Buy ${t.symbol}`}>Buy</Link>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted bd-note">Updates every {REFRESH / 1000} seconds. Coins can go to zero: nothing here is financial advice.</p>
    </div>
  );
}

function Logo({ t, big }: { t: BoardToken; big?: boolean }) {
  const [bad, setBad] = useState(false);
  const cls = "bd-logo" + (big ? " big" : "");
  return t.logo && !bad ? <img className={cls} src={t.logo} alt="" loading="lazy" onError={() => setBad(true)} /> : <span className={cls} aria-hidden="true">{t.symbol.slice(0, 3)}</span>;
}

function Change({ v }: { v: number | null | undefined }) {
  if (v == null) return null;
  return <span className={"bd-ch " + (v >= 0 ? "up" : "down")}>{v >= 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%</span>;
}
