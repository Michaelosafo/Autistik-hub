"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Art from "@/components/Art";

const LINES = ["Want help? I'm Believer 👋", "Need a hand? Ask me anything.", "Stuck? Tap me and I'll help.", "Hi! Believer here. Want help?"];
const HIDE_KEY = "bot-fab-hidden";

/**
 * Believer, the AUTISTIK AI helper, floating at the side of every page. Every few seconds a little "Want help?" bubble
 * pops up. Tapping it opens the AI chat. The × tucks it away for this visit.
 */
export default function BotFab() {
  const path = usePathname() || "/";
  const [hidden, setHidden] = useState(true);
  const [say, setSay] = useState<string | null>(null);
  useEffect(() => { try { setHidden(sessionStorage.getItem(HIDE_KEY) === "1"); } catch { setHidden(false); } }, []);
  useEffect(() => {
    if (hidden) return;
    let i = 0, off: ReturnType<typeof setTimeout> | undefined;
    const show = () => { setSay(LINES[i++ % LINES.length]); off = setTimeout(() => setSay(null), 4500); };
    const first = setTimeout(show, 2500);
    const every = setInterval(show, 12_000);
    return () => { clearTimeout(first); clearInterval(every); if (off) clearTimeout(off); };
  }, [hidden]);
  if (hidden || path.startsWith("/companions") || path.startsWith("/login")) return null;
  return (
    <div className="bot-fab" aria-live="polite">
      {say && (
        <Link href="/companions?c=believer" className="bot-fab-say" onClick={() => setSay(null)}>
          {say}
        </Link>
      )}
      <Link href="/companions?c=believer" className={`bot-fab-btn${say ? " talk" : ""}`} aria-label="Talk to Believer, the AUTISTIK AI helper" onClick={() => setSay(null)}>
        <Art kind="believer" className="bot-av" />
      </Link>
      <button type="button" className="bot-fab-x" aria-label="Hide the helper for now" onClick={() => { setHidden(true); try { sessionStorage.setItem(HIDE_KEY, "1"); } catch {} }}>×</button>
    </div>
  );
}
