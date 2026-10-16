"use client";
import { useEffect, useState } from "react";
import type { PerpVenue } from "@/lib/perps";

const CHECKS = [
  "I understand I can lose all the money I put in, and it can happen in minutes.",
  "I'm 18 or older, and futures trading is legal where I live.",
  "I'll start small, use low leverage (2x or less), and never trade money I need.",
];

/** The futures exchanges unlock once the member ticks that they understand the risks (remembered on this device). */
export default function PerpsVenues({ venues }: { venues: PerpVenue[] }) {
  const [ticks, setTicks] = useState<boolean[]>(CHECKS.map(() => false));
  const [ready, setReady] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("perps-risk-ok") === "1") setReady(true); } catch {} }, []);
  const all = ticks.every(Boolean);
  const unlock = () => { setReady(true); try { localStorage.setItem("perps-risk-ok", "1"); } catch {} };

  if (!ready) return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>Before you trade futures</h2>
      {CHECKS.map((c, i) => (
        <label key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
          <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks(ticks.map((t, j) => (j === i ? e.target.checked : t)))} style={{ marginTop: 4 }} />
          <span>{c}</span>
        </label>
      ))}
      <div className="row"><button className="btn primary" type="button" disabled={!all} onClick={unlock}>Show the exchanges</button></div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 10 }}>
      <h2>Where to trade perps</h2>
      <div className="grid2" style={{ gap: 12 }}>
        {venues.map((v) => (
          <div key={v.id} className="card stack" style={{ gap: 8 }}>
            <h3>{v.name}{v.dex && <span className="badge v" style={{ marginLeft: 8, fontSize: ".6em", verticalAlign: "middle" }}>On-chain</span>}</h3>
            <p className="muted" style={{ fontSize: ".9em" }}>{v.blurb}</p>
            <div className="row"><a className="btn primary small" href={v.ref || v.url} target="_blank" rel="noopener noreferrer sponsored">Trade on {v.name.replace(" Futures", "")}</a></div>
          </div>
        ))}
      </div>
      {venues.some((v) => v.ref) && <p className="muted" style={{ fontSize: ".82em" }}>Some of these are referral links: if you sign up through them, AUTISTIK may earn a share of the exchange&apos;s fees. It costs you nothing extra.</p>}
    </div>
  );
}
