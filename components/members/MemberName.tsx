import Link from "next/link";
import Avatar from "@/components/Avatar";

export type MemberLite = { id: string; alias: string; color?: string | null; avatar_url?: string | null; is_team?: boolean | null; team_title?: string | null; is_verified?: boolean | null; handle?: string | null };

/**
 * A member's nickname and @handle (like X). Name colours: gold = AUTISTIK team, green = verified member (applied and
 * approved), black = everyone else.
 */
export default function MemberName({ m, link = true, avatar = false, handle = true }: { m: MemberLite; link?: boolean; avatar?: boolean; handle?: boolean }) {
  const name = (
    <span className={m.is_team ? "mname team" : m.is_verified ? "mname ver" : "mname"}>
      {avatar && <Avatar className="avatar sm" alias={m.alias} color={m.color} url={m.avatar_url} />}
      <span className="mname-col">
        <span className="mname-text">{m.alias}</span>
        {handle && m.handle && <span className="mhandle">@{m.handle}</span>}
      </span>
      {m.is_verified && !m.is_team && <span className="verified-badge" title="Verified by AUTISTIK">✓ VERIFIED</span>}
      {m.is_team && <span className="team-badge" title={m.team_title ? `AUTISTIK team · ${m.team_title}` : "AUTISTIK team"}>✓ TEAM</span>}
    </span>
  );
  return link ? <Link href={`/members/${m.id}`} className="mname-link">{name}</Link> : name;
}
