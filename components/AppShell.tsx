"use client";
import Link from "next/link";
import Art from "@/components/Art";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Tracker from "@/components/Tracker";
import WalletPicker from "@/components/connect/WalletPicker";
import Toaster from "@/components/Toaster";
import Avatar from "@/components/Avatar";
import LogoMark from "@/components/LogoMark";
import NetIcon from "@/components/connect/NetIcon";
import { NETWORKS, TOP_NETWORKS, TOP_WALLETS, disconnectSol, disconnectWallet, getState, netOf, pickWallet, restoreSol, restoreWallet, setNetwork, subscribe } from "@/lib/connect";

/** Pages that open inside the App (the trading interface). Everything else is the website. */
export const APP_PATHS = ["/app", "/board", "/swap", "/wallet", "/stake", "/rewards", "/lockers", "/liquidity", "/analytics", "/momentum", "/launchpad", "/trade", "/perps", "/pro", "/arena"];
export const isAppPath = (p: string) => APP_PATHS.some((a) => p === a || p.startsWith(a + "/"));

type Item = { href: string; name: string; note?: string; icon?: string };
const MENU: { name: string; icon: string; tip: string; match: string[]; items: Item[] }[] = [
  // The Board first: every coin launched here, and everything to make one (create, liquidity, trending).
  { name: "Board", icon: "i-fire", tip: "Coins launched on AUTISTIK, live", match: ["/board", "/launchpad", "/momentum", "/liquidity"], items: [
    { href: "/board", name: "Board", note: "Every coin launched here, live", icon: "i-fire" },
    { href: "/launchpad/new", name: "Create a coin", note: "Pick a network, fill 5 steps, sign once", icon: "i-rocket" },
    { href: "/liquidity", name: "Add liquidity", note: "Paste your token address: add to its pool or create one", icon: "i-swap" },
    { href: "/launchpad", name: "Trending", note: "What people are buying", icon: "i-trend" },
    { href: "/momentum", name: "Momentum", note: "New coins picking up speed", icon: "i-bolt" },
  ] },
  { name: "Trade", icon: "i-swap", tip: "Swap any token", match: ["/swap", "/perps", "/trade"], items: [
    { href: "/swap", name: "Swap", note: "Trade any token at the best price, on any network", icon: "i-swap" },
    { href: "/perps", name: "Perpetuals", note: "Long or short with leverage", icon: "i-trend" },
  ] },
  // Wallet is its own menu: the wallet itself, then the game arena and the token scanner that trade from it.
  { name: "Wallet", icon: "i-wallet", tip: "Your coins", match: ["/wallet", "/arena", "/analytics", "/pro"], items: [
    { href: "/wallet", name: "My wallet", note: "Balances, send, receive and trade", icon: "i-wallet" },
    { href: "/analytics", name: "Token scanner", note: "Holders, whales, safety", icon: "i-search" },
    { href: "/analytics/pins", name: "Watchlist", note: "Coins you follow", icon: "i-star" },
    { href: "/arena", name: "Game arena", note: "Every holder on a pitch: join the match", icon: "i-ball" },
  ] },
  { name: "Earn", icon: "i-rew", tip: "Stake and rewards", match: ["/stake", "/rewards"], items: [
    { href: "/stake", name: "Stake", note: "Earn BNB from platform fees, up to 3x", icon: "i-rew" },
    { href: "/rewards", name: "Rewards", note: "Points and $AUTISTIK airdrops", icon: "i-gift" },
  ] },
  { name: "Lock", icon: "i-lock", tip: "Lock liquidity or tokens", match: ["/lockers"], items: [
    { href: "/lockers", name: "Lockers", note: "Lock liquidity or team tokens", icon: "i-lock" },
  ] },
];
// The full menu (phone ☰ button, desktop Menu button): every App tool above, then the website and your account.
const MORE: { name: string; items: Item[] }[] = [
  ...MENU.map((m) => ({ name: m.name, items: m.items })),
  { name: "Website", items: [
    { href: "/", name: "Home", note: "The AUTISTIK main page", icon: "i-home" },
    { href: "/app", name: "All tools", note: "Every App tool on one page", icon: "i-grid" },
    { href: "/companions", name: "Ask the bot", note: "Chat with Believer, Purity and the AUTISTIK bot", icon: "i-kai" },
    { href: "/live", name: "Live hub", note: "Join the team's live sessions, get airdrops", icon: "i-ses" },
    { href: "/community", name: "Community", note: "Groups, posts and live sessions", icon: "i-com" },
    { href: "/buy", name: "$AUTISTIK", note: "How to buy the token", icon: "i-buy" },
    { href: "/autism", name: "About autism", note: "Guides and support", icon: "i-learn" },
    { href: "/safety", name: "Safety", note: "Stay safe in crypto", icon: "i-safe" },
  ] },
  { name: "Account", items: [
    { href: "/me", name: "My profile", note: "Your meme name, followers and activity", icon: "i-user" },
    { href: "/members", name: "Members", note: "Follow people and see what they're up to", icon: "i-com" },
    { href: "/security", name: "Account security", note: "Your authenticator app", icon: "i-key" },
  ] },
];
// Phone bar: Swap sits in the middle as the big button; everything else is behind the ☰ Menu button.
const BOTTOM: { href: string; name: string; icon: string; match: string[]; main?: boolean }[] = [
  { href: "/", name: "Home", icon: "i-home", match: [] },
  { href: "/board", name: "Board", icon: "i-rocket", match: ["/board", "/launchpad", "/momentum", "/liquidity"] },
  { href: "/stake", name: "Earn", icon: "i-rew", match: ["/stake", "/rewards"] },
  { href: "/swap", name: "Swap", icon: "i-trend", match: ["/swap", "/perps", "/trade"], main: true },
  { href: "/lockers", name: "Lock", icon: "i-safe", match: ["/lockers"] },
  { href: "/wallet", name: "Wallet", icon: "i-wallet", match: ["/wallet", "/arena", "/analytics", "/pro"] },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The App's frame: a top bar with menus and Connect Wallet (like an exchange), and a bottom bar on phones. */
export default function AppShell({ admin, me, onMe, children }: {
  admin?: boolean;
  /** The signed-in member: their picture opens their panel (wallet, updates, scanner, settings). */
  me?: { alias: string; color: string; avatar_url: string | null; unread?: number } | null;
  onMe?: () => void;
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [acct, setAcct] = useState<string | null>(null);
  const [acctMenu, setAcctMenu] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const cs = useSyncExternalStore(subscribe, getState, getState);
  const wallet = cs.current;
  const net = netOf(cs.network);
  const solMode = cs.network === "solana";
  const [netMenu, setNetMenu] = useState(false);
  const [netQ, setNetQ] = useState("");

  useEffect(() => { setOpen(null); setMore(false); setAcctMenu(false); setNetMenu(false); }, [path]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) { setOpen(null); setAcctMenu(false); setNetMenu(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(null); setAcctMenu(false); setMore(false); setNetMenu(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  // Show the connected address (wallet picked anywhere on the site, in this tab).
  useEffect(() => { restoreWallet().catch(() => {}); restoreSol().catch(() => {}); }, []);
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
        {me ? (
          <button type="button" className="ax-me" onClick={onMe} aria-haspopup="dialog" aria-label={`Your panel: ${me.alias}${me.unread ? `, ${me.unread} new alerts` : ""}`}>
            <Avatar className="me-av" alias={me.alias} color={me.color} url={me.avatar_url} logo />
            {!me.avatar_url && <span className="me-pic-add" aria-hidden="true">+</span>}
            {!!me.unread && <span className="bell-n">{me.unread > 9 ? "9+" : me.unread}</span>}
          </button>
        ) : null}
        <Link href="/app" className="ax-logo" aria-label="AUTISTIK App: all tools"><LogoMark size={38} /></Link>
        {/* Home switches sides: from the App it goes to the website's main page, whose Home button comes back here. */}
        <Link href="/" className="ax-home" aria-label="Home: the AUTISTIK main page"><svg aria-hidden="true"><use href="#i-home" /></svg><span>Home</span></Link>
        <nav className="ax-nav" aria-label="App">
          {MENU.map((m) => (
            <div key={m.name} className="ax-dd" onMouseEnter={() => setOpen(m.name)} onMouseLeave={() => setOpen(null)} onFocus={() => setOpen(m.name)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(null); }}>
              {/* The name opens its main page in one tap; hovering (or tabbing) shows everything inside. */}
              <Link href={m.items[0].href} className={"ax-top" + (on(m.match) ? " on" : "")} aria-haspopup="menu" aria-expanded={open === m.name} title={m.tip}>
                <svg aria-hidden="true"><use href={"#" + m.icon} /></svg>{m.name}
              </Link>
              {open === m.name && (
                <div className="ax-menu" role="menu">
                  <small className="ax-menu-tip">{m.tip}</small>
                  {m.items.map((i) => (
                    <Link key={i.href} role="menuitem" href={i.href} className="ax-mi" aria-current={path === i.href ? "page" : undefined}>
                      <i className="ax-ic"><svg aria-hidden="true"><use href={"#" + (i.icon || "i-grid")} /></svg></i>
                      <span><b>{i.name}</b>{i.note && <small>{i.note}</small>}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="ax-right">
          <Link href="/launchpad/new" className="ax-create" title="Create a coin on any network">＋ Create</Link>
          <button type="button" className="ax-burger" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}><Burger open={more} /><span>Menu</span></button>
          {/* Only the owner's account gets this; the admin page itself checks again on the server. */}
          {admin && <Link href="/admin" className="ax-admin" aria-label="Admin: everything happening on the site"><svg aria-hidden="true"><use href="#i-adm" /></svg><span>Admin</span></Link>}
          <div className="ax-net">
            <button type="button" aria-haspopup="menu" aria-expanded={netMenu} aria-label={`Network: ${net.name}. Change network`} onClick={() => { setNetMenu(!netMenu); setAcctMenu(false); }}>
              <NetIcon n={net} size={18} /><span className="ax-net-name">{net.name}</span><span className="ax-net-short">{net.short}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {netMenu && (
              <div className="ax-menu right" role="menu" aria-label="Choose a network">
                <input className="ax-net-q" value={netQ} onChange={(e) => setNetQ(e.target.value)} placeholder={`Search ${NETWORKS.length} networks`} aria-label="Search networks" autoComplete="off" spellCheck={false} />
                {[...NETWORKS].sort((a, b) => (TOP_NETWORKS.indexOf(a.key) + 1 || 99) - (TOP_NETWORKS.indexOf(b.key) + 1 || 99))
                  .filter((n) => !netQ || n.name.toLowerCase().includes(netQ.toLowerCase())).map((n) => (
                  <button key={n.key} type="button" role="menuitemradio" aria-checked={n.key === cs.network}
                    onClick={() => { setNetMenu(false); setNetwork(n.key).then(() => { if (n.key === "solana" ? !getState().sol : !getState().current) pickWallet({ fresh: true }); }); }}>
                    <b className="ax-net-row"><NetIcon n={n} size={20} />{n.name}{n.key === cs.network ? " ✓" : ""}</b>
                    {n.key === "solana" && <small>Phantom, Solflare, Backpack…</small>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {!path.startsWith("/companions") && <Link href="/companions" className="ax-connect bot" aria-label="Chat with the AUTISTIK bot"><Art kind="robot" who="autistik" mood="motivation" className="bot-av" /><span className="ax-hide-sm">Ask the bot</span></Link>}
          {solMode && cs.sol ? (
            <div className="ax-acct">
              <button type="button" className="ax-connect on" onClick={() => setAcctMenu(!acctMenu)} aria-expanded={acctMenu}>
                {cs.sol.wallet.icon ? <img src={cs.sol.wallet.icon} alt="" /> : <i />}
                {cs.sol.account.address.slice(0, 4)}…{cs.sol.account.address.slice(-4)}
              </button>
              {acctMenu && (
                <div className="ax-menu right" role="menu">
                  <Link role="menuitem" href="/wallet"><b>My wallet</b><small>{cs.sol.name} · Solana</small></Link>
                  <button type="button" role="menuitem" onClick={() => { navigator.clipboard?.writeText(cs.sol!.account.address).catch(() => {}); setAcctMenu(false); }}><b>Copy address</b></button>
                  <button type="button" role="menuitem" onClick={() => { pickWallet({ fresh: true }); setAcctMenu(false); }}><b>Switch wallet</b></button>
                  <button type="button" role="menuitem" onClick={() => { disconnectSol(); setAcctMenu(false); }}><b>Disconnect</b></button>
                </div>
              )}
            </div>
          ) : solMode ? (
            <button type="button" className="ax-connect" onClick={() => pickWallet({ fresh: true })}>Connect<span className="ax-hide-sm">Wallet</span></button>
          ) : acct ? (
            <div className="ax-acct">
              <button type="button" className="ax-connect on" onClick={() => setAcctMenu(!acctMenu)} aria-expanded={acctMenu}>
                {(() => { const w = TOP_WALLETS.find((x) => wallet?.name.toLowerCase().startsWith(x.name.toLowerCase().split(" ")[0])); return w ? <img src={`/wallets/${w.id}.svg`} alt="" /> : wallet?.name === "WalletConnect" ? <img src="/wallets/walletconnect.svg" alt="" /> : <i />; })()}
                {short(acct)}
              </button>
              {acctMenu && (
                <div className="ax-menu right" role="menu">
                  <Link role="menuitem" href="/wallet"><b>My wallet</b><small>{wallet?.name}</small></Link>
                  <div className="ax-switch" role="group" aria-label="Switch network">
                    <small>Switch network</small>
                    <div className="ax-switch-grid">
                      {TOP_NETWORKS.filter((k) => k !== "solana").map((k) => NETWORKS.find((n) => n.key === k)!).filter(Boolean).map((n) => (
                        <button key={n.key} type="button" role="menuitemradio" aria-checked={n.key === cs.network} className={n.key === cs.network ? "on" : ""}
                          onClick={() => { setNetwork(n.key); setAcctMenu(false); }} title={n.name}>
                          <NetIcon n={n} size={22} /><span>{n.short}</span>
                        </button>
                      ))}
                      <button type="button" className="more" onClick={() => { setAcctMenu(false); setNetMenu(true); }}><span>All {NETWORKS.length}</span></button>
                    </div>
                  </div>
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
      <Toaster />
      <main className="ax-main">{children}</main>
      <footer className="ax-foot">
        <Link href="/app">All tools</Link><Link href="/">AUTISTIK website</Link><Link href="/community">Community</Link><Link href="/safety">Safety</Link><Link href="/privacy">Privacy</Link>
        <span>Crypto is risky. Nothing here is financial advice. Never share your seed phrase.</span>
      </footer>

      <nav className="ax-tabs" aria-label="App">
        {BOTTOM.map((b) => (
          <Link key={b.href} href={b.href} className={b.main ? "main" : undefined} aria-current={on(b.match) ? "page" : undefined}><svg aria-hidden="true"><use href={"#" + b.icon} /></svg><span>{b.name}</span></Link>
        ))}
        <button type="button" className="dots" aria-expanded={more} aria-haspopup="menu" onClick={() => setMore(!more)}><Burger open={more} /><span>Menu</span></button>
      </nav>
      {more && (
        <div className="ax-sheet" onClick={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="ax-sheet-in" role="menu" aria-label="Menu: everything on AUTISTIK">
            <div className="ax-sheet-h"><b>Menu</b><button type="button" aria-label="Close menu" onClick={() => setMore(false)}><Burger open /></button></div>
            {admin && <MoreGroup name="Owner" items={[{ href: "/admin", name: "Admin", note: "Everything happening on the site", icon: "i-adm" }]} path={path} close={() => setMore(false)} />}
            {MORE.map((g) => <MoreGroup key={g.name} name={g.name} items={g.items} path={path} close={() => setMore(false)} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Three lines (☰) that turn into an ✕ while the menu is open. */
function Burger({ open }: { open?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
    </svg>
  );
}

function MoreGroup({ name, items, path, close }: { name: string; items: Item[]; path: string; close: () => void }) {
  return (
    <section>
      <small>{name}</small>
      {items.map((i) => (
        <Link key={i.href} role="menuitem" href={i.href} onClick={close} aria-current={path === i.href ? "page" : undefined}>
          <i className="ax-ic"><svg aria-hidden="true"><use href={"#" + (i.icon || "i-grid")} /></svg></i>
          <span><b>{i.name}</b>{i.note && <em>{i.note}</em>}</span>
          <svg className="ax-go" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </Link>
      ))}
    </section>
  );
}
