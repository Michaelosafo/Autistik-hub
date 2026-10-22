import Link from "next/link";

export type MemberLite = { id: string; alias: string; color?: string | null; is_team?: boolean | null; team_title?: string | null };

/** A member's Hub name, with the gold TEAM badge on team accounts so everyone can tell it's really the team. */
export default function MemberName({ m, link = true, avatar = false }: { m: MemberLite; link?: boolean; avatar?: boolean }) {
  const name = (
    <span className={m.is_team ? "mname team" : "mname"}>
      {avatar && <span className="avatar sm" aria-hidden="true" style={{ background: m.color || "#6141D4" }}>{m.alias.charAt(0)}</span>}
      <span className="mname-text">{m.alias}</span>
      {m.is_team && <span className="team-badge" title={m.team_title ? `AUTISTIK team · ${m.team_title}` : "AUTISTIK team"}>✓ TEAM</span>}
    </span>
  );
  return link ? <Link href={`/members/${m.id}`} className="mname-link">{name}</Link> : name;
}
