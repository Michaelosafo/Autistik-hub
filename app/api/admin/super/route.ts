import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { analyse, history, matchesOnDate, saveOdds, savePrediction, searchTeams, setResult, superReady, teamFixtureChoices, todayCompetitionMatches } from "@/lib/super-api-football-data";
import { getGhanaMatchOdds } from "@/lib/oddsrelay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sport board (owner only). POST { action: "ready" | "search" | "analyse" | "history" | "result" }. */
export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "ready": return json({ ready: superReady() });
      case "search": return json({ teams: await searchTeams(String(b.q || "")) });
      case "todayMatches": return json({ matches: await todayCompetitionMatches() });
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures.slice(0, 3) : [];
        const rows: any[] = [];
        for (const f of fixtures) {
          const homeId = Number(f?.home?.id), awayId = Number(f?.away?.id);
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          if (!homeId || !awayId || homeId === awayId || !home || !away || !f?.date) continue;
          try {
            const date = new Date(String(f.date)).toISOString().slice(0, 10);
            const [analysis, odds] = await Promise.all([
              analyse(homeId, awayId, date),
              getGhanaMatchOdds(home, away, date)
            ]);
            const model = analysis.model;
            const selections = [
              { name: home, p: Number(model.home), match: (n: string) => n.toLowerCase() === home.toLowerCase() },
              { name: "Draw", p: Number(model.draw), match: (n: string) => ["draw", "the draw", "tie"].includes(n.toLowerCase()) },
              { name: away, p: Number(model.away), match: (n: string) => n.toLowerCase() === away.toLowerCase() }
            ];
            for (const event of odds.matched || []) for (const selection of selections) {
              if (!(selection.p > 0)) continue;
              const candidates: any[] = [];
              for (const book of event.bookmakers || []) {
                if (/exchange/i.test(String(book.title || book.key || ""))) continue;
                for (const market of book.markets || []) {
                  if (market.key !== "h2h" || !Array.isArray(market.outcomes) || market.outcomes.length < 3) continue;
                  const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
                  const outcome = valid.find((o: any) => selection.match(String(o.name || "")));
                  if (!outcome || !valid.length) continue;
                  const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
                  candidates.push({ price: Number(outcome.price), bookmaker: book.title || book.key || "Bookmaker",
                    implied: 100 / Number(outcome.price), noVig: (100 / Number(outcome.price)) / overround * 100 });
                }
              }
              candidates.sort((a,b) => b.price-a.price);
              const best = candidates[0];
              if (!best) continue;
              const fairOdds = 100 / selection.p;
              const ev = (selection.p / 100) * best.price * 100 - 100;
              const edge = selection.p - best.noVig;
              if (ev > 0) rows.push({ key: String(f.id)+selection.name, home, away, selection: selection.name,
                probability: selection.p, fairOdds, odds: best.price, bookmaker: best.bookmaker,
                implied: best.implied, edge, ev });
            }
          } catch (error) {
            // One unsupported competition or missing price must not stop the remaining fixtures.
          }
        }
        return json({ rows });
      }
      case "dateMatches": return json({ matches: await matchesOnDate(String(b.date || "")) });
      case "teamFixtures": {
        const teamId = Number(b.teamId);
        if (!Number.isInteger(teamId) || teamId <= 0) return json({ error: "Choose a valid team." }, 400);
        return json({ fixtures: await teamFixtureChoices(teamId) });
      }
      case "odds": {
        const home = String(b.homeName || "").trim(), away = String(b.awayName || "").trim();
        if (!home || !away || home.length > 100 || away.length > 100) return json({ error: "Choose both teams first." }, 400);
        return json(await getGhanaMatchOdds(home, away, typeof b.matchDate === "string" ? b.matchDate : undefined));
      }
      case "analyse": {
        const h = Number(b.home), a = Number(b.away);
        if (!h || !a || h === a) return json({ error: "Pick two different teams." }, 400);
        const r = await analyse(h, a, typeof b.matchDate === "string" ? b.matchDate : undefined);
        const m = r.model;
        const pick = m.home >= m.away && m.home >= m.draw ? "Home" : m.away >= m.draw ? "Away" : "Draw";
        const predictionId = await savePrediction({ home: String(b.homeName || h), away: String(b.awayName || a), league: r.leagues.home.name, kickoff: r.actual?.date || (b.matchDate ? new Date(b.matchDate + "T12:00:00Z").toISOString() : null), xg_home: m.xg.home, xg_away: m.xg.away, p_home: m.home, p_draw: m.draw, p_away: m.away, p_btts: m.btts, p_o25: m.over["2.5"], pick, note: JSON.stringify({ matchDate: b.matchDate || null, historical: r.historical, actual: r.actual }) }).catch(() => null);
        return json({ ...r, predictionId });
      }
      case "saveOdds": await saveOdds(Number(b.predictionId), b.selections, b.highestChance); return json({ ok: true });
      case "history": return json({ rows: await history() });
      case "result": await setResult(Number(b.id), String(b.result || "")); return json({ ok: true });
    }
    return json({ error: "Unknown." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message.slice(0, 300) }, 502);
  }
}
