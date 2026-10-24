"use client";
/**
 * The three-column layout ("New" in Display → Layout): the menu on the left with the website (Hub) and the App's tools
 * in one place, the page in the middle, and a side column on the right (search, trending tokens, live sessions,
 * AUTISTIK news). The classic layouts (components/Shell.tsx for the website, components/AppShell.tsx for the App) are
 * kept as they are, and people can switch back any time. Phones always use the classic layouts.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import Art from "@/components/Art";
import { LINKS } from "@/lib/site";
import { getState, pickWallet, restoreWallet, subscribe } from "@/lib/connect";

type Item = { href: string; name: string; icon: string; match?: string[]; members?: boolean };
// One list like X's: the pages people use most. Everything else is behind More.
const MAIN: Item[] = [
  { href: "/", name: "Home", icon: "i-home" },
  { href: "/launchpad", name: "Trending", icon: "i-fire", match: ["/launchpad", "/momentum"] },
  { href: "/companions", name: "Chat", icon: "i-kai" },
  { href: "/community", name: "Community", icon: "i-com", match: ["/community", "/sessions"] },
  { href: "/live", name: "Live", icon: "i-ses" },
  { href: "/swap", name: "Swap", icon: "i-swap", match: ["/swap", "/perps", "/trade"] },
  { href: "/wallet", name: "Wallet", icon: "i-wallet", match: ["/wallet", "/arena"] },
  { href: "/stake", name: "Earn", icon: "i-rew", match: ["/stake", "/rewards"] },
  { href: "/lockers", name: "Lock", icon: "i-lock" },
  { href: "/members", name: "Members", icon: "i-user", members: true },
];
const MORE: Item[] = [
  { href: "/app", name: "All App tools", icon: "i-grid" },
  { href: "/analytics", name: "Token scanner", icon: "i-search", match: ["/analytics", "/pro"] },
  { href: "/buy", name: "$AUTISTIK", icon: "i-buy", match: ["/buy", "/fund"] },
  { href: "/about", name: "What is AUTISTIK?", icon: "i-inf" },
  { href: "/autism", name: "About autism", icon: "i-learn" },
  { href: "/safety", name: "Safety", icon: "i-safe" },
];

const Icon = ({ id }: { id: string }) => <svg aria-hidden="true"><use href={"#" + id} /></svg>;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function isOn(path: string, i: Item) {
  if (i.href === "/") return path === "/";
  return (i.match || [i.href]).some((p) => path === p || path.startsWith(p + "/"));
}

export default function RailShell({ me, path, app, menuRef, menuOpen, onMenu, menuPop, children }: {
  me: { alias: string; color: string; is_admin: boolean } | null;
  path: string;
  /** An App page (swap, launch, lock…): the right column starts with Connect wallet. */
  app: boolean;
  menuRef: RefObject<HTMLDivElement>;
  menuOpen: boolean;
  onMenu: () => void;
  /** The account and display menu, shared with the classic layout (Shell.tsx). */
  menuPop: ReactNode;
  children: ReactNode;
}) {
  const section = [...MAIN, ...MORE].find((i) => isOn(path, i));
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setMore(false); }, [path]);
  useEffect(() => {
    if (!more) return;
    const close = (e: MouseEvent) => { if (!moreRef.current?.contains(e.target as Node)) setMore(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMore(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [more]);
  const moreItems = me?.is_admin ? [...MORE, { href: "/admin", name: "Admin", icon: "i-adm" }] : MORE;
  const link = (i: Item) => (
    <Link key={i.href} href={i.href} className="nx-link" aria-current={isOn(path, i) ? "page" : undefined}>
      <Icon id={i.icon} /><span>{i.name}</span>
    </Link>
  );
  return (
    <div className="nx">
      <aside className="nx-rail" aria-label="Menu">
        <Link href="/" className="nx-brand" aria-label="AUTISTIK Hub: home">
          <svg width="44" height="22" aria-hidden="true"><use href="#i-inf" /></svg>
          <b>AUTISTIK</b>
        </Link>
        <nav className="nx-nav">
          {MAIN.filter((i) => !i.members || me).map(link)}
          <div className="nx-more" ref={moreRef}>
            <button type="button" className="nx-link" aria-expanded={more} aria-haspopup="menu" aria-current={moreItems.some((i) => isOn(path, i)) ? "page" : undefined} onClick={() => setMore(!more)}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="3" /></svg><span>More</span>
            </button>
            {more && (
              <div className="nx-more-pop" role="menu">
                {moreItems.map((i) => (
                  <Link key={i.href} role="menuitem" href={i.href} aria-current={isOn(path, i) ? "page" : undefined}><Icon id={i.icon} /><span>{i.name}</span></Link>
                ))}
              </div>
            )}
          </div>
        </nav>
        <Link href="/launchpad/new" className="nx-cta"><Icon id="i-rocket" /><span>Launch a token</span></Link>
        <div className="nx-acct me-menu" ref={menuRef}>
          <button type="button" className="nx-me" aria-expanded={menuOpen} aria-haspopup="dialog" onClick={onMenu}>
            {me
              ? <span className="me-av" style={{ background: me.color }} aria-hidden="true">{(me.alias.trim()[0] || "M").toUpperCase()}</span>
              : <span className="me-av guest" aria-hidden="true"><Icon id="i-auto" /></span>}
            <span className="nx-me-t"><b>{me ? me.alias : "Guest"}</b><small>{me ? (me.is_admin ? "Admin · menu" : "Your menu") : "Display · sign in"}</small></span>
            <span className="nx-dots" aria-hidden="true">•••</span>
          </button>
          {menuPop}
        </div>
      </aside>

      <main className="nx-main">
        {path !== "/" && <header className="nx-top">
          <b>{section?.name ?? "AUTISTIK Hub"}</b>
          <div className="nx-top-r">
            {!path.startsWith("/companions") && <Link className="bot-btn" href="/companions" aria-label="Chat with the AUTISTIK bot"><Art kind="robot" who="autistik" mood="motivation" className="bot-av" /><span>Ask the bot</span></Link>}
            {!me && <Link className="signin-btn small" href={`/login?next=${encodeURIComponent(path)}`}>Sign in <span aria-hidden="true">→</span></Link>}
          </div>
        </header>}
        <div className={path === "/" ? "nx-page home" : "nx-page"}>{children}</div>
        <footer className="site-note">⚠️ Nothing on AUTISTIK Hub is financial advice. Crypto is risky: do your own research and never put in more than you can afford to lose.</footer>
      </main>

      <SideColumn app={app} signedIn={!!me} />
    </div>
  );
}

type Side = {
  trending: { chain: string; chainName: string; token: string; name: string; symbol: string; priceUsd: number | null; change24h: number | null; imageUrl: string | null; promoted: boolean }[];
  live: { id: string; title: string; host: string | null; starts_at: string; now: boolean }[];
  news: { id: string; body: string; channel: string; created_at: string }[] | null;
};

const price = (n: number | null) => n == null ? "–" : n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : `$${n.toPrecision(3)}`;
const when = (iso: string) => {
  const d = new Date(iso), mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

function SideColumn({ app, signedIn }: { app: boolean; signedIn: boolean }) {
  const [side, setSide] = useState<Side | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/side").then((r) => r.json()).then((d) => alive && setSide(d)).catch(() => {});
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [signedIn]);

  return (
    <aside className="nx-side" aria-label="Trending, live and news">
      <SearchBox />
      {app && <WalletCard />}
      <section className="nx-card">
        <div className="nx-card-h"><b>🔥 Trending tokens</b><Link href="/launchpad">See all</Link></div>
        {!side ? <p className="muted nx-empty">Loading…</p> : side.trending.length === 0 ? <p className="muted nx-empty">No tokens yet. <Link href="/launchpad/new">Launch the first one</Link>.</p> : (
          <ol className="nx-tokens">
            {side.trending.map((t, i) => (
              <li key={t.chain + t.token}>
                <Link href={`/launchpad/${t.chain}/${t.token}`}>
                  <span className="nx-rank">{i + 1}</span>
                  {t.imageUrl ? <img src={t.imageUrl} alt="" width={28} height={28} /> : <span className="nx-tok-ph" aria-hidden="true">{t.symbol.slice(0, 1)}</span>}
                  <span className="nx-tok"><b>${t.symbol}</b><small>{t.chainName}{t.promoted ? " · Promoted" : ""}</small></span>
                  <span className="nx-px"><b>{price(t.priceUsd)}</b>{t.change24h != null && <small className={t.change24h >= 0 ? "up" : "down"}>{t.change24h >= 0 ? "+" : ""}{t.change24h.toFixed(1)}%</small>}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="nx-card">
        <div className="nx-card-h"><b>📡 Live</b><Link href="/live">Schedule</Link></div>
        {!side ? <p className="muted nx-empty">Loading…</p> : side.live.length === 0 ? <p className="muted nx-empty">Nothing live right now. Sessions show here when they start.</p> : (
          <ul className="nx-list">
            {side.live.map((s) => (
              <li key={s.id}><Link href="/live">
                <span className={"nx-dot" + (s.now ? " on" : "")} aria-hidden="true" />
                <span><b>{s.title}</b><small>{s.now ? "Live now" : new Date(s.starts_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}{s.host ? ` · ${s.host}` : ""}</small></span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
      <section className="nx-card">
        <div className="nx-card-h"><b>📰 AUTISTIK news</b><Link href="/community">Community</Link></div>
        {!side ? <p className="muted nx-empty">Loading…</p> : side.news === null ? <p className="muted nx-empty"><Link href="/login?next=/community">Sign in</Link> to see the team&apos;s latest posts.</p> : side.news.length === 0 ? <p className="muted nx-empty">No news posts yet.</p> : (
          <ul className="nx-list">
            {side.news.map((n) => (
              <li key={n.id}><Link href={`/community?c=${encodeURIComponent(n.channel)}`}>
                <span><b className="nx-clamp">{n.body}</b><small>{when(n.created_at)}</small></span>
              </Link></li>
            ))}
          </ul>
        )}
      </section>
      <nav className="nx-foot" aria-label="More">
        <Link href="/autism">About autism</Link><Link href="/safety">Safety</Link><Link href="/privacy">Privacy</Link><a href={`mailto:${LINKS.email}`}>Contact</a>
      </nav>
    </aside>
  );
}

/** One box for tokens and members: an address opens the token scanner, anything else searches members. */
function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  function go(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) router.push(`/analytics/bsc/${v}`);
    else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) router.push(`/analytics/solana/${v}`);
    else router.push(`/members?tab=find&q=${encodeURIComponent(v.replace(/^@/, ""))}`);
    setQ("");
  }
  return (
    <form className="nx-search" role="search" onSubmit={go}>
      <Icon id="i-search" />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Token address or @member" aria-label="Search a token address or a member" />
    </form>
  );
}

/** App pages: Connect wallet sits at the top of the side column (the App's top bar isn't shown in this layout). */
function WalletCard() {
  const wallet = useSyncExternalStore(subscribe, getState, getState).current;
  const [acct, setAcct] = useState<string | null>(null);
  useEffect(() => { restoreWallet().catch(() => {}); }, []);
  useEffect(() => {
    const p = wallet?.provider;
    if (!p) { setAcct(null); return; }
    p.request({ method: "eth_accounts" }).then((a: string[]) => setAcct(a?.[0] || null)).catch(() => setAcct(null));
    const on = (a: string[]) => setAcct(a?.[0] || null);
    p.on?.("accountsChanged", on);
    return () => p.removeListener?.("accountsChanged", on);
  }, [wallet]);
  return (
    <div className="nx-card nx-wallet">
      {acct
        ? <><span className="nx-dot on" aria-hidden="true" /><span><b className="mono">{short(acct)}</b><small>{wallet?.name}</small></span><Link className="btn small" href="/wallet">Wallet</Link></>
        : <button type="button" className="btn primary" onClick={() => pickWallet({ fresh: true })}>Connect wallet</button>}
    </div>
  );
}
