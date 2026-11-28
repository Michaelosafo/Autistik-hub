import { json } from "@/lib/ai";
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
  superReady,
  superOddsStatus
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
      case "ready": return json({ ready: superReady(), provider: "SportMonks" });
      case "oddsStatus": return json({ sportmonks: await superOddsStatus(), fixtureProvider: "SportMonks", statisticsProvider: "SportMonks", oddsProvider: "SportMonks" });
      case "search": return json({ teams: await searchSportMonksTeams(String(b.q || "")) });
      case "leagues": return json({ leagues: await getSportMonksLeagueCatalogue(), provider: "SportMonks" });
      case "dailyFixtures": {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const requested = String(b.date || today).trim();
        if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(requested) || Number.isNaN(Date.parse(requested + "T00:00:00Z"))) return json({ error: "Choose a valid date." }, 400);
        const rangeEnd = requested === today ? new Date(Date.parse(requested + "T00:00:00Z") + 6 * 86400_000).toISOString().slice(0, 10) : requested;
        const slate = await getSportMonksLeagueUpcomingFixtures("", "", undefined);
        const matches = (slate.fixtures || []).filter((f: any) => {
          const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(f.date));
          return day >= requested && day <= rangeEnd && f.status === "SCHEDULED";
        }).sort((a: any, b: any) => Date.parse(a.date) - Date.parse(b.date));
        return json({ date: requested, today, rangeEnd, matches, fixtureProvider: "SportMonks", statisticsProvider: "SportMonks", oddsProvider: "SportMonks", fixtureCount: matches.length, retrospective: false });
      }
      case "leagueFixtures": {
        const result = await getSportMonksLeagueUpcomingFixtures(String(b.leagueCode || ""), String(b.leagueName || ""), Number(b.leagueId) || undefined);
        return json(result);
      }
      case "todayMatches": {
        const matches = await todayCompetitionMatches();
        return json({ matches, fixtureProvider: "SportMonks", fixtureCount: matches.length });
      }
      case "dateMatches": {
        const matches = await sportMonksMatchesOnDate(String(b.date || ""));
        return json({ matches, fixtureProvider: "SportMonks", importedCount: matches.length });
      }
      case "teamFixtures": {
        const teamName = String(b.teamName || "").trim();
        if (!teamName) return json({ error: "Choose a valid team." }, 400);
        return json({ fixtures: await teamFixtureChoicesByName(teamName), fixtureProvider: "SportMonks" });
      }
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures.slice(0, 20) : [];
        const rows: any[] = [];
        const diagnostics: any[] = [];
        const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9.+-]+/g, " ").trim().replace(/\\s+/g, " ");
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
        await Promise.all(fixtures.map(async (f: any) => {
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          const fixtureId = Number(f?.id);
          const kickoff = Date.parse(String(f?.date || ""));
          const status = String(f?.status || "").trim().toUpperCase();
          if (!home || !away || !Number.isInteger(fixtureId) || fixtureId <= 0 || !Number(f?.home?.id) || !Number(f?.away?.id) || !Number.isFinite(kickoff) || kickoff <= Date.now() || (status && status !== "SCHEDULED")) {
            diagnostics.push({ fixture: home + " vs " + away, error: "Skipped: fixture is not an upcoming SportMonks scheduled match." });
            return;
          }
          const date = new Date(kickoff).toISOString().slice(0, 10);
          try {
            const [analysis, odds] = await Promise.all([
              withTimeout(analyseSportMonks(Number(f.home.id), Number(f.away.id), date), "SportMonks team analysis"),
              withTimeout(getSuperMatchOdds(fixtureId, home, away, date), "SportMonks pre-match odds")
            ]);
            const modelMarkets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
            const events = Array.isArray(odds?.matched) ? odds.matched : [];
            const mapped: any[] = [];
            for (const event of events) for (const book of (event.bookmakers || [])) {
              const ghanaBook = ghanaBookmaker(book.title || book.key);
              if (!ghanaBook) continue;
              for (const market of (book.markets || [])) {
                if (!["h2h", "totals", "asian_handicap"].includes(String(market.key)) || !Array.isArray(market.outcomes)) continue;
                const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
                if (valid.length < 2) continue;
                const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
                for (const outcome of valid) {
                  const label = String(outcome.name || "");
                  const n = norm(label);
                  let modelName = "";
                  if (market.key === "h2h") {
                    if (n === norm(home) || n === "home" || n === "1") modelName = "Home win (1)";
                    else if (n === norm(away) || n === "away" || n === "2") modelName = "Away win (2)";
                    else continue;
                  } else if (market.key === "totals") {
                    const m = label.match(/\\b(over|under)\\s+(\\d+(?:\\.\\d+)?)\\b/i);
                    if (!m) continue;
                    modelName = (m[1].toLowerCase() === "under" ? "Under " : "Over ") + Number(m[2]) + " goals";
                  } else if (market.key === "asian_handicap") {
                    const m = label.match(/(home|away|1|2)\\s*([+-]\\d+(?:\\.5)?)/i);
                    if (!m) continue;
                    const side = /^(home|1)$/i.test(m[1]) ? "Home" : "Away";
                    const handicap = Number(m[2]);
                    if (!Number.isFinite(handicap) || Math.abs(handicap % 1) !== 0.5) continue;
                    modelName = handicap < 0
                      ? side + " " + handicap + " handicap (win by " + (Math.abs(handicap) + 0.5) + "+)"
                      : side + " +" + handicap + " handicap (lose by " + (handicap - 0.5) + " at most)";
                  }
                  let pick = modelMarkets.find((x: any) => norm(x.name) === norm(modelName));
                  if (market.key === "totals") {
                    const m = label.match(/\\b(over|under)\\s+(\\d+(?:\\.\\d+)?)\\b/i);
                    const overP = m ? Number(analysis?.model?.over?.[String(Number(m[2]))]) : NaN;
                    if (m && Number.isFinite(overP)) pick = { name: modelName, p: m[1].toLowerCase() === "under" ? 100 - overP : overP };
                  }
                  const price = Number(outcome.price), implied = 100 / price, noVig = implied / overround * 100;
                  const probability = Number(pick?.p);
                  if (!modelName || !Number.isFinite(probability) || probability <= 0) continue;
                  const ev = (probability / 100) * price * 100 - 100;
                  mapped.push({ key: String(fixtureId) + market.key + label + String(book.key), modelProvider: "SportMonks", date: f.date, competition: f.competition || "Football", home, away, selection: label, market: market.title || String(market.key), probability, fairOdds: 100 / probability, odds: price, bookmaker: ghanaBook, implied, noVig, edge: probability - noVig, ev, value: ev > 0, modelSupported: true });
                }
              }
            }
            const best = new Map<string, any>();
            for (const row of mapped) {
              const key = row.market + "|" + row.selection + "|" + row.bookmaker;
              const old = best.get(key);
              if (!old || row.odds > old.odds) best.set(key, row);
            }
            rows.push(...best.values());
            diagnostics.push({ fixture: home + " vs " + away, provider: "SportMonks fixtures/statistics/odds", analysis: true, oddsEvents: Number(odds?.diagnostics?.eventsReturned ?? odds?.count ?? 0), matchedEvents: events.length, returnedBookmakers: odds?.availableBookmakers || [], bookmakers: [...new Set((odds?.availableBookmakers || []).map((name: string) => ghanaBookmaker(name)).filter(Boolean))], markets: [...new Set(mapped.map((x: any) => x.market))], error: mapped.length ? null : (events.length ? "SportMonks returned odds, but no Ghana bookmaker prices matched supported straight-win, totals or Asian-handicap markets." : "SportMonks returned no pre-match odds for this fixture.") });
          } catch (error) {
            diagnostics.push({ fixture: home + " vs " + away, provider: "SportMonks", error: error instanceof Error ? error.message : String(error) });
          }
        }));
        return json({ rows, diagnostics, providers: { fixtures: "SportMonks", statistics: "SportMonks", odds: "SportMonks" } });
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
        const r = await analyseSportMonks(h, a, typeof b.matchDate === "string" ? b.matchDate : undefined);
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
