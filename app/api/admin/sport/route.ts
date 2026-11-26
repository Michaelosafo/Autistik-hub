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
      case "ready": return json({ ready: superReady(), provider: "SportMonks" });
      case "oddsStatus": return json({
        sportmonks: { active: superReady(), provider: "SportMonks", error: superReady() ? null : "SPORTMONKS_API_TOKEN is missing in Vercel Production." },
        fixtureProvider: "SportMonks", statisticsProvider: "SportMonks", oddsProvider: "SportMonks"
      });
      case "search": return json({ teams: await searchSportMonksTeams(String(b.q || "")) });
      case "leagues": return json({ leagues: await getSportMonksLeagueCatalogue() });
      case "leagueFixtures": {
        const leagueCode = String(b.leagueCode || "").trim().toUpperCase();
        const leagueName = String(b.leagueName || "").trim();
        if (!leagueCode) return json({ error: "Choose a valid league." }, 400);
        const leagueId = Number(b.leagueId);
        const result = await getSportMonksLeagueUpcomingFixtures(leagueCode, leagueName, Number.isInteger(leagueId) && leagueId > 0 ? leagueId : undefined);
        return json({ ...result, fixtureProvider: "SportMonks", statisticsProvider: "SportMonks" });
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
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures : [];
        const rows: any[] = [];
        const diagnostics: any[] = [];
        await Promise.all(fixtures.map(async (f: any) => {
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          const fixtureId = Number(f?.id);
          if (!home || !away || !Number.isInteger(fixtureId) || fixtureId <= 0 || !f?.date) return;
          try {
            const date = new Date(String(f.date)).toISOString().slice(0, 10);
            const [analysis, odds] = await Promise.all([
              withTimeout(analyseSportMonks(Number(f.home.id), Number(f.away.id), date), "SportMonks analysis"),
              withTimeout(getSuperMatchOdds(fixtureId, home, away, date), "SportMonks odds")
            ]);
            const markets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
            const events = Array.isArray(odds?.matched) ? odds.matched : [];
            const mapped: any[] = [];
            const norm = (v: any) => String(v || "").toLowerCase().normalize("NFKD")
              .replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9.]+/g, " ").trim().replace(/\\s+/g, " ");
            for (const event of events) for (const book of (event.bookmakers || [])) {
              if (/exchange/i.test(String(book.title || book.key || ""))) continue;
              for (const market of (book.markets || [])) {
                if (!Array.isArray(market.outcomes)) continue;
                const valid = market.outcomes.filter((o: any) => Number(o.price) > 1 && Number.isFinite(Number(o.price)));
                if (valid.length < 2) continue;
                const overround = valid.reduce((sum: number, o: any) => sum + 100 / Number(o.price), 0);
                for (const outcome of valid) {
                  const label = String(outcome.name || "");
                  const n = norm(label);
                  let modelName = "";
                  if (market.key === "h2h") modelName = n === norm(home) ? "Home win (1)" : n === norm(away) ? "Away win (2)" : ["draw","the draw","tie"].includes(n) ? "Draw (X)" : "";
                  else if (market.key === "double_chance") modelName = ["1x","homedraw","homeordraw"].includes(n.replace(/\\s/g,"")) ? "Home or draw (1X)" : ["x2","drawaway","draworaway"].includes(n.replace(/\\s/g,"")) ? "Away or draw (X2)" : ["12","homeaway","homeoraway"].includes(n.replace(/\\s/g,"")) ? "Home or away (12)" : "";
                  else if (market.key === "btts") modelName = /^yes$/i.test(label) ? "Both teams score: Yes" : /^no$/i.test(label) ? "Both teams score: No" : "";
                  else if (market.key === "totals") {
                    const m = label.match(/^(over|under)\\s+(\\d+(?:\\.\\d+)?)$/i);
                    if (m) modelName = (m[1].toLowerCase() === "over" ? "Over " : "Under ") + m[2] + " goals";
                  }
                  let pick = markets.find((x: any) => norm(x.name) === norm(modelName));
                  if (market.key === "totals") {
                    const m = label.match(/^(over|under)\\s+(\\d+(?:\\.\\d+)?)$/i);
                    const p = m ? Number(analysis?.model?.over?.[String(Number(m[2]))]) : NaN;
                    if (m && Number.isFinite(p)) pick = { name: modelName, p: m[1].toLowerCase() === "over" ? p : 100 - p };
                  }
                  if (market.key === "double_chance") {
                    const p = analysis.model || {}, k = n.replace(/\\s/g,"");
                    const probability = ["1x","homedraw","homeordraw"].includes(k) ? Number(p.home)+Number(p.draw)
                      : ["x2","drawaway","draworaway"].includes(k) ? Number(p.away)+Number(p.draw)
                      : ["12","homeaway","homeoraway"].includes(k) ? Number(p.home)+Number(p.away) : 0;
                    if (probability > 0) pick = { name: modelName, p: probability };
                  }
                  const price = Number(outcome.price), implied = 100 / price, noVig = implied / overround * 100;
                  const probability = Number(pick?.p);
                  const supported = Number.isFinite(probability) && probability > 0;
                  const ev = supported ? (probability / 100) * price * 100 - 100 : null;
                  mapped.push({
                    key: String(fixtureId)+market.key+label+String(book.key),
                    modelProvider: "SportMonks", date: f.date, competition: f.competition || "Football",
                    home, away, selection: label, market: market.title || String(market.key),
                    probability: supported ? probability : null,
                    fairOdds: supported ? 100 / probability : null,
                    odds: price, bookmaker: book.title || book.key || "Bookmaker",
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
              fixture: home + " vs " + away, provider: "SportMonks",
              analysis: true, oddsEvents: Number(odds?.diagnostics?.eventsReturned ?? odds?.count ?? 0),
              matchedEvents: events.length, bookmakers: odds?.availableBookmakers || [],
              markets: [...new Set(mapped.map((x: any) => x.market))],
              error: events.length ? null : "SportMonks returned no bookmaker odds for this fixture."
            });
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
        const r = await analyseSportMonks(h, a, matchDate);
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
