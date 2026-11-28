import { notFound } from "next/navigation";
import { adminState } from "@/lib/admin";
import DailyValueBets from "@/components/DailyValueBets";

export const dynamic = "force-dynamic";
export const metadata = { title: "SPORT Daily Value Bets · AUTISTIK Hub", robots: { index: false, follow: false } };

/** Owner-only companion page for the SPORT upcoming value-bet scanner. */
export default async function SportValueBetsPage() {
  if (!(await adminState()).owner) notFound();
  return (
    <div className="stack">
      <header>
        <div className="dz-kick">OWNER · SPORT</div>
        <h1>📈 Daily Value Bets</h1>
        <p className="muted">Separate from the individual match-analysis board. Uses SPORT fixture, statistics and bookmaker-odds providers.</p>
      </header>
      <DailyValueBets />
    </div>
  );
}
