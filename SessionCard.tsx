import Art from "@/components/Art";
import SeatButton from "@/components/SeatButton";

export type Session = { id: string; title: string; host: string | null; kind: string; starts_at: string; join_link: string | null; description: string | null };

export default function SessionCard({ s, compact, seats, admin }: { s: Session; compact?: boolean; seats?: number; admin?: boolean }) {
  const d = new Date(s.starts_at);
  const when = d.toLocaleString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = `${d.toLocaleString("en", { weekday: "short", timeZone: "UTC" })} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  const thumb = (
    <div className="thumb" style={{ position: "relative" }}>
      <Art kind="session" type={s.kind} className="art" style={{ position: "absolute", inset: 0 }} />
      <span className="when">{when}</span>
    </div>
  );
  const info = (
    <div className="stack" style={{ gap: 4, minWidth: 0 }}>
      <div className="row" style={{ gap: 6 }}><span className="badge v">{s.kind}</span></div>
      <h3>{s.title}</h3>
      <span className="muted" style={{ fontSize: ".9em" }}>{time} · Host: {s.host || "TBA"}</span>
      {!compact && s.description && <p>{s.description}</p>}
      {seats !== undefined && <span className="muted" style={{ fontSize: ".85em" }}>{seats ? `${seats} seat${seats > 1 ? "s" : ""} saved` : "Be the first to save a seat"}</span>}
      {compact && <div className="row" style={{ marginTop: 6 }}><SeatButton sessionId={s.id} /></div>}
    </div>
  );
  if (compact) return <div className="session compact">{thumb}{info}</div>;
  return (
    <div className="card session">
      {thumb}{info}
      <div className="row session-act" style={{ gap: 6 }}>
        <SeatButton sessionId={s.id} />
        {s.join_link && <a className="btn small" href={s.join_link} target="_blank" rel="noopener noreferrer">Join link</a>}
        {admin && <SeatButton sessionId={s.id} remove />}
      </div>
    </div>
  );
}
