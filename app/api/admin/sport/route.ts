import { json } from "@/lib/ai";
import { adminState } from "@/lib/admin";
import { analyse, history, matchesOnDate, saveOdds, savePrediction, searchTeams, setResult, sportReady, teamFixtureChoices, todayCompetitionMatches } from "@/lib/sport-football-data";
import { getGhanaOddsRelayStatus } from "@/lib/oddsrelay";
import { getCombinedMatchOdds } from "@/lib/combined-odds";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sport board (owner only). POST { action: "ready" | "search" | "analyse" | "history" | "result" }. */
export async function POST(req: Request) {
  if (!(await adminState()).owner) return json({ error: "Not found." }, 404);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "ready": return json({ ready: sportReady() });
      case "oddsStatus": return json({ ...(await getGhanaOddsRelayStatus()), oddsPapiKeyConfigured: !!process.env.ODDSPAPI_API_KEY, providers: ["OddsPapi", "OddsRelay"] });
      case "search": return json({ teams: await searchTeams(String(b.q || "")) });
      case "todayMatches": return json({ matches: await todayCompetitionMatches() });
      case "valueScan": {
        const fixtures = Array.isArray(b.fixtures) ? b.fixtures.slice(0, 20) : [];
        const rows: any[] = [];
        const scanDiagnostics: any[] = [];
        for (const f of fixtures) {
          const homeId = Number(f?.home?.id), awayId = Number(f?.away?.id);
          const home = String(f?.home?.name || ""), away = String(f?.away?.name || "");
          if (!homeId || !awayId || homeId === awayId || !home || !away || !f?.date) continue;
          try {
            const date = new Date(String(f.date)).toISOString().slice(0, 10);
            const [analysisResult, oddsResult] = await Promise.allSettled([
              analyse(homeId, awayId, date),
              getCombinedMatchOdds(home, away, date)
            ]);
            const analysis = analysisResult.status === "fulfilled" ? analysisResult.value : null;
            if (oddsResult.status === "rejected") throw oddsResult.reason;
            const odds = oddsResult.value;
            const modelMarkets = Array.isArray(analysis?.model?.markets) ? analysis.model.markets : [];
            scanDiagnostics.push({ fixture: home + ' vs ' + away, oddsEvents: odds.diagnostics?.eventsReturned ?? odds.count ?? 0, matchedEvents: (odds.matched || []).length, bookmakers: odds.availableBookmakers || [], markets: [...new Set((odds.matched || []).flatMap((e: any) => (e.bookmakers || []).flatMap((bk: any) => (bk.markets || []).map((m: any) => m.key))))], providers: odds.diagnostics?.providers || null, analysisError: analysisResult.status === "rejected" ? (analysisResult.reason instanceof Error ? analysisResult.reason.message : String(analysisResult.reason)) : null });
            const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim().replace(/\s+/g, " ");
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
                    mapped.push({ key: String(f.id)+market.key+label+String(book.key), home, away, selection: label, market: marketTitle, probability: null, fairOdds: null, odds: price, bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge: null, ev: null, value: false, modelSupported: false });
                    continue;
                  }
                  const probability = Number(modelPick.p);
                  const fairOdds = 100 / probability;
                  const ev = (probability / 100) * price * 100 - 100;
                  const edge = probability - noVig;
                  mapped.push({ key: String(f.id)+market.key+label+String(book.key), home, away, selection: label, market: marketTitle, probability, fairOdds, odds: price, bookmaker: book.title || book.key || "Bookmaker", implied, noVig, edge, ev, value: ev > 0, modelSupported: true });
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
            scanDiagnostics.push({ fixture: home + ' vs ' + away, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return json({ rows, diagnostics: scanDiagnostics });
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
        return json(await getCombinedMatchOdds(home, away, typeof b.matchDate === "string" ? b.matchDate : undefined));
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
