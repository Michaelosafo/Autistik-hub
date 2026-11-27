import { json } from "@/lib/ai";
import { getFiveDollarFootballMatchOdds, getFiveDollarFootballStatus } from "@/lib/fivedollarfootball";
import { analyse as analyseApiFootball, searchTeams as searchApiFootballTeams, matchesOnDate as apiFootballMatchesOnDate, leagueCatalogue as apiFootballLeagueCatalogue, leagueUpcomingFixtures as apiFootballLeagueUpcomingFixtures, teamFixtureChoices as apiFootballTeamFixtureChoices, sportReady as apiFootballReady } from "@/lib/sport";
import { adminState } from "@/lib/admin";
import {
  analyse as analyseSportMonks,
  getSportMonksLeagueCatalogue,
  getSportMonksLeagueUpcomingFixtures,
  matchesOnDate as sportMonksMatchesOnDate,
  searchTeams as searchSportMonksTeams,
  teamFixtureChoicesByName,
  todayCompetitionMatches,
  getSuperMatchOdds,
  getSuperMatchOddsForTeams,
  saveOdds,
  savePrediction,
  history,
  setResult,
  superReady
} from "@/lib/super-sportmonks-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function withTimeout<T>(task: Promise<T>, label: string, timeoutMs = 25000): Promise<T> {
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
      case "ready": return json({ ready: apiFootballReady(), provider: "API-Football" });
      case "oddsStatus": return json({
        apiFootball: { active: apiFootballReady(), provider: "API-Football", error: apiFootballReady() ? null : "APIFOOTBALL_KEY is missing in Vercel Production." },
        fixtureProvider: "API-Football", statisticsProvider: "API-Football", oddsProvider: "5DollarFootballAPI",
        fiveDollarFootball: await getFiveDollarFootballStatus()
      });
      case "search": return json({ teams: await searchApiFootballTeams(String(b.q || "")) });
      case "leagues": return json({ leagues: await apiFootballLeagueCatalogue(), provider: "API-Football" });
      case "dailyFixtures": {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const requested = String(b.date || today).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(Date.parse(requested + "T00:00:00Z"))) return json({ error: "Choose a valid date." }, 400);
        const matches = await apiFootballMatchesOnDate(requested);
        return json({ date: requested, today, matches, fixtureProvider: "API-Football", statisticsProvider: "API-Football", oddsProvider: "5DollarFootballAPI", fixtureCount: matches.length, retrospective: requested < today });
      }
      case "leagueFixtures": {
        const leagueId = Number(b.leagueId), season = Number(b.season);
        const fixtures = await apiFootballLeagueUpcomingFixtures(leagueId, season, 30);
        return json({ fixtures, clubs: [], fixtureProvider: "API-Football", statisticsProvider: "API-Football" });
      }
      case "todayMatches": {
        const matches = await todayCompetitionMatches();
        return json({ matches, fixtureProvider: "SportMonks", fixtureCount: matches.length });
      }
      case "dateMatches": {
        const matches = await apiFootballMatchesOnDate(String(b.date || ""));
        return json({ matches, fixtureProvider: "API-Football", importedCount: matches.length });
      }
      case "teamFixtures": {
        const teamName = String(b.teamName || "").trim();
        if (!teamName) return json({ error: "Choose a valid team." }, 400);
        return json({ fixtures: await apiFootballTeamFixtureChoices(Number(b.teamId)), fixtureProvider: "API-Football" });
      }
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures : [];
        const rows: any[] = [];
        const diagnostics: any[] = [];
        await Promise.all(fixtures.map(async (f: any) => {
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          const fixtureId = Number(f?.id);
          if (!home || !away || !Number.isInteger(fixtureId) || fixtureId <= 0 || !f?.date) return;
          const kickoff = Date.parse(String(f.date));
          const status = String(f?.status || "").trim().toUpperCase();
          const upcomingStatus = !status || ["NS", "TBD", "SCHEDULED", "TIMED", "NOT STARTED", "TIME TO BE DEFINED"].includes(status);
          // Enforce pre-match eligibility on the server too: stale clients or cached
          // fixtures must never generate a value bet after kickoff.
          if (!Number.isFinite(kickoff) || kickoff <= Date.now() || !upcomingStatus) {
            diagnostics.push({ fixture: home + " vs " + away, error: "Skipped: fixture has started, finished, or is not scheduled." });
            return;
          }
          try {
            const date = new Date(String(f.date)).toISOString().slice(0, 10);
            const [analysis, odds] = await Promise.all([
              withTimeout(analyseApiFootball(Number(f.home.id), Number(f.away.id)), "API-Football analysis"),
              withTimeout(getFiveDollarFootballMatchOdds(home, away, String(f.date)), "5DollarFootballAPI bookmaker odds")
            ]);
            const markets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
            const events = Array.isArray(odds?.matched) ? odds.matched : [];
            const mapped: any[] = [];
            const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
            // Provider bookmaker labels can include country/region suffixes or slugs.
            // Match the Ghana operator token, not only one exact display spelling.
            const ghanaBookmaker = (name: any) => {
              const compact = norm(name).replace(/[^a-z0-9]/g, "");
              if (compact.includes("bet365")) return "Bet365";
              if (compact.includes("sportybet")) return "SportyBet";
              if (compact.includes("betway")) return "Betway";
              if (compact.includes("1xbet")) return "1xBet";
              if (compact.includes("betpawa")) return "betPawa";
              if (compact.includes("22bet")) return "22Bet";
              if (compact.includes("premierbet")) return "Premier Bet";
              if (compact.includes("melbet")) return "MelBet";
              if (compact.includes("parimatch")) return "Parimatch";
              if (compact.includes("mybet")) return "MyBet";
              return "";
            };
            for (const event of events) for (const book of (event.bookmakers || [])) {
              const ghanaBook = ghanaBookmaker(book.title || book.key);
              if (!ghanaBook) continue;
              for (const market of (book.markets || [])) {
                // SPORT only publishes straight home/away wins, totals and supported Asian handicap markets.
                if (!["h2h", "totals", "asian_handicap"].includes(String(market.key))) continue;
                if (!Array.isArray(market.outcomes)) continue;
                const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
                if (valid.length < 2) continue;
                const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
                for (const outcome of valid) {
                  const label = String(outcome.name || "");
                  const n = norm(label);
                  let modelName = "";
                  if (market.key === "h2h") modelName = ["home", norm(home)].includes(n) ? "Home win (1)" : ["away", norm(away)].includes(n) ? "Away win (2)" : ["draw","the draw","tie"].includes(n) ? "Draw (X)" : "";
                  else if (market.key === "double_chance") modelName = ["1x","homedraw","homeordraw"].includes(n.replace(/\s/g,"")) ? "Home or draw (1X)" : ["x2","drawaway","draworaway"].includes(n.replace(/\s/g,"")) ? "Away or draw (X2)" : ["12","homeaway","homeoraway"].includes(n.replace(/\s/g,"")) ? "Home or away (12)" : "";
                  else if (market.key === "btts") modelName = /^yes$/i.test(label) ? "Both teams score: Yes" : /^no$/i.test(label) ? "Both teams score: No" : "";
                  else if (market.key === "totals") {
                    const m = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                    if (m) modelName = (m[1].toLowerCase() === "over" ? "Over " : "Under ") + m[2] + " goals";
                  } else if (market.key === "asian_handicap") {
                    const m = label.match(/^(home|away)\s+([+-]\d+(?:\.5)?)$/i);
                    if (m && Math.abs(Number(m[2]) % 1) === 0.5) {
                      const side = m[1].toLowerCase() === "home" ? "Home" : "Away";
                      const handicap = Number(m[2]);
                      modelName = handicap < 0
                        ? side + " " + handicap + " handicap (win by " + (Math.abs(handicap) + 0.5) + "+)"
                        : side + " +" + handicap + " handicap (lose by " + (handicap - 0.5) + " at most)";
                    }
                  }
                  let pick = markets.find((x: any) => norm(x.name) === norm(modelName));
                  if (market.key === "totals") {
                    const m = label.match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
                    const p = m ? Number(analysis?.model?.over?.[String(Number(m[2]))]) : NaN;
                    if (m && Number.isFinite(p)) pick = { name: modelName, p: m[1].toLowerCase() === "over" ? p : 100 - p };
                  }
                  if (market.key === "double_chance") {
                    const p = analysis.model || {}, k = n.replace(/\s/g,"");
                    const probability = ["1x","homedraw","homeordraw"].includes(k) ? Number(p.home)+Number(p.draw)
                      : ["x2","drawaway","draworaway"].includes(k) ? Number(p.away)+Number(p.draw)
                      : ["12","homeaway","homeoraway"].includes(k) ? Number(p.home)+Number(p.away) : 0;
                    if (probability > 0) pick = { name: modelName, p: probability };
                  }
                  const price = Number(outcome.price), implied = 100 / price, noVig = implied / overround * 100;
                  // A draw is not a straight-win selection.
                  if (market.key === "h2h" && !modelName) continue;
                  const probability = Number(pick?.p);
                  const supported = !!modelName && Number.isFinite(probability) && probability > 0;
                  const ev = supported ? (probability / 100) * price * 100 - 100 : null;
                  mapped.push({
                    key: String(fixtureId)+market.key+label+String(book.key),
                    modelProvider: "API-Football", date: f.date, competition: f.competition || "Football",
                    home, away, selection: label, market: market.title || String(market.key),
                    probability: supported ? probability : null,
                    fairOdds: supported ? 100 / probability : null,
                    odds: price, bookmaker: ghanaBook,
                    implied, noVig, edge: supported ? probability - noVig : null,
                    ev, value: supported ? ev > 0 : false, modelSupported: supported
                  });
                }
              }
            }
            const best = new Map<string, any>();
            for (const row of mapped) {
              const key = row.market + "|" + row.selection;
              const old = best.get(key);
              if (!old || row.odds > old.odds) best.set(key, row);
            }
            rows.push(...best.values());
            diagnostics.push({
              fixture: home + " vs " + away, provider: "5DollarFootballAPI Ghana bookmakers",
              analysis: true, oddsEvents: Number(odds?.diagnostics?.eventsReturned ?? odds?.count ?? 0),
              matchedEvents: events.length,
              providerPlan: odds?.diagnostics?.plan || "unknown",
              returnedBookmakers: odds?.availableBookmakers || [],
              bookmakers: [...new Set((odds?.availableBookmakers || []).map((name: string) => ghanaBookmaker(name)).filter(Boolean))],
              oddsRequestError: odds?.diagnostics?.oddsRequestError || null,
              oddsMarkets: odds?.diagnostics?.markets || [],
              markets: [...new Set(mapped.map((x: any) => x.market))],
              error: mapped.length ? null : (events.length
                ? "Odds feed returned bookmakers/markets, but none matched the Ghana bookmaker filter or had a supported model market. Returned: " + ((odds?.availableBookmakers || []).join(", ") || "no named bookmakers") + ". Plan: " + (odds?.diagnostics?.plan || "unknown")
                : "5DollarFootballAPI returned no matching priced event for this fixture.")
            });
          } catch (error) {
            diagnostics.push({ fixture: home + " vs " + away, provider: "5DollarFootballAPI", error: error instanceof Error ? error.message : String(error) });
          }
        }));
        return json({ rows, diagnostics, providers: { fixtures: "API-Football", statistics: "API-Football", odds: "5DollarFootballAPI" } });
      }
      case "odds": {
        const home = String(b.homeName || "").trim(), away = String(b.awayName || "").trim();
        const date = typeof b.matchDate === "string" ? b.matchDate : "";
        if (!home || !away || !date) return json({ error: "Choose both teams and a match date." }, 400);
        return json(await getSuperMatchOddsForTeams(home, away, date));
      }
      case "analyse": {
        const h = Number(b.home), a = Number(b.away);
        if (!h || !a || h === a) return json({ error: "Pick two different teams." }, 400);
        const matchDate = typeof b.matchDate === "string" ? b.matchDate : undefined;
        const r = await analyseApiFootball(h, a);
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
