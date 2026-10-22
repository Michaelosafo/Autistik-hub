"use client";
import { useState } from "react";
import type { FeedKind, FeedRow } from "@/lib/admin-activity";

const FILTERS: { k: FeedKind | "all" | "accounts"; name: string }[] = [
  { k: "all", name: "Everything" }, { k: "accounts", name: "Sign-ups & sign-ins" }, { k: "2fa", name: "2-step" }, { k: "wallet", name: "Wallets" },
  { k: "swap", name: "Swaps" }, { k: "launch", name: "Launches" }, { k: "liquidity", name: "Liquidity" }, { k: "lock", name: "Locks" }, { k: "other", name: "Other" },
];

/** The admin's activity feed with filter buttons. The rows come from the server, already checked for admin. */
export default function AdminFeed({ rows }: { rows: (FeedRow & { ago: string })[] }) {
  const [f, setF] = useState<(typeof FILTERS)[number]["k"]>("all");
  const [n, setN] = useState(40);
  const shown = rows.filter((r) => f === "all" || r.kind === f || (f === "accounts" && (r.kind === "join" || r.kind === "signin")));
  const count = (k: (typeof FILTERS)[number]["k"]) => (k === "all" ? rows.length : rows.filter((r) => r.kind === k || (k === "accounts" && (r.kind === "join" || r.kind === "signin"))).length);
  return (
    <section className="stack">
      <b>Activity, newest first</b>
      <div className="adm-filters" role="group" aria-label="Show">
        {FILTERS.map((x) => (
          <button key={x.k} type="button" aria-pressed={f === x.k} onClick={() => { setF(x.k); setN(40); }}>{x.name} <span>{count(x.k)}</span></button>
        ))}
      </div>
      {!shown.length && <div className="empty">Nothing here yet.</div>}
      <div className="alert-list">
        {shown.slice(0, n).map((r, i) => {
          const row = <><span className="alert-ic">{r.icon}</span><span className="grow"><b>{r.who}</b> · {r.text}</span><span className="muted nowrap">{r.ago}{r.external ? " ↗" : ""}</span></>;
          return r.href
            ? <a key={i} href={r.href} className="alert-row" {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{row}</a>
            : <div key={i} className="alert-row">{row}</div>;
        })}
      </div>
      {shown.length > n && <button type="button" className="btn small" onClick={() => setN(n + 60)}>Show more ({shown.length - n} left)</button>}
    </section>
  );
}
