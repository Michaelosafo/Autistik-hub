/** Where a live session streams, from its join link. YouTube plays on the page; everything else opens in a new tab. */
export function streamOf(link: string | null | undefined): { kind: "youtube" | "x" | "link" | "none"; embed?: string; label: string } {
  if (!link || !/^https:\/\//.test(link)) return { kind: "none", label: "Link coming soon" };
  let u: URL;
  try { u = new URL(link); } catch { return { kind: "none", label: "Link coming soon" }; }
  const host = u.hostname.replace(/^www\.|^m\./, "");
  let yt = "";
  if (host === "youtu.be") yt = u.pathname.slice(1);
  else if (host === "youtube.com") yt = u.searchParams.get("v") || (u.pathname.match(/^\/(?:live|embed|shorts)\/([^/?]+)/)?.[1] ?? "");
  if (/^[A-Za-z0-9_-]{6,20}$/.test(yt)) return { kind: "youtube", embed: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0`, label: "Watch on YouTube" };
  if (host === "x.com" || host === "twitter.com") return { kind: "x", label: /\/spaces\//.test(u.pathname) ? "Open the X Space" : "Open on X" };
  return { kind: "link", label: `Open on ${host}` };
}

export type LiveSession = {
  id: string; title: string; host: string | null; kind: string; starts_at: string; join_link: string | null; description: string | null;
  is_live?: boolean; ended?: boolean;
};

/** Live now: marked live by the team, or inside its start window (15 min early to 3 hours after) and not ended. */
export function isLiveNow(s: LiveSession, now = Date.now()) {
  if (s.ended) return false;
  if (s.is_live) return true;
  const t = Date.parse(s.starts_at);
  return t - 15 * 60e3 <= now && now <= t + 3 * 3600e3;
}
