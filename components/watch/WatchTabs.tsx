import Link from "next/link";

/** TIK's top tabs: the Tik board, live audio rooms, live video streams, uploaded videos and short fun clips. */
export const WATCH_TABS = [
  { key: "", label: "Tik", icon: '<path d="M4 5h16v11H8l-4 4z"/>' },
  { key: "live", label: "Live", icon: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>' },
  { key: "streams", label: "Livestreams", icon: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10l5-3v10l-5-3"/>' },
  { key: "videos", label: "Videos", icon: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9l5 3-5 3z"/>' },
  { key: "fun", label: "Fun", icon: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>' },
] as const;
export type WatchTab = (typeof WATCH_TABS)[number]["key"];

export default function WatchTabs({ tab }: { tab: string }) {
  return (
    <nav className="wv-tabs clean" aria-label="TIK sections">
      {WATCH_TABS.map((t) => (
        <Link key={t.key} href={t.key ? `/mood?tab=${t.key}` : "/mood"} className={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} scroll={false}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: t.icon }} />
          <span>{t.label}</span>{t.key === "streams" && <i className="wv-dot" aria-hidden="true" />}
        </Link>
      ))}
    </nav>
  );
}
