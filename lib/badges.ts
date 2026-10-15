/** Badges shown on member profiles. Worked out from what the database already counts, so nobody can fake them. */
export type Badge = { id: string; label: string; emoji: string; why: string };

export function badgesFor(p: {
  isAdmin?: boolean; practitioner?: boolean; posts: number; sessions: number; support: number; points: number;
  qualify: number; joined: string;
}): Badge[] {
  const b: Badge[] = [];
  if (p.isAdmin) b.push({ id: "team", label: "Hub team", emoji: "🛡️", why: "Runs the Hub" });
  if (p.practitioner) b.push({ id: "pro", label: "Verified practitioner", emoji: "✅", why: "Checked by the Hub team" });
  if (Date.parse(p.joined) < Date.parse("2027-01-01")) b.push({ id: "early", label: "Early member", emoji: "🌱", why: "Joined in the Hub's first months" });
  if (p.posts >= 1) b.push({ id: "voice", label: "First post", emoji: "💬", why: "Posted in a group" });
  if (p.posts >= 10) b.push({ id: "regular", label: "Regular", emoji: "⭐", why: "10+ posts this round" });
  if (p.sessions >= 3) b.push({ id: "sessions", label: "Session goer", emoji: "🎙️", why: "Saved seats at 3+ live sessions this round" });
  if (p.support >= 10) b.push({ id: "helper", label: "Kind voice", emoji: "💛", why: "Posts got 10+ hearts this round" });
  if (p.points >= p.qualify) b.push({ id: "airdrop", label: "Airdrop ready", emoji: "🎁", why: "Has enough points for this round's airdrop" });
  return b;
}

export const PROFILE_COLORS = ["#D9472F", "#0B857A", "#6141D4", "#B97F00", "#2F6FB5", "#B5306A", "#3F7F2F", "#8A4F2A"];
