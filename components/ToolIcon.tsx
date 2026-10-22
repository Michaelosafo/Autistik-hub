// Line icons (24×24, drawn with the current colour) for the App's tools and the home page's sections.
const ICONS = {
  buy: <><path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h9.2a1 1 0 0 0 1-.8L20 8H6.2" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>,
  swap: <><path d="M7 4 3 8l4 4" /><path d="M3 8h13a4 4 0 0 1 4 4" /><path d="m17 20 4-4-4-4" /><path d="M21 16H8a4 4 0 0 1-4-4" /></>,
  wallet: <><path d="M4 7a2 2 0 0 1 2-2h11v4" /><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M16 14h2" /></>,
  perps: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  trending: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  momentum: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
  watch: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  scan: <><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  launch: <><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2" /><path d="M9 15 6 12c1.5-4 5-8 13-9-1 8-5 11.5-9 13z" /><circle cx="15" cy="9" r="1.6" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 15v2" /></>,
  stake: <><path d="M12 21V11" /><path d="M12 11C12 7 9 5 5 5c0 4 3 6 7 6z" /><path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z" /></>,
  arena: <><circle cx="12" cy="12" r="9" /><path d="m12 7 4 3-1.5 4.5h-5L8 10z" /><path d="M12 3v4M21 10l-5 0M3 10h5M9.5 14.5 7 19M14.5 14.5 17 19" /></>,
  rewards: <><rect x="3" y="8" width="18" height="5" rx="1" /><path d="M5 13v8h14v-8M12 8v13" /><path d="M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z" /></>,
  groups: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.1A5 5 0 0 1 21 19" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></>,
  live: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
  heart: <><path d="M12 20s-7.5-4.6-9.2-9.4C1.7 7.4 3.8 4.5 7 4.5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.2 0 5.3 2.9 4.2 6.1C19.5 15.4 12 20 12 20z" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M8 7h7" /></>,
  tool: <><path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3.5 17.5l3 3 5.7-5.7a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z" /></>,
  basket: <><path d="M3 10h18l-2 10H5z" /><path d="m8 10 3-6M16 10l-3-6" /></>,
};

export type IconName = keyof typeof ICONS;

export default function ToolIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}
