import Link from "next/link";
import { ACTIVITY, ago, type Activity } from "@/lib/members";

function Item({ a }: { a: Activity }) {
  const k = ACTIVITY[a.kind] || { icon: "•", verb: "" };
  const text = <>{k.verb && <span className="muted">{k.verb} </span>}<span>{a.label}</span></>;
  return (
    <li>
      <span className="act-ico" aria-hidden="true">{k.icon}</span>
      <span className="act-text">{a.link ? <Link href={a.link}>{text}</Link> : text}</span>
      <time className="muted" dateTime={a.at}>{ago(a.at)}</time>
    </li>
  );
}

/**
 * A member's public activity: coins scanned, launches, posts, live sessions, follows. Never wallets or trades.
 * The latest 3 show; "View all" opens the rest right there.
 */
export default function ActivityList({ items, empty, first = 3 }: { items: Activity[]; empty: string; first?: number }) {
  if (!items.length) return <div className="empty">{empty}</div>;
  const rest = items.slice(first);
  return (
    <div className="act-wrap">
      <ul className="activity">{items.slice(0, first).map((a, i) => <Item key={i} a={a} />)}</ul>
      {rest.length > 0 && (
        <details className="act-more">
          <summary><span className="act-open">View all {items.length} →</span><span className="act-close">Show less</span></summary>
          <ul className="activity">{rest.map((a, i) => <Item key={i} a={a} />)}</ul>
        </details>
      )}
    </div>
  );
}
