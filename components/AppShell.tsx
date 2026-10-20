"use client";
import Link from "next/link";
import Art from "@/components/Art";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Tracker from "@/components/Tracker";
import WalletPicker from "@/components/connect/WalletPicker";
import { TOP_WALLETS, disconnectWallet, getState, pickWallet, restoreWallet, subscribe } from "@/lib/connect";

/** Pages that open inside the App (the trading interface). Everything else is the website. */
export const APP_PATHS = ["/swap", "/wallet", "/stake", "/rewards", "/lockers", "/analytics", "/momentum", "/launchpad", "/trade", "/perps", "/pro"];
export const isAppPath = (p: string) => APP_PATHS.some((a) => p === a || p.startsWith(a + "/"));

type Item = { href: string; name: string; note?: string };
const MENU: { name: string; match: string[]; items: Item[] }[] = [
  { name: "Trade", match: ["/swap", "/wallet", "/perps", "/trade"], items: [
    { href: "/swap", name: "Swap", note: "Trade any token at the best price" },
    { href: "/wallet", name: "Pro trading", note: "Chart, limit and stop-loss orders" },
    { href: "/perps", name: "Perpetuals", note: "Long or short with leverage" },
  ] },
  { name: "Earn", match: ["/stake", "/rewards"], items: [
    { href: "/stake", name: "Stake", note: "Earn BNB from platform fees, up to 3x" },
    { href: "/rewards", name: "Rewards", note: "Points and $AUTISTIK airdrops" },
  ] },
  { name: "Launch", match: ["/launchpad", "/momentum"], items: [
    { href: "/launchpad/new", name: "Launch a token", note: "Liquidity locked, no code" },
    { href: "/launchpad", name: "Trending", note: "What people are buying" },
    { href: "/momentum", name: "Momentum", note: "New coins picking up speed" },
  ] },
  { name: "Lock", match: ["/lockers"], items: [
    { href: "/lockers", name: "Lockers", note: "Lock liquidity or team tokens" },
  ] },
  { name: "Scanner", match: ["/analytics", "/pro"], items: [
    { href: "/analytics", name: "Token scanner", note: "Holders, whales, safety" },
    { href: "/analytics/pins", name: "Watchlist", note: "Coins you follow" },
  ] },
];
// Phone bar: Swap sits in the middle as the big button; everything else is behind the ⋯ button.
const BOTTOM: { href: string; name: string; icon: string; match: string[]; main?: boolean }[] = [
  { href: "/", name: "Home", icon: "i-home", match: [] },
  { href: "/launchpad/new", name: "Launch", icon: "i-rocket", match: ["/launchpad", "/momentum"] },
  { href: "/stake", name: "Earn", icon: "i-rew", match: ["/stake", "/rewards"] },
  { href: "/swap", name: "Swap", icon: "i-trend", match: ["/swap", "/wallet", "/perps", "/trade"], main: true },
  { href: "/lockers", name: "Lock", icon: "i-safe", match: ["/lockers"] },
  { href: "/analytics", name: "Scanner", icon: "i-stats", match: ["/analytics", "/pro"] },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The App's frame: a top bar with menus and Connect Wallet (like an exchange), and a bottom bar on phones. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [acct, setAcct] = useState<string | null>(null);
  const [acctMenu, setAcctMenu] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const wallet = useSyncExternalStore(subscribe, getState, getState).current;

  useEffect(() => { setOpen(null); setMore(false); setAcctMenu(false); }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) { setOpen(null); setAcctMenu(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setAcctMenu(false); setMore(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  // Show the connected address (wallet picked anywhere on the site, in this tab).
  useEffect(() => { restoreWallet().catch(() => {}); }, []);
  useEffect(() => {
    const p = wallet?.provider;
    if (!p) { setAcct(null); return; }
    p.request({ method: "eth_accounts" }).then((a: string[]) => setAcct(a?.[0] || null)).catch(() => setAcct(null));
    const on = (a: string[]) => setAcct(a?.[0] || null);
    p.on?.("accountsChanged", on);
    return () => p.removeListener?.("accountsChanged", on);
  }, [wallet]);

  const on = (m: string[]) => m.some((x) => path === x || path.startsWith(x + "/"));

  return (
    <div className="ax">
      <header className="ax-bar" ref={bar}>
        <Link href="/" className="ax-logo" aria-label="AUTISTIK home">
          <svg width="40" height="20" aria-hidden="true"><use href="#i-inf" /></svg><b>AUTISTIK</b><small>APP</small>
        </Link>
        <Link href="/" className="ax-home" aria-label="Home screen"><svg aria-hidden="true"><use href="#i-home" /></svg><span>Home</span></Link>
        <nav className="ax-nav" aria-label="App">
          {MENU.map((m) => (
            <div key={m.name} className="ax-dd" onMouseEnter={() => setOpen(m.name)} onMouseLeave={() => setOpen(null)}>
              <button type="button" className={on(m.match) ? "on" : ""} aria-expanded={open === m.name} onClick={() => setOpen(m.name)}>{m.name}</button>
              {open === m.name && (
                <div className="ax-menu" role="menu">
                  {m.items.map((i) => <Link key={i.href} role="menuitem" href={i.href} aria-current={path === i.href ? "page" : undefined}><b>{i.name}</b>{i.note && <small>{i.note}</small>}</Link>)}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="ax-right">
          <span className="ax-chain" title="Network"><i />BNB Chain</span>
          {!path.startsWith("/companions") && <Link href="/companions" className="ax-connect bot" aria-label="Chat with the AUTISTIK bot"><Art kind="robot" who="autistik" mood="motivation" className="bot-av" /><span className="ax-hide-sm">Ask the bot</span></Link>}
          {acct ? (
            <div className="ax-acct">
              <button type="button" className="ax-connect on" onClick={() => setAcctMenu(!acctMenu)} aria-expanded={acctMenu}>
                {(() => { const w = TOP_WALLETS.find((x) => wallet?.name.toLowerCase().startsWith(x.name.toLowerCase().split(" ")[0])); return w ? <img src={`/wallets/${w.id}.svg`} alt="" /> : wallet?.name === "WalletConnect" ? <img src="/wallets/walletconnect.svg" alt="" /> : <i />; })()}
                {short(acct)}
              </button>
              {acctMenu && (
                <div className="ax-menu right" role="menu">
                  <Link role="menuitem" href="/wallet"><b>My wallet</b><small>{wallet?.name}</small></Link>
                  <button type="button" role="menuitem" onClick={() => { navigator.clipboard?.writeText(acct).catch(() => {}); setAcctMenu(false); }}><b>Copy address</b></button>
                  <button type="button" role="menuitem" onClick={() => { pickWallet({ fresh: true }); setAcctMenu(false); }}><b>Switch wallet</b></button>
                  <button type="button" role="menuitem" onClick={() => { disconnectWallet(); setAcctMenu(false); }}><b>Disconnect</b></button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" className="ax-connect" onClick={() => pickWallet({ fresh: true })}>Connect<span className="ax-hide-sm">Wallet</span></button>
          )}
        </div>
      </header>

      <Tracker />
      <WalletPicker />
      <main className="ax-main">{children}</main>
      <footer className="ax-foot">
        <Link href="/">AUTISTIK website</Link><Link href="/community">Community</Link><Link href="/safety">Safety</Link>
        <span>Crypto is risky. Nothing here is financial advice. Never share your seed phrase.</span>
      </footer>

      <nav className="ax-tabs" aria-label="App">
        {BOTTOM.map((b) => (
          <Link key={b.href} href={b.href} className={b.main ? "main" : undefined} aria-current={on(b.match) ? "page" : undefined}><svg aria-hidden="true"><use href={"#" + b.icon} /></svg><span>{b.name}</span></Link>
        ))}
        <button type="button" className="dots" aria-expanded={more} aria-label="More" onClick={() => setMore(!more)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /></svg><span>More</span></button>
      </nav>
      {more && (
        <div className="ax-sheet" onClick={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="ax-sheet-in" role="menu" aria-label="All of the App">
            {MENU.map((m) => (
              <div key={m.name}><small>{m.name}</small>{m.items.map((i) => <Link key={i.href} role="menuitem" href={i.href} onClick={() => setMore(false)}>{i.name}</Link>)}</div>
            ))}
            <div><small>Website</small><Link href="/" onClick={() => setMore(false)}>Home</Link><Link href="/community" onClick={() => setMore(false)}>Community</Link></div>
          </div>
        </div>
      )}
    </div>
  );
}
