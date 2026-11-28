import { json } from "@/lib/ai";
import { getFiveDollarFootballMatchOdds, getFiveDollarFootballStatus } from "@/lib/fivedollarfootball";
import { adminState } from "@/lib/admin";
import { analyse, getLeagueCatalogue, getLeagueUpcomingFixtures, history, matchesOnDate, saveOdds, savePrediction, searchTeams, setResult, sportReady, teamFixtureChoices, todayCompetitionMatches, saveSuperSnapshot, settleSuperSnapshots, getSuperOddsPerformance } from "@/lib/sport-football-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;



/** Sport board (owner only). POST { action: "ready" | "search" | "analyse" | "history" | "result" }. */
export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "ready": return json({ ready: sportReady(), provider: "football-data.org" });
      case "oddsStatus": return json({ ...await getFiveDollarFootballStatus(), fixtureProvider: "football-data.org", statisticsProvider: "football-data.org", oddsProvider: "5DollarFootballAPI" });
      case "search": return json({ teams: await searchTeams(String(b.q || "")) });
      case "todayMatches": { const matches = await todayCompetitionMatches(); return json({ matches: Array.isArray(matches) ? matches : [], fixtureProvider: "football-data.org" }); }
      case "leagues": return json({ leagues: await getLeagueCatalogue(), provider: "football-data.org" });
      case "leagueFixtures": {
        const result = await getLeagueUpcomingFixtures(String(b.leagueCode || ""));
        return json(result);
      }
      case "superPerformance": {
        const settled = await settleSuperSnapshots(8);
        return json({ settled, performance: await getSuperOddsPerformance() });
      }
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures.slice(0, 20) : [];
        const settled = await settleSuperSnapshots(4).catch(() => ({ settled: 0 }));
        const rows: any[] = [];
        const scanDiagnostics: any[] = [];
        const now = Date.now();
        const seenFixtures = new Set<string>();
        for (const f of fixtures) {
          const kickoff = Date.parse(String(f?.date || ""));
          const status = String(f?.status || "").toUpperCase();
          const fixtureKey = String(f?.id || [f?.home?.name, f?.away?.name, f?.date].join("|"));
          if (!Number.isFinite(kickoff) || kickoff < now || (status && !["SCHEDULED", "TIMED"].includes(status)) || seenFixtures.has(fixtureKey)) continue;
          seenFixtures.add(fixtureKey);
          const homeId = Number(f?.home?.id), awayId = Number(f?.away?.id);
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          if (!homeId || !awayId || homeId === awayId || !home || !away || !f?.date) continue;
          const date = new Date(String(f.date)).toISOString().slice(0, 10);
          // Keep the odds feed independent from team-history coverage. A missing
          // stats sample must not hide genuine bookmaker prices for this fixture.
          const [analysisResult, oddsResult] = await Promise.allSettled([
            analyse(homeId, awayId, String(f.date).slice(0, 10)),
            getFiveDollarFootballMatchOdds(home, away, String(f.date))
          ]);
          const analysis = analysisResult.status === "fulfilled" ? analysisResult.value : null;
          const odds = oddsResult.status === "fulfilled" ? oddsResult.value : null;
          const diagnostic: any = {
            fixture: home + " vs " + away,
            oddsEvents: odds?.diagnostics?.eventsReturned ?? odds?.count ?? 0,
            eventsReturned: odds?.diagnostics?.eventsReturned ?? odds?.count ?? 0,
            matchedEvents: (odds?.matched || []).length,
            matched: (odds?.matched || []).length,
            bookmakers: odds?.availableBookmakers || [],
            markets: [...new Set((odds?.matched || []).flatMap((e: any) => (e.bookmakers || []).flatMap((bk: any) => (bk.markets || []).map((m: any) => m.key))))],
            providers: odds?.diagnostics?.providers || null,
            analysisError: analysisResult.status === "rejected" ? (analysisResult.reason instanceof Error ? analysisResult.reason.message : String(analysisResult.reason)) : null,
            oddsError: oddsResult.status === "rejected" ? (oddsResult.reason instanceof Error ? oddsResult.reason.message : String(oddsResult.reason)) : null,
            oddsProvider: "5DollarFootballAPI"
          };
          if (!odds) {
            scanDiagnostics.push(diagnostic);
            continue;
          }
          if (!odds.matched?.length) {
            diagnostic.feedExamples = (odds.diagnostics?.sampleEvents || []).slice(0, 4).map((e: any) => String(e.home || "") + " vs " + String(e.away || ""));
          }
          const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
          const modelMarkets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
          const mapped: any[] = [];
          for (const event of odds.matched || []) for (const book of event.bookmakers || []) {
            if (/exchange/i.test(String(book.title || book.key || ""))) continue;
            for (const market of book.markets || []) {
              if (!market.key || !Array.isArray(market.outcomes)) continue;
              const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
              if (valid.length < 2) continue;
              const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
              for (const outcome of valid) {
                const label = String(outcome.name || "");
                let modelName = "";
                if (market.key === "h2h") {
                  if (["1", "home", "home win"].includes(norm(label)) || norm(label) === norm(home)) modelName = "Home win (1)";
                  else if (["2", "away", "away win"].includes(norm(label)) || norm(label) === norm(away)) modelName = "Away win (2)";
                  else if (["x", "draw", "the draw", "tie"].includes(norm(label))) modelName = "Draw (X)";
                } else if (market.key === "totals") {
                  const m = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                  if (m) modelName = (m[1].toLowerCase() === "over" ? "Over " : "Under ") + m[2] + " goals";
                } else if (market.key === "asian_handicap") {
                  const m = label.match(/^(home|away)\s+([+-]\d+(?:\.5)?)$/i);
                  if (m) {
                    const side = m[1].toLowerCase() === "home" ? "Home" : "Away";
                    const handicap = Number(m[2]);
                    if (Math.abs(handicap % 1) === 0.5) {
                      modelName = handicap < 0
                        ? side + " " + handicap + " handicap (win by " + (Math.abs(handicap) + 0.5) + "+)"
                        : side + " +" + handicap + " handicap (lose by " + (handicap - 0.5) + " at most)";
                    }
                  }
                }
                let modelPick = modelMarkets.find((x: any) => norm(String(x.name)) === norm(modelName));
                if (market.key === "h2h" && modelName === "Draw (X)") continue;
                if (!["h2h", "totals", "asian_handicap"].includes(market.key)) continue;
                const price = Number(outcome.price);
                const implied = 100 / price;
                const noVig = implied / overround * 100;
                const marketTitle = market.title || (market.key === "h2h" ? "Straight win" : market.key === "totals" ? "Goals · Over/Under" : market.key === "asian_handicap" ? "Asian handicap" : String(market.key).replace(/[_-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));
                if (!modelPick || !(Number(modelPick.p) > 0)) {
                  mapped.push({ key: String(f.id)+market.key+label+String(book.key), date: f.date, home, away, selection: label, market: marketTitle, probability: null, fairOdds: null, odds: price, openingOdds: outcome.openingPrice ?? null, closingOdds: outcome.closingPrice ?? null, oddsMovementPct: outcome.movementPct ?? null, oddsMovement: outcome.movement ?? "unavailable", bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge: null, ev: null, value: false, modelSupported: false, modelError: diagnostic.analysisError || "No usable Autistik probability for this selection." });
                  continue;
                }
                const probability = Number(modelPick.p);
                const fairOdds = 100 / probability;
                const ev = (probability / 100) * price * 100 - 100;
                const edge = probability - noVig;
                const modelContext = {
                  homeForm: analysis?.teams?.home?.season?.form || "",
                  awayForm: analysis?.teams?.away?.season?.form || "",
                  homeGoalsFor: analysis?.teams?.home?.season?.goalsFor?.total ?? null,
                  homeGoalsAgainst: analysis?.teams?.home?.season?.goalsAgainst?.total ?? null,
                  awayGoalsFor: analysis?.teams?.away?.season?.goalsFor?.total ?? null,
                  awayGoalsAgainst: analysis?.teams?.away?.season?.goalsAgainst?.total ?? null,
                  homeMatches: analysis?.teams?.home?.season?.played?.total ?? null,
                  awayMatches: analysis?.teams?.away?.season?.played?.total ?? null,
                  expectedGoals: analysis?.model?.xg || null,
                  verdict: analysis?.verdict || []
                };
                mapped.push({ key: String(f.id)+market.key+label+String(book.key), date: f.date, home, away, selection: label, market: marketTitle, probability, fairOdds, odds: price, openingOdds: outcome.openingPrice ?? null, closingOdds: outcome.closingPrice ?? null, oddsMovementPct: outcome.movementPct ?? null, oddsMovement: outcome.movement ?? "unavailable", bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge, ev, value: ev > 0, modelSupported: true, modelProvider: "Autistik Poisson · football-data.org stats", modelContext, priceAssessment: ev > 0 ? "UNDERPRICED · VALUE" : ev < 0 ? "OVERPRICED · AVOID" : "FAIR PRICE" });
              }
            }
          }
          const bestBySelection = new Map<string, any>();
          for (const row of mapped) {
            const k = row.market+"|"+row.selection;
            const old = bestBySelection.get(k);
            if (!old || row.odds > old.odds) bestBySelection.set(k,row);
          }
          const fixtureRows = [...bestBySelection.values()].map((row: any) => ({
            ...row,
            bookmakerQuotes: mapped.filter((quote: any) => quote.market === row.market && quote.selection === row.selection)
              .map((quote: any) => ({
                bookmaker: quote.bookmaker, odds: quote.odds,
                openingOdds: quote.openingOdds, oddsMovementPct: quote.oddsMovementPct,
                oddsMovement: quote.oddsMovement
              })).sort((a: any, b: any) => Number(b.odds) - Number(a.odds))
          }));
          rows.push(...fixtureRows);
          if (analysis && fixtureRows.length) {
            await saveSuperSnapshot({
              homeId, awayId, home, away,
              league: String(f?.competition?.name || "Football"),
              kickoff: String(f.date), analysis,
              selections: fixtureRows.map((r: any) => ({
                market: r.market, selection: r.selection, odds: r.odds,
                bookmaker: r.bookmaker, probability: r.probability,
                fairOdds: r.fairOdds, implied: r.implied, ev: r.ev,
                openingOdds: r.openingOdds, closingOdds: r.closingOdds,
                oddsMovementPct: r.oddsMovementPct, oddsMovement: r.oddsMovement,
                bookmakerQuotes: r.bookmakerQuotes
              }))
            }).catch((error: any) => { diagnostic.historySaveError = error instanceof Error ? error.message : String(error); });
          }
          scanDiagnostics.push(diagnostic);
          // One fixture's odds request at a time; pace within this single
          // server invocation so the provider catalogue cache is shared.
          if (seenFixtures.size < fixtures.length) await new Promise(resolve => setTimeout(resolve, 1600));
        }
        const performance = await getSuperOddsPerformance().catch(() => []);
        return json({ rows, diagnostics: scanDiagnostics, settled, performance });
      }
      case "dateMatches": return json({ matches: await matchesOnDate(String(b.date || "")), fixtureProvider: "football-data.org" });
      case "teamFixtures": {
        const teamId = Number(b.teamId);
        if (!Number.isInteger(teamId) || teamId <= 0) return json({ error: "Choose a valid team." }, 400);
        return json({ fixtures: await teamFixtureChoices(teamId) });
      }
      case "odds": {
        const home = String(b.homeName || "").trim(), away = String(b.awayName || "").trim();
        if (!home || !away || home.length > 100 || away.length > 100) return json({ error: "Choose both teams first." }, 400);
        return json(await getFiveDollarFootballMatchOdds(home, away, typeof b.matchDate === "string" ? b.matchDate : new Date().toISOString()));
      }
      case "analyse": {
        const h = Number(b.home), a = Number(b.away);
        if (!h || !a || h === a) return json({ error: "Pick two different teams." }, 400);
        const r = await analyse(h, a);
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
