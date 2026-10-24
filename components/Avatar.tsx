/**
 * A member's picture: their uploaded photo (supabase/avatars.sql) or, without one, their first letter on their colour.
 * Only photos from the Hub's own avatars bucket are shown.
 */
const OK = /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/avatars\//;

export default function Avatar({ alias, color, url, className = "avatar", size }: {
  alias: string; color?: string | null; url?: string | null; className?: string; size?: number;
}) {
  const style = size ? { width: size, height: size } : undefined;
  if (url && OK.test(url)) {
    return <img className={className + " has-photo"} src={url} alt="" width={size} height={size} style={style} loading="lazy" decoding="async" />;
  }
  return (
    <span className={className} aria-hidden="true" style={{ ...style, background: color || "#6141D4" }}>
      {(alias.trim()[0] || "M").toUpperCase()}
    </span>
  );
}
