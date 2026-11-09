import Link from "next/link";

/** TIK's top tabs: the Tik board, live audio rooms, live video streams, uploaded videos and short fun clips. */
export const WATCH_TABS = [
  { key: "", label: "Tik" },
  { key: "live", label: "Live" },
  { key: "streams", label: "Livestreams" },
  { key: "videos", label: "Videos" },
  { key: "fun", label: "Fun" },
] as const;
export type WatchTab = (typeof WATCH_TABS)[number]["key"];

export default function WatchTabs({ tab }: { tab: string }) {
  return (
    <nav className="wv-tabs" aria-label="TIK sections">
      {WATCH_TABS.map((t) => (
        <Link key={t.key} href={t.key ? `/mood?tab=${t.key}` : "/mood"} className={tab === t.key ? "on" : ""} aria-current={tab === t.key ? "page" : undefined} scroll={false}>
          {t.key === "streams" && <i className="wv-dot" aria-hidden="true" />}{t.label}
        </Link>
      ))}
    </nav>
  );
}
