import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { analyse, history, matchesOnDate, saveOdds, savePrediction, searchTeams, setResult, sportReady, teamFixtureChoices, todayCompetitionMatches } from "@/lib/sport-football-data";
import { getGhanaMatchOdds } from "@/lib/oddsrelay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sport board (owner only). POST { action: "ready" | "search" | "analyse" | "history" | "result" }. */
export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "ready": return json({ ready: sportReady() });
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
            const modelMarkets = Array.isArray(analysis.model?.markets) ? analysis.model.markets : [];
            const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
            const mapped: any[] = [];
            for (const event of odds.matched || []) for (const book of event.bookmakers || []) {
              if (/exchange/i.test(String(book.title || book.key || ""))) continue;
              for (const market of book.markets || []) {
                if (!["h2h", "totals", "btts"].includes(market.key) || !Array.isArray(market.outcomes)) continue;
                const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
                if (valid.length < 2) continue;
                const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
                for (const outcome of valid) {
                  const label = String(outcome.name || "");
                  let modelName = "";
                  if (market.key === "h2h") {
                    if (norm(label) === norm(home)) modelName = "Home win (1)";
                    else if (norm(label) === norm(away)) modelName = "Away win (2)";
                    else if (["draw", "the draw", "tie"].includes(norm(label))) modelName = "Draw (X)";
                  } else if (market.key === "btts") {
                    modelName = /^yes$/i.test(label) ? "Both teams score: Yes" : /^no$/i.test(label) ? "Both teams score: No" : "";
                  } else {
                    const m = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                    if (m) modelName = (m[1].toLowerCase() === "over" ? "Over " : "Under ") + m[2] + " goals";
                  }
                  const modelPick = modelMarkets.find((x: any) => norm(String(x.name)) === norm(modelName));
                  if (!modelPick || !(Number(modelPick.p) > 0)) continue;
                  const price = Number(outcome.price);
                  const implied = 100 / price;
                  const noVig = implied / overround * 100;
                  const probability = Number(modelPick.p);
                  const fairOdds = 100 / probability;
                  const ev = (probability / 100) * price * 100 - 100;
                  const edge = probability - noVig;
                  mapped.push({ key: String(f.id)+market.key+label+String(book.key), home, away,
                    selection: label, market: market.key === "h2h" ? "1X2 · Match result" : market.key === "totals" ? "Goals · Over/Under" : "Both teams to score",
                    probability, fairOdds, odds: price, bookmaker: book.title || book.key || "Bookmaker",
                    implied, noVig, edge, ev, value: ev > 0 });
                }
              }
            }
            // Keep the best available price per fixture/market/outcome across Ghana bookmakers.
            const bestBySelection = new Map<string, any>();
            for (const row of mapped) {
              const k = row.market+"|"+row.selection;
              const old = bestBySelection.get(k);
              if (!old || row.odds > old.odds) bestBySelection.set(k,row);
            }
            rows.push(...bestBySelection.values());
          } catch (error) {
            // Missing coverage for one fixture should not stop the remaining scan.
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
