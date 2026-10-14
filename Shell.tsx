"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Art from "@/components/Art";
import { supabaseBrowser } from "@/lib/supabase/client";
import { TOKEN_ADDRESS } from "@/lib/groups";

const NAV = [
  { href: "/", name: "Home", icon: "i-home" },
  { href: "/companions", name: "Companions", short: "Chat", icon: "i-kai" },
  { href: "/community", name: "Community", icon: "i-com" },
  { href: "/sessions", name: "Sessions", icon: "i-ses" },
  { href: "/rewards", name: "Rewards", icon: "i-rew" },
  { href: "/safety", name: "Safety", icon: "i-safe" },
];

function Icon({ id }: { id: string }) {
  return <svg aria-hidden="true"><use href={"#" + id} /></svg>;
}

export default function Shell({ me, children }: { me: { alias: string; is_admin: boolean } | null; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [calm, setCalm] = useState(false);
  const [big, setBig] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try { setCalm(localStorage.getItem("calm") === "1"); setBig(localStorage.getItem("big") === "1"); } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.calm = calm ? "on" : "off";
    document.documentElement.dataset.size = big ? "large" : "";
    try { localStorage.setItem("calm", calm ? "1" : "0"); localStorage.setItem("big", big ? "1" : "0"); } catch {}
  }, [calm, big]);

  const nav = me?.is_admin ? [...NAV, { href: "/admin", name: "Admin", icon: "i-adm" }] : NAV;
  const isOn = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/");
    router.refresh();
  }
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
              <Link key={n.href} href={n.href} aria-current={isOn(n.href) ? "page" : undefined}><Icon id={n.icon} /><span>{n.name}</span></Link>
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
            <div className="chips">
              {me ? (
                <>
                  <span className="chip live">{me.alias}{me.is_admin ? " · Admin" : ""}</span>
                  <button className="chip toggle" onClick={signOut}>Sign out</button>
                </>
              ) : (
                <Link className="chip toggle" href="/login" style={{ textDecoration: "none", color: "var(--ink)" }}>Sign in / Join</Link>
              )}
            </div>
            <div className="chips">
              <button className="chip toggle" aria-pressed={calm} onClick={() => setCalm(!calm)}>Calm mode</button>
              <button className="chip toggle" aria-pressed={big} onClick={() => setBig(!big)}>Larger text</button>
            </div>
          </div>
          <div className="page">{children}</div>
        </main>
      </div>
      <nav className="tabbar">
        {nav.filter((n) => !(me?.is_admin && n.href === "/safety")).map((n) => (
          <Link key={n.href} href={n.href} aria-current={isOn(n.href) ? "page" : undefined}><Icon id={n.icon} /><span>{n.short || n.name}</span></Link>
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
  <symbol id="i-safe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></symbol>
  <symbol id="i-adm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></symbol>
  <symbol id="g-lounge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><path d="M4 11h16v4a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/></symbol>
  <symbol id="g-calm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-5-3-8-6.5-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 3.5C20 14.5 17 18 12 21z"/></symbol>
  <symbol id="g-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/></symbol>
  <symbol id="g-learn" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/></symbol>
  <symbol id="i-inf" viewBox="0 0 48 24"><path d="M12 4C6.5 4 3 7.8 3 12s3.5 8 9 8c4.6 0 7.7-3.6 12-8 4.3-4.4 7.4-8 12-8 5.5 0 9 3.8 9 8s-3.5 8-9 8c-4.6 0-7.7-3.6-12-8C19.7 7.6 16.6 4 12 4z" fill="none" stroke="url(#spec)" stroke-width="3.4" stroke-linecap="round"/></symbol>` }} />
  );
}
