import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { analyse, history, matchesOnDate, saveOdds, savePrediction, searchTeams, setResult, sportReady, teamFixtureChoices, todayCompetitionMatches, resolveTeamIds, getLeagueCatalogue, getLeagueUpcomingFixtures } from "@/lib/sport-football-data";
import { getGhanaOddsRelayStatus, getGhanaMatchOdds } from "@/lib/oddsrelay";
import { getOddsPapiUpcomingFixtures } from "@/lib/oddspapi";
import { getFiveDollarFootballStatus, getFiveDollarFootballMatchOdds, getFiveDollarFootballUpcomingFixtures } from "@/lib/fivedollarfootball";
import { analyse as analyseSportMonks, getSportMonksLeagueUpcomingFixtures, superReady } from "@/lib/super-sportmonks-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function withTimeout<T>(task: Promise<T>, label: string, timeoutMs = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + " timed out after " + timeoutMs + "ms")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


/** Sport board (owner only). POST { action: "ready" | "search" | "analyse" | "history" | "result" }. */
export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "ready": return json({ ready: sportReady(), provider: "football-data.org" });
      case "oddsStatus": {
        const [oddsrelay, fivedollarfootball] = await Promise.allSettled([getGhanaOddsRelayStatus(), getFiveDollarFootballStatus()]);
        return json({
          sportmonks: { active: superReady(), provider: "SportMonks", error: superReady() ? null : "SPORTMONKS_API_TOKEN is missing in Vercel Production." },
          footballData: { active: sportReady(), provider: "football-data.org", error: sportReady() ? null : "FOOTBALL_DATA_TOKEN is missing in Vercel Production." },
          oddsrelay: oddsrelay.status === "fulfilled" ? oddsrelay.value : { active: false, error: String(oddsrelay.reason?.message || oddsrelay.reason) },
          fivedollarfootball: fivedollarfootball.status === "fulfilled" ? fivedollarfootball.value : { keyConfigured: !!process.env.FIVEDOLLARFOOTBALL_API_KEY, active: false, error: String(fivedollarfootball.reason?.message || fivedollarfootball.reason) }
        });
      }
      case "search": return json({ teams: await searchTeams(String(b.q || "")) });
      case "leagues": {
        const leagues = await getLeagueCatalogue();
        // Keep the major UEFA knockout competitions selectable even when the
        // football-data.org account does not list them in its own catalogue.
        // SportMonks supplies their fixtures; football-data.org is still used
        // for team-history modelling wherever its team coverage allows it.
        if (superReady()) {
          const known = new Set(leagues.map((league: any) => String(league.code || "").toUpperCase()));
          const european = [
            { id: -9001, code: "CL", name: "UEFA Champions League", country: "Europe", seasons: [] },
            { id: -9002, code: "EL", name: "UEFA Europa League", country: "Europe", seasons: [] },
            { id: -9003, code: "ECL", name: "UEFA Conference League", country: "Europe", seasons: [] }
          ];
          for (const league of european) if (!known.has(league.code)) leagues.push(league);
        }
        return json({ leagues });
      }
      case "leagueFixtures": {
        const leagueCode=String(b.leagueCode || "").trim().toUpperCase();
        const leagueName=String(b.leagueName || "").trim();
        if(!leagueCode)return json({error:"Choose a valid league."},400);
        const [sportMonksResult, footballDataResult] = await Promise.allSettled([
          superReady()
            ? getSportMonksLeagueUpcomingFixtures(leagueCode, leagueName)
            : Promise.reject(new Error("SPORTMONKS_API_TOKEN is missing in Vercel Production.")),
          getLeagueUpcomingFixtures(leagueCode)
        ]);
        const sportMonks = sportMonksResult.status === "fulfilled" ? sportMonksResult.value : null;
        const footballData = footballDataResult.status === "fulfilled" ? footballDataResult.value : { fixtures: [], clubs: [] };
        // SportMonks is the fixture source. Keep football-data.org as a fallback
        // so an upstream SportMonks outage does not blank the selector entirely.
        const fixtures = sportMonks?.fixtures?.length ? sportMonks.fixtures : footballData.fixtures;
        const clubs = sportMonks?.clubs?.length ? sportMonks.clubs : footballData.clubs;
        return json({
          fixtures, clubs,
          fixtureProvider: sportMonks?.fixtures?.length ? "SportMonks" : "football-data.org fallback",
          statisticsProvider: "football-data.org",
          fixtureWindowDays: 30,
          providers: {
            sportmonks: { active: superReady(), matchedFixtures: sportMonks?.fixtures?.length || 0,
              error: sportMonksResult.status === "rejected" ? String(sportMonksResult.reason?.message || sportMonksResult.reason) : null },
            footballData: { active: sportReady(), matchedFixtures: footballData.fixtures?.length || 0,
              error: footballDataResult.status === "rejected" ? String(footballDataResult.reason?.message || footballDataResult.reason) : null }
          }
        });
      }
      case "todayMatches": {
        const matches = await todayCompetitionMatches();
        return json({ matches, fixtureProvider: "football-data.org", fixtureCount: matches.length });
      }
      case "dateMatches": return json({ matches: await matchesOnDate(String(b.date || "")) });
      case "teamFixtures": {
        const teamId = Number(b.teamId);
        if (!Number.isInteger(teamId) || teamId <= 0) return json({ error: "Choose a valid team." }, 400);
        return json({ fixtures: await teamFixtureChoices(teamId) });
      }
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures : [];
        const rows: any[] = [];
        const scanDiagnostics: any[] = [];
        await Promise.all(fixtures.map(async (f: any) => {
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          if (!home || !away || !f?.date) return;
          try {
            const date = new Date(String(f.date)).toISOString().slice(0, 10);
            // Resolve third-party fixture names to football-data.org team IDs before loading team statistics.
            const footballDataTeamIds = sportReady() ? await resolveTeamIds([home, away]) : {};
            const normalizeTeam = (value: string) => String(value || "").toLowerCase().normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "").replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
              .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
            const fromSportMonks = String(f?.fixtureSource || f?.provider || "").toLowerCase().includes("sportmonks");
            // Never pass SportMonks team IDs into football-data.org. Resolve by
            // club name first; only use fixture IDs directly for football-data fixtures.
            const footballDataHomeId = footballDataTeamIds[normalizeTeam(home)] || (!fromSportMonks ? Number(f?.home?.id) : 0) || 0;
            const footballDataAwayId = footballDataTeamIds[normalizeTeam(away)] || (!fromSportMonks ? Number(f?.away?.id) : 0) || 0;
            const sportMonksHomeId = fromSportMonks ? Number(f?.home?.id) || 0 : 0;
            const sportMonksAwayId = fromSportMonks ? Number(f?.away?.id) || 0 : 0;
            const [analysisResult, sportMonksAnalysisResult, relayResult, fiveDollarResult] = await Promise.allSettled([
              footballDataHomeId > 0 && footballDataAwayId > 0 && footballDataHomeId !== footballDataAwayId
                ? withTimeout(analyse(footballDataHomeId, footballDataAwayId, date), "football-data.org model analysis", 25000)
                : Promise.reject(new Error(sportReady()
                    ? "Could not confidently match both teams to football-data.org."
                    : "FOOTBALL_DATA_TOKEN is missing in Vercel Production; football-data.org statistics are unavailable.")),
              superReady() && sportMonksHomeId > 0 && sportMonksAwayId > 0 && sportMonksHomeId !== sportMonksAwayId
                ? withTimeout(analyseSportMonks(sportMonksHomeId, sportMonksAwayId, date), "SportMonks model fallback", 25000)
                : Promise.reject(new Error("SportMonks team IDs are unavailable for this fixture.")),
              withTimeout(getGhanaMatchOdds(home, away, date), "OddsRelay odds lookup", 25000),
              withTimeout(getFiveDollarFootballMatchOdds(home, away, String(f.date), Number(f.providerFixtureId) || undefined), "5DollarFootballAPI odds lookup", 25000)
            ]);
            const analysis = analysisResult.status === "fulfilled" ? analysisResult.value
              : sportMonksAnalysisResult.status === "fulfilled" ? sportMonksAnalysisResult.value : null;
            const analysisProvider = analysisResult.status === "fulfilled" ? "football-data.org"
              : sportMonksAnalysisResult.status === "fulfilled" ? "SportMonks fallback" : null;
            const oddsSources: any[] = [];
            if (relayResult.status === "fulfilled") oddsSources.push({ name: "OddsRelay", value: relayResult.value });
            if (fiveDollarResult.status === "fulfilled") oddsSources.push({ name: "5DollarFootballAPI", value: fiveDollarResult.value });
            if (!oddsSources.length) {
              const errors = [
                relayResult.status === "rejected" ? "OddsRelay: " + String(relayResult.reason?.message || relayResult.reason) : "",
                fiveDollarResult.status === "rejected" ? "5DollarFootballAPI: " + String(fiveDollarResult.reason?.message || fiveDollarResult.reason) : ""
              ].filter(Boolean);
              throw new Error(errors.join(" | ") || "No odds provider returned prices.");
            }
            const matchedEvents: any[] = oddsSources.flatMap((source: any) => Array.isArray(source.value?.matched) ? source.value.matched : []);
            const availableBookmakers: any[] = [...new Set(oddsSources.flatMap((source: any) => Array.isArray(source.value?.availableBookmakers) ? source.value.availableBookmakers : []))];
            const sampleEvents: any[] = oddsSources.flatMap((source: any) => Array.isArray(source.value?.diagnostics?.sampleEvents) ? source.value.diagnostics.sampleEvents : []);
            const sourceDiagnostics = Object.fromEntries(oddsSources.map((source: any) => [source.name, source.value?.diagnostics || {}]));
            const sourceErrors = {
              oddsrelay: relayResult.status === "rejected" ? String(relayResult.reason?.message || relayResult.reason) : null,
              fivedollarfootball: fiveDollarResult.status === "rejected" ? String(fiveDollarResult.reason?.message || fiveDollarResult.reason) : null
            };
            const modelContext = analysis ? {
              homeForm: analysis.teams?.home?.season?.form || "",
              awayForm: analysis.teams?.away?.season?.form || "",
              homeGoalsFor: analysis.teams?.home?.season?.goalsFor?.total ?? null,
              homeGoalsAgainst: analysis.teams?.home?.season?.goalsAgainst?.total ?? null,
              awayGoalsFor: analysis.teams?.away?.season?.goalsFor?.total ?? null,
              awayGoalsAgainst: analysis.teams?.away?.season?.goalsAgainst?.total ?? null,
              expectedGoals: analysis.model?.xg || null,
              verdict: Array.isArray(analysis.verdict) ? analysis.verdict.slice(0,5) : []
            } : null;
            const modelMarkets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
            const marketsFound = [...new Set(matchedEvents.flatMap((e: any) =>
              (Array.isArray(e?.bookmakers) ? e.bookmakers : []).flatMap((bk: any) =>
                (Array.isArray(bk?.markets) ? bk.markets : []).map((m: any) => m?.key).filter(Boolean)
              )
            ))];
            scanDiagnostics.push({
              fixture: home + ' vs ' + away,
              oddsEvents: oddsSources.reduce((sum: number, source: any) => sum + Number(source.value?.diagnostics?.eventsReturned ?? source.value?.count ?? 0), 0),
              eventsReturned: oddsSources.reduce((sum: number, source: any) => sum + Number(source.value?.diagnostics?.eventsReturned ?? source.value?.count ?? 0), 0),
              matchedEvents: matchedEvents.length,
              matched: matchedEvents.length,
              bookmakers: availableBookmakers,
              markets: marketsFound,
              providers: {
                oddsrelay: { ok: relayResult.status === "fulfilled", matched: relayResult.status === "fulfilled" ? Number(relayResult.value?.count || 0) : 0, error: sourceErrors.oddsrelay },
                fivedollarfootball: { ok: fiveDollarResult.status === "fulfilled", matched: fiveDollarResult.status === "fulfilled" ? Number(fiveDollarResult.value?.count || 0) : 0, error: sourceErrors.fivedollarfootball, plan: sourceDiagnostics["5DollarFootballAPI"]?.plan || null, requestedBookmakers: sourceDiagnostics["5DollarFootballAPI"]?.requestedBookmakers ?? null, returnedBookmakers: sourceDiagnostics["5DollarFootballAPI"]?.returnedBookmakers ?? null, bookmakers: sourceDiagnostics["5DollarFootballAPI"]?.bookmakers || [], markets: sourceDiagnostics["5DollarFootballAPI"]?.markets || [], emptyOddsReason: sourceDiagnostics["5DollarFootballAPI"]?.emptyOddsReason || null, oddsRequestError: sourceDiagnostics["5DollarFootballAPI"]?.oddsRequestError || null }
              },
              feedExamples: sampleEvents.slice(0, 4).map((e: any) => String(e?.home_team || e?.home || "") + " vs " + String(e?.away_team || e?.away || "")),
              analysisProvider,
              analysisError: analysis ? null : [
                analysisResult.status === "rejected" ? "football-data.org: " + String(analysisResult.reason?.message || analysisResult.reason) : "",
                sportMonksAnalysisResult.status === "rejected" ? "SportMonks: " + String(sportMonksAnalysisResult.reason?.message || sportMonksAnalysisResult.reason) : ""
              ].filter(Boolean).join(" | ")
            });
            const norm = (v: string) => String(v || "").toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
            const mapped: any[] = [];
            for (const event of matchedEvents) for (const book of (Array.isArray(event?.bookmakers) ? event.bookmakers : [])) {
              if (/exchange/i.test(String(book.title || book.key || ""))) continue;
              for (const market of (Array.isArray(book?.markets) ? book.markets : [])) {
                if (!market.key || !Array.isArray(market.outcomes)) continue;
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
                  } else if (market.key === "double_chance") {
                    const pick = norm(label).replace(/\s/g, "");
                    if (["1x", "homedraw", "homeordraw"].includes(pick)) modelName = "Home or draw (1X)";
                    else if (["x2", "drawaway", "draworaway"].includes(pick)) modelName = "Away or draw (X2)";
                    else if (["12", "homeaway", "homeoraway"].includes(pick)) modelName = "Home or away (12)";
                  } else if (market.key === "btts") {
                    modelName = /^yes$/i.test(label) ? "Both teams score: Yes" : /^no$/i.test(label) ? "Both teams score: No" : "";
                  } else {
                    const m = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                    if (m) modelName = (m[1].toLowerCase() === "over" ? "Over " : "Under ") + m[2] + " goals";
                  }
                  let modelPick = modelMarkets.find((x: any) => norm(String(x.name)) === norm(modelName));
                  // Totals are priced directly from the Poisson goal grid. This handles
                  // every available half-goal line (including 3.5) without label mismatches.
                  if (market.key === "totals") {
                    const total = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                    const line = total ? String(Number(total[2])) : "";
                    const overProbability = line ? Number(analysis?.model?.over?.[line]) : NaN;
                    if (total && Number.isFinite(overProbability)) {
                      modelPick = { name: modelName, p: total[1].toLowerCase() === "over" ? overProbability : 100 - overProbability };
                    }
                  }
                  if (market.key === "double_chance") {
                    const p = analysis?.model || {};
                    const pick = norm(label).replace(/\s/g, "");
                    const probability = ["1x", "homedraw", "homeordraw"].includes(pick) ? Number(p.home) + Number(p.draw)
                      : ["x2", "drawaway", "draworaway"].includes(pick) ? Number(p.away) + Number(p.draw)
                      : ["12", "homeaway", "homeoraway"].includes(pick) ? Number(p.home) + Number(p.away) : 0;
                    if (probability > 0) modelPick = { name: modelName, p: probability };
                  }
                  const price = Number(outcome.price);
                  const implied = 100 / price;
                  const noVig = implied / overround * 100;
                  const marketTitle = market.key === "h2h" ? "1X2 · Match result" : market.key === "totals" ? "Goals · Over/Under" : market.key === "btts" ? "Both teams to score" : String(market.key).replace(/[_-]+/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
                  if (!modelPick || !(Number(modelPick.p) > 0)) {
                    mapped.push({ key: String(f.id)+market.key+label+String(book.key), date: f.date, competition: String(f.competition?.name || f.competition || f.league?.name || "Other competitions"), home, away, selection: label, market: marketTitle, probability: null, fairOdds: null, odds: price, bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge: null, ev: null, value: false, modelSupported: false, modelContext });
                    continue;
                  }
                  const probability = Number(modelPick.p);
                  const fairOdds = 100 / probability;
                  const ev = (probability / 100) * price * 100 - 100;
                  const edge = probability - noVig;
                  mapped.push({ key: String(f.id)+market.key+label+String(book.key), date: f.date, competition: String(f.competition?.name || f.competition || f.league?.name || "Other competitions"), home, away, selection: label, market: marketTitle, probability, fairOdds, odds: price, bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge, ev, value: ev > 0, modelSupported: true, modelContext });
                }
              }
            }
            // Keep the best available price per fixture/market/outcome across Ghana bookmakers.
            const bestBySelection = new Map<string, any>();
            for (const row of mapped) {
              const k = row.home+"|"+row.away+"|"+String(row.date || "")+"|"+row.market+"|"+row.selection;
              const old = bestBySelection.get(k);
              if (!old || row.odds > old.odds) bestBySelection.set(k,row);
            }
            rows.push(...bestBySelection.values());
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            scanDiagnostics.push({ fixture: home + ' vs ' + away, error: message, oddsError: message, oddsEvents: null, matchedEvents: null, providers: null });
          }
        }));
        return json({ rows, diagnostics: scanDiagnostics });
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
