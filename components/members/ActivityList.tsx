import Link from "next/link";
import { ACTIVITY, ago, type Activity } from "@/lib/members";

/** A member's public activity: coins scanned, launches, posts, live sessions, follows. Never wallets or trades. */
export default function ActivityList({ items, empty }: { items: Activity[]; empty: string }) {
  if (!items.length) return <div className="empty">{empty}</div>;
  return (
    <ul className="activity">
      {items.map((a, i) => {
        const k = ACTIVITY[a.kind] || { icon: "•", verb: "" };
        const text = <>{k.verb && <span className="muted">{k.verb} </span>}<span>{a.label}</span></>;
        return (
          <li key={i}>
            <span className="act-ico" aria-hidden="true">{k.icon}</span>
            <span className="act-text">{a.link ? <Link href={a.link}>{text}</Link> : text}</span>
            <time className="muted" dateTime={a.at}>{ago(a.at)}</time>
          </li>
        );
      })}
    </ul>
  );
}
