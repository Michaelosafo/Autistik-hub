import Link from "next/link";

export type MemberLite = { id: string; alias: string; color?: string | null; is_team?: boolean | null; team_title?: string | null; is_verified?: boolean | null; handle?: string | null };

/** A member's nickname and @handle (like X), with the gold TEAM badge on team accounts so everyone can tell it's really the team. */
export default function MemberName({ m, link = true, avatar = false, handle = true }: { m: MemberLite; link?: boolean; avatar?: boolean; handle?: boolean }) {
  const name = (
    <span className={m.is_team ? "mname team" : "mname"}>
      {avatar && <span className="avatar sm" aria-hidden="true" style={{ background: m.color || "#6141D4" }}>{m.alias.charAt(0)}</span>}
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
