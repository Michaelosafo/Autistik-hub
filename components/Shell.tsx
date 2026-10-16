"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Art from "@/components/Art";
import InstallApp from "@/components/InstallApp";
import NotificationBell from "@/components/NotificationBell";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TOKEN_ADDRESS } from "@/lib/groups";

type NavItem = { href: string; name: string; short?: string; icon: string; railOnly?: boolean; match?: string[]; not?: string[] };

// Each menu item is one section. Sections with several pages show tabs at the top (components/SectionTabs).
const NAV: NavItem[] = [
  { href: "/", name: "Home", icon: "i-home" },
  { href: "/launchpad/new", name: "Launch", icon: "i-rocket", match: ["/launchpad/new"] },
  { href: "/launchpad", name: "Trending", icon: "i-trend", match: ["/launchpad", "/trade", "/perps"], not: ["/launchpad/new"] },
  { href: "/analytics", name: "Analytics", short: "Stats", icon: "i-stats" },
  { href: "/community", name: "Community", icon: "i-com", match: ["/community", "/sessions"] },
  { href: "/companions", name: "Companions", short: "Chat", icon: "i-kai" },
  { href: "/buy", name: "$AUTISTIK", short: "Token", icon: "i-buy", match: ["/buy", "/rewards", "/fund"] },
  { href: "/autism", name: "About autism", icon: "i-learn", railOnly: true },
  { href: "/safety", name: "Safety", icon: "i-safe" },
];

function Icon({ id }: { id: string }) {
  return <svg aria-hidden="true"><use href={"#" + id} /></svg>;
}

export default function Shell({ me, children }: { me: { alias: string; color: string; is_admin: boolean } | null; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [calm, setCalm] = useState(false);
  const [big, setBig] = useState(false);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setCalm(localStorage.getItem("calm") === "1"); setBig(localStorage.getItem("big") === "1");
      const t = localStorage.getItem("theme"); if (t === "light" || t === "dark") setTheme(t);
    } catch {}
    // The app helper (public/sw.js): faster opening on phones and an offline page. Only on the live site.
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    const d = document.documentElement;
    if (theme === "auto") delete d.dataset.theme; else d.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.calm = calm ? "on" : "off";
    document.documentElement.dataset.size = big ? "large" : "";
    try { localStorage.setItem("calm", calm ? "1" : "0"); localStorage.setItem("big", big ? "1" : "0"); } catch {}
  }, [calm, big]);

  const nav: NavItem[] = me?.is_admin ? [...NAV, { href: "/admin", name: "Admin", icon: "i-adm" }] : NAV;
  const isOn = (n: NavItem) => {
    if (n.href === "/") return path === "/";
    if (n.not?.some((p) => path.startsWith(p))) return false;
    return (n.match || [n.href]).some((p) => path.startsWith(p));
  };

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }
  // A short message after each display change, so people who can't see tooltips (phones) know what happened.
  const [note, setNote] = useState("");
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();
  function tell(text: string) {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 1600);
  }
  const THEME_NEXT = { auto: "dark", dark: "light", light: "auto" } as const;
  const THEME_LABEL = { auto: "Colours follow your phone", dark: "Dark colours", light: "Light colours" } as const;

  async function copyCA() {
    try { await navigator.clipboard.writeText(TOKEN_ADDRESS); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }

  return (
    <>
      <Sprites />
      <div className="app">
        <aside className="rail">
          <Link href="/" className="brand" style={{ textDecoration: "none" }}>
            <svg width="44" height="22"><use href="#i-inf" /></svg>
            <div><b>AUTISTIK HUB</b><small>Different wavelength. Same channel.</small></div>
          </Link>
          <nav className="nav">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isOn(n) ? "page" : undefined}><Icon id={n.icon} /><span>{n.name}</span></Link>
            ))}
          </nav>
          <div className="rail-pick" aria-label="Talk to a companion">
            <Link href="/companions?c=believer" title="Talk to Believer" data-c="believer"><Art kind="believer" className="" />Believer</Link>
            <Link href="/companions?c=purity" title="Talk to Purity" data-c="purity"><Art kind="purity" className="" />Purity</Link>
          </div>
          <div className="rail-foot">
            <div className="spec" />
            <div className="label" style={{ color: "var(--rail-ink)" }}>$AUTISTIK · BNB Chain</div>
            <button className="btn small" onClick={copyCA} title="Copy contract address">
              <span className="mono">{TOKEN_ADDRESS.slice(0, 6)}…{TOKEN_ADDRESS.slice(-5)}</span> · {copied ? "Copied" : "Copy"}
            </button>
            <span style={{ fontSize: ".88em" }}>Use the official contract only. Nothing here is financial advice.</span>
          </div>
        </aside>

        <main>
          <div className="topbar">
            {me ? (
              <div className="me-pill">
                <Link href="/me" className="me-link" title="Your profile">
                  <span className="me-av" style={{ background: me.color }} aria-hidden="true">{(me.alias.trim()[0] || "M").toUpperCase()}</span>
                  <span className="me-name">{me.alias}</span>
                  {me.is_admin && <span className="me-tag">Admin</span>}
                </Link>
                <button className="me-out" type="button" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon id="i-out" /></button>
              </div>
            ) : (
              <Link className="signin-btn" href={`/login?next=${encodeURIComponent(path)}`}>Sign in <span aria-hidden="true">→</span></Link>
            )}
            <div className="chips">
              <InstallApp />
              {me && <div className="tools"><NotificationBell /></div>}
              <div className="tools" role="group" aria-label="Display">
                <button className="tool" type="button" aria-pressed={calm} aria-label="Calm mode" title="Calm mode: no movement, softer colours, no adverts"
                  onClick={() => { setCalm(!calm); tell(calm ? "Calm mode off" : "Calm mode on"); }}><Icon id="i-calm" /></button>
                <button className="tool" type="button" aria-pressed={big} aria-label="Larger text" title="Larger text"
                  onClick={() => { setBig(!big); tell(big ? "Normal text" : "Larger text"); }}><Icon id="i-text" /></button>
                <button className="tool" type="button" aria-label={`${THEME_LABEL[theme]}. Tap to change.`} title={`${THEME_LABEL[theme]} (tap to change)`}
                  onClick={() => { const t = THEME_NEXT[theme]; setTheme(t); tell(THEME_LABEL[t]); }}><Icon id={theme === "auto" ? "i-auto" : theme === "dark" ? "i-moon" : "i-sun"} /></button>
              </div>
            </div>
            <div className="tool-note" role="status" aria-live="polite" data-show={note ? "1" : undefined}>{note}</div>
          </div>
          <div className="page">{children}</div>
        </main>
      </div>
      <nav className="tabbar">
        {nav.filter((n) => !n.railOnly && !(me?.is_admin && n.href === "/safety")).map((n) => (
          <Link key={n.href} href={n.href} aria-current={isOn(n) ? "page" : undefined}><Icon id={n.icon} /><span>{n.short || n.name}</span></Link>
        ))}
      </nav>
    </>
  );
}

function Sprites() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: `
  <defs><linearGradient id="spec" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#E8453C"/><stop offset=".2" stop-color="#F39A2B"/><stop offset=".4" stop-color="#F5C935"/><stop offset=".6" stop-color="#3DB66A"/><stop offset=".8" stop-color="#2F8FE0"/><stop offset="1" stop-color="#7B55E0"/></linearGradient></defs>
  <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></symbol>
  <symbol id="i-kai" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M9 10h.01M15 10h.01"/></symbol>
  <symbol id="i-com" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5.5"/></symbol>
  <symbol id="i-ses" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></symbol>
  <symbol id="i-rew" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-4.5 0-7 2-7 4s2.5 4 7 4 7-2 7-4-2.5-4-7-4z"/><path d="M5 7v5c0 2 2.5 4 7 4s7-2 7-4V7M5 12v5c0 2 2.5 4 7 4s7-2 7-4v-5"/></symbol>
  <symbol id="i-rocket" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15l-3-3c1-4 4-8 10-9-1 6-5 9-9 10z"/><path d="M9 12H5l2-4h4M12 15v4l4-2v-4"/><path d="M6 16c-1.5 1-2 3-2 4 1 0 3-.5 4-2"/></symbol>
  <symbol id="i-buy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/></symbol>
  <symbol id="i-fund" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/><path d="M3 21h18"/></symbol>
  <symbol id="i-learn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M9 7h6M9 11h5"/></symbol>
  <symbol id="i-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></symbol>
  <symbol id="i-safe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></symbol>
  <symbol id="i-stats" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><circle cx="16" cy="9" r="1.6"/></symbol>
  <symbol id="i-calm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19c0-8.5 5.5-14 15-15-.8 9.8-6.5 15-15 15z"/><path d="M5 19l8-8"/></symbol>
  <symbol id="i-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 19l5.5-14L13 19M4 14h7"/><path d="M15 19l3.5-9 3.5 9M16.2 16h4.6"/></symbol>
  <symbol id="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></symbol>
  <symbol id="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z"/></symbol>
  <symbol id="i-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></symbol>
  <symbol id="i-out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3"/><path d="M16 17l5-5-5-5M21 12H9"/></symbol>
  <symbol id="i-adm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></symbol>
  <symbol id="g-lounge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M4 11h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/></symbol>
  <symbol id="g-calm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-5-3-8-6.5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 3.5C20 14.5 17 18 12 21z"/></symbol>
  <symbol id="g-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></symbol>
  <symbol id="g-learn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></symbol>
  <symbol id="i-inf" viewBox="0 0 48 24"><path d="M12 4C6.5 4 3 7.8 3 12s3.5 8 9 8c4.6 0 7.7-3.6 12-8 4.3-4.4 7.4-8 12-8 5.5 0 9 3.8 9 8s-3.5 8-9 8c-4.6 0-7.7-3.6-12-8C19.7 7.6 16.6 4 12 4z" fill="none" stroke="url(#spec)" stroke-width="3.4" stroke-linecap="round"/></symbol>` }} />
  );
}
