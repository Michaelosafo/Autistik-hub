/**
 * 5DollarFootballAPI odds adapter for the SPORT value-bet scanner.
 * Uses the per-fixture odds endpoint so it works on Free/Pro keys (Bet365),
 * and requests all listed bookmakers only when the account is on Ultra.
 */
const BASE = "https://api.5dollarfootballapi.com/v1";
const cache = new Map<string, { expiresAt: number; value: any }>();

function cleanName(value: string) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(clube do|clube de|club de|club del|club da|football club|fc|afc|cf|sc|club)\b/g, " ")
    .replace(/\b(do|da|de|del|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function api(path: string, ttlMs = 60_000): Promise<any> {
  const key = process.env.FIVEDOLLARFOOTBALL_API_KEY;
  if (!key) throw new Error("FIVEDOLLARFOOTBALL_API_KEY is missing in Vercel Production.");
  const cacheKey = path;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const response = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if (!response.ok || body?.success === 0) {
    const message = body?.error?.message || body?.message || response.statusText || "API request failed";
    const code = body?.error?.code ? " [" + body.error.code + "]" : "";
    throw new Error("5DollarFootballAPI (" + response.status + ")" + code + ": " + String(message).slice(0, 180));
  }
  const value = body?.data ?? body;
  cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, value });
  return value;
}

export async function getFiveDollarFootballStatus() {
  if (!process.env.FIVEDOLLARFOOTBALL_API_KEY) {
    return { keyConfigured: false, active: false, provider: "5DollarFootballAPI", error: "FIVEDOLLARFOOTBALL_API_KEY is missing in Vercel Production." };
  }
  try {
    const status = await api("/status", 60_000);
    return {
      keyConfigured: true,
      active: true,
      provider: "5DollarFootballAPI",
      plan: String(status?.plan || "unknown"),
      rateLimit: status?.limits?.rate_limit ?? null,
      rateWindowSeconds: status?.limits?.rate_window_seconds ?? null,
      requestsToday: status?.usage?.today ?? null
    };
  } catch (error) {
    return {
      keyConfigured: true,
      active: false,
      provider: "5DollarFootballAPI",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function latest(stage: any) {
  if (!stage || typeof stage !== "object") return null;
  const closing = stage.closing;
  const opening = stage.opening;
  return closing && typeof closing === "object" ? closing : opening && typeof opening === "object" ? opening : null;
}

function validPrice(value: any) {
  const n = Number(value);
  return Number.isFinite(n) && n > 1 ? n : null;
}

const fixtureBoardCache = new Map<string, { expiresAt: number; value: any[] }>();

async function apiEnvelope(path: string): Promise<any> {
  const key = process.env.FIVEDOLLARFOOTBALL_API_KEY;
  if (!key) throw new Error("FIVEDOLLARFOOTBALL_API_KEY is missing in Vercel Production.");
  const response = await fetch(BASE + path, {
    headers: { Authorization: "Bearer " + key, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000)
  });
  const raw = await response.text();
  let body: any = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  if (!response.ok || body?.success === 0) {
    const message = body?.error?.message || body?.message || response.statusText || "API request failed";
    throw new Error("5DollarFootballAPI (" + response.status + "): " + String(message).slice(0, 180));
  }
  return body;
}

/**
 * Pull every scheduled fixture from the Ultra-covered competition catalogue.
 * The provider limits each window to 24 hours, so load two adjacent windows
 * for the next 48 hours and follow its has_more pagination flag.
 */
export async function getFiveDollarFootballUpcomingFixtures() {
  const now = Date.now();
  const start = Math.floor(now / 1000);
  const end = Math.floor((now + 48 * 60 * 60_000) / 1000);
  const windows = [
    { from: start, to: start + 24 * 60 * 60 },
    { from: start + 24 * 60 * 60, to: end }
  ];
  const all = new Map<string, any>();
  let pagesFetched = 0;
  for (const window of windows) {
    for (let page = 1; page <= 20; page++) {
      const cacheKey = window.from + ":" + window.to + ":" + page;
      let body: any;
      const hit = fixtureBoardCache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        const rows = hit.value;
        for (const fixture of rows) all.set(String(fixture.id), fixture);
        pagesFetched++;
        // Cached pages still need pagination metadata, so continue from cached has_more marker.
        const meta = (rows as any).__pagination;
        if (!meta?.has_more) break;
        continue;
      }
      const query = "?start_time=" + window.from + "&end_time=" + window.to + "&status=scheduled&per_page=100&page=" + page;
      body = await apiEnvelope("/fixtures" + query);
      const rows = Array.isArray(body?.data) ? body.data : [];
      const pagination = body?.pagination || {};
      Object.defineProperty(rows, "__pagination", { value: pagination, enumerable: false });
      fixtureBoardCache.set(cacheKey, { expiresAt: Date.now() + 45_000, value: rows });
      for (const fixture of rows) all.set(String(fixture.id), fixture);
      pagesFetched++;
      if (!pagination.has_more || rows.length === 0) break;
    }
  }
  return {
    fixtures: [...all.values()].map((fixture: any) => ({
      id: String(fixture.id),
      providerFixtureId: Number(fixture.id),
      date: String(fixture.kickoff_utc || ""),
      status: String(fixture.status || "SCHEDULED").toUpperCase(),
      competition: { name: String(fixture.league?.name || "Football"), id: fixture.league?.id ?? null },
      home: { id: 0, name: String(fixture.teams?.home?.name || "") },
      away: { id: 0, name: String(fixture.teams?.away?.name || "") },
      fixtureSource: "5DollarFootballAPI"
    })).filter((fixture: any) => fixture.home.name && fixture.away.name && fixture.date),
    diagnostics: { pagesFetched, fixturesReturned: all.size, windows: 2, source: "5DollarFootballAPI Ultra" }
  };
}

export async function getFiveDollarFootballMatchOdds(home: string, away: string, kickoff?: string, providerFixtureId?: number) {
  if (!home || !away) throw new Error("Both team names are required for 5DollarFootballAPI odds lookup.");
  const target = kickoff && Number.isFinite(Date.parse(kickoff)) ? Date.parse(kickoff) : Date.now();
  // The provider limits /fixtures windows to 24 hours. Centre the window on kickoff.
  const start = Math.floor((target - 12 * 60 * 60_000) / 1000);
  const end = Math.floor((target + 12 * 60 * 60_000) / 1000);
  let fixture: any = null;
  let eventsReturned = 0;
  if (providerFixtureId && Number.isFinite(providerFixtureId)) {
    fixture = {
      id: providerFixtureId,
      kickoff_utc: kickoff || "",
      teams: { home: { name: home }, away: { name: away } }
    };
  } else {
    // Provider fixture windows are capped at 24 hours; paginate to find the exact event.
    const startTime = Math.floor((target - 12 * 60 * 60_000) / 1000);
    const endTime = Math.floor((target + 12 * 60 * 60_000) / 1000);
    const h = cleanName(home), a = cleanName(away);
    let found: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const query = "?start_time=" + startTime + "&end_time=" + endTime + "&status=all&per_page=100&page=" + page;
      const body = await apiEnvelope("/fixtures" + query);
      const list = Array.isArray(body?.data) ? body.data : [];
      eventsReturned += list.length;
      found.push(...list.filter((item: any) =>
        cleanName(item?.teams?.home?.name || "") === h &&
        cleanName(item?.teams?.away?.name || "") === a
      ));
      if (!body?.pagination?.has_more || list.length === 0) break;
    }
    found.sort((x: any, y: any) => Math.abs(Date.parse(x.kickoff_utc || "") - target) - Math.abs(Date.parse(y.kickoff_utc || "") - target));
    fixture = found[0] || null;
    if (!fixture) throw new Error("5DollarFootballAPI searched " + eventsReturned + " fixtures across paginated results but did not find " + home + " vs " + away + ".");
  }
  const status = await getFiveDollarFootballStatus();
  const baseOddsPath = "/fixtures/" + encodeURIComponent(String(fixture.id)) + "/odds";
  let requestedBookmakers: string[] = [];
  let oddsData: any = null;
  let oddsRequestError: string | null = null;
  if (String(status.plan || "").toLowerCase() === "ultra") {
    try {
      const books = await api("/bookmakers", 6 * 60 * 60_000);
      requestedBookmakers = (Array.isArray(books) ? books : [])
        .map((book: any) => String(book?.slug || "").trim())
        .filter(Boolean);
    } catch (error) {
      oddsRequestError = "Bookmaker catalogue: " + (error instanceof Error ? error.message : String(error));
    }
  }
  // Request the subscribed Ultra bookmaker set first. If it is rejected or returns
  // no quoted books, retry the documented default Bet365 response rather than
  // treating a bookmaker-list issue as a fixture with no odds.
  if (requestedBookmakers.length) {
    try {
      oddsData = await api(baseOddsPath + "?bookmakers=" + encodeURIComponent(requestedBookmakers.join(",")), 20_000);
    } catch (error) {
      oddsRequestError = "Ultra bookmaker request: " + (error instanceof Error ? error.message : String(error));
    }
  }
  if (!oddsData || !Array.isArray(oddsData?.bookmakers) || oddsData.bookmakers.length === 0) {
    try {
      oddsData = await api(baseOddsPath, 20_000);
    } catch (error) {
      const fallbackError = error instanceof Error ? error.message : String(error);
      throw new Error((oddsRequestError ? oddsRequestError + " | " : "") + "Default Bet365 odds request: " + fallbackError);
    }
  }
  // The documented endpoint returns data.bookmakers[].odds. Also accept a
  // single-bookmaker data.odds shape so minor response-envelope differences
  // cannot silently turn valid prices into an empty odds board.
  let bookmakerRows: any[] = Array.isArray(oddsData?.bookmakers) ? oddsData.bookmakers : [];
  if (!bookmakerRows.length && oddsData?.odds && typeof oddsData.odds === "object") {
    bookmakerRows = [{ name: "Bet 365", slug: "bet365", odds: oddsData.odds }];
  }
  const parseBookmakers = (rows: any[]) => rows.map((book: any) => {
    const markets: any[] = [];
    const odds = book?.odds || {};
    const oneXTwo = latest(odds["1x2"]);
    if (oneXTwo) {
      const outcomes = [
        { name: String(fixture.teams.home.name), price: validPrice(oneXTwo.home) },
        { name: "Draw", price: validPrice(oneXTwo.draw) },
        { name: String(fixture.teams.away.name), price: validPrice(oneXTwo.away) }
      ].filter((x: any) => x.price);
      if (outcomes.length >= 2) markets.push({ key: "h2h", outcomes });
    }

    const fixedLines = Array.isArray(odds.goal_line_fixed) ? odds.goal_line_fixed : Array.isArray(odds.goalline_fixed) ? odds.goalline_fixed : [];
    const seenGoalLines = new Set<string>();
    for (const line of fixedLines) {
      const stage = latest(line);
      if (!stage) continue;
      const lineValue = Number(line.line);
      if (!Number.isFinite(lineValue)) continue;
      const outcomes = [
        { name: "Over " + lineValue, price: validPrice(stage.over) },
        { name: "Under " + lineValue, price: validPrice(stage.under) }
      ].filter((x: any) => x.price);
      if (outcomes.length) {
        markets.push({ key: "totals", outcomes });
        seenGoalLines.add(String(lineValue));
      }
    }
    const mainGoalLine = latest(odds.goal_line || odds.goalline);
    if (mainGoalLine && Number.isFinite(Number(mainGoalLine.line))) {
      const lineValue = Number(mainGoalLine.line);
      if (!seenGoalLines.has(String(lineValue))) {
        const outcomes = [
          { name: "Over " + lineValue, price: validPrice(mainGoalLine.over) },
          { name: "Under " + lineValue, price: validPrice(mainGoalLine.under) }
        ].filter((x: any) => x.price);
        if (outcomes.length) markets.push({ key: "totals", outcomes });
      }
    }

    const btts = latest(odds.btts);
    if (btts) {
      const outcomes = [
        { name: "Yes", price: validPrice(btts.yes) },
        { name: "No", price: validPrice(btts.no) }
      ].filter((x: any) => x.price);
      if (outcomes.length) markets.push({ key: "btts", outcomes });
    }
    return {
      key: String(book?.slug || book?.name || "5dollarfootball"),
      title: String(book?.name || book?.slug || "5DollarFootballAPI"),
      last_update: null,
      markets
    };
  }).filter((book: any) => book.markets.length);
  let bookmakers = parseBookmakers(bookmakerRows);
  // A multi-book Ultra response can contain bookmaker shells without prices.
  // Retry the documented default Bet365 endpoint before declaring no odds.
  if (!bookmakers.length && requestedBookmakers.length) {
    try {
      const defaultOdds = await api(baseOddsPath, 20_000);
      const defaultRows: any[] = Array.isArray(defaultOdds?.bookmakers) ? defaultOdds.bookmakers : [];
      if (defaultRows.length) {
        oddsData = defaultOdds;
        bookmakerRows = defaultRows;
      } else if (defaultOdds?.odds && typeof defaultOdds.odds === "object") {
        oddsData = defaultOdds;
        bookmakerRows = [{ name: "Bet 365", slug: "bet365", odds: defaultOdds.odds }];
      }
      bookmakers = parseBookmakers(bookmakerRows);
    } catch (error) {
      oddsRequestError = (oddsRequestError ? oddsRequestError + " | " : "") +
        "Bet365 fallback: " + (error instanceof Error ? error.message : String(error));
    }
  }

  const event = {
    id: String(fixture.id),
    home_team: String(fixture.teams.home.name),
    away_team: String(fixture.teams.away.name),
    commence_time: String(fixture.kickoff_utc || kickoff || ""),
    bookmakers
  };
  const markets = [...new Set(bookmakers.flatMap((book: any) => book.markets.map((market: any) => market.key)))];
  return {
    matched: bookmakers.length ? [event] : [],
    count: bookmakers.length ? 1 : 0,
    availableBookmakers: bookmakers.map((book: any) => book.title),
    diagnostics: {
      provider: "5DollarFootballAPI",
      eventsReturned: eventsReturned,
      matchedEvents: bookmakers.length ? 1 : 0,
      fixtureId: fixture.id,
      plan: status.plan || "unknown",
      requestedBookmakers: requestedBookmakers.length,
      returnedBookmakers: bookmakerRows.length,
      oddsRequestError,
      oddsPayloadKeys: Object.keys(oddsData || {}),
      emptyOddsReason: bookmakers.length ? null : "The fixture odds endpoint returned no supported priced markets for the requested/default bookmakers.",
      bookmakers: bookmakers.map((book: any) => book.title),
      markets,
      providers: { fivedollarfootball: { ok: true, matched: bookmakers.length ? 1 : 0, bookmakers: bookmakers.length, markets, plan: status.plan || "unknown" } }
    }
  };
}
