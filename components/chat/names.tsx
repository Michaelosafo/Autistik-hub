"use client";
export type Person = { id: string; alias: string; color?: string | null; avatar_url?: string | null; is_team?: boolean | null; is_verified?: boolean | null; handle?: string | null };
export const PERSON = "id,alias,color,avatar_url,is_team,is_verified,handle";

/** A name in gold (team), green (verified) or black (everyone else), with its tick. */
export function Name({ p, small }: { p: Person | null | undefined; small?: boolean }) {
  if (!p) return <span className="ch-name">Member</span>;
  const cls = p.is_team ? "team" : p.is_verified ? "ver" : "";
  return (
    <span className={`ch-name ${cls}${small ? " sm" : ""}`}>
      {p.alias}
      {p.is_team ? <i className="ch-tick team" title="AUTISTIK team">✓</i> : p.is_verified ? <i className="ch-tick ver" title="Verified">✓</i> : null}
    </span>
  );
}

export function Face({ p, size = 40, group }: { p?: Person | null; size?: number; group?: string | null }) {
  const label = group ?? p?.alias ?? "?";
  if (p?.avatar_url) return <img className="ch-face" src={p.avatar_url} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  return <span className={`ch-face${group ? " grp" : ""}`} style={{ width: size, height: size, background: group ? undefined : p?.color || "#8E7CC3" }} aria-hidden="true">{label.slice(0, group ? 2 : 1).toUpperCase()}</span>;
}
