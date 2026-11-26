/**
 * 5DollarFootballAPI odds adapter for the SPORT value-bet scanner.
 * Uses the per-fixture odds endpoint so it works on Free/Pro keys (Bet365),
 * and requests all listed bookmakers only when the account is on Ultra.
 */
const BASE = "https://api.5dollarfootballapi.com/v1";
const cache = new Map<string, { expiresAt: number; value: any }>();

function cleanName(value: string) {
  return String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    // Normalize common naming differences in South American and European feeds.
    .replace(/\\b(clube do|clube de|club de|club del|club da|football club|fc|afc|cf|sc|club)\\b/g, " ")
    .replace(/\\b(do|da|de|del|the)\\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\\s+/g, " ");
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

export async function getFiveDollarFootballMatchOdds(home: string, away: string, kickoff?: string) {
  if (!home || !away) throw new Error("Both team names are required for 5DollarFootballAPI odds lookup.");
  const target = kickoff && Number.isFinite(Date.parse(kickoff)) ? Date.parse(kickoff) : Date.now();
  // The provider limits /fixtures windows to 24 hours. Centre the window on kickoff.
  const start = Math.floor((target - 12 * 60 * 60_000) / 1000);
  const end = Math.floor((target + 12 * 60 * 60_000) / 1000);
  const query = "?start_time=" + start + "&end_time=" + end + "&status=all&per_page=100";
  const fixtures = await api("/fixtures" + query, 90_000);
  const list = Array.isArray(fixtures) ? fixtures : Array.isArray(fixtures?.data) ? fixtures.data : [];
  const h = cleanName(home), a = cleanName(away);
  const candidates = list.map((fixture: any) => {
    const fh = cleanName(fixture?.teams?.home?.name || "");
    const fa = cleanName(fixture?.teams?.away?.name || "");
    const kickoffMs = Date.parse(fixture?.kickoff_utc || "");
    const sameTeams = fh === h && fa === a;
    const distance = Number.isFinite(kickoffMs) ? Math.abs(kickoffMs - target) : Number.MAX_SAFE_INTEGER;
    return { fixture, sameTeams, distance };
  }).filter((x: any) => x.sameTeams && x.distance <= 18 * 60 * 60_000)
    .sort((x: any, y: any) => x.distance - y.distance);

  if (!candidates.length) {
    const nearby = list.slice(0, 12).map((x: any) => String(x?.teams?.home?.name || "") + " vs " + String(x?.teams?.away?.name || "")).filter((x: string) => x !== " vs ");
    throw new Error("5DollarFootballAPI returned " + list.length + " fixtures in the kickoff window but no team match for " + home + " vs " + away + ". Sample provider fixtures: " + nearby.slice(0, 6).join("; "));
  }
  const fixture = candidates[0].fixture;
  const status = await getFiveDollarFootballStatus();
  let oddsPath = "/fixtures/" + encodeURIComponent(String(fixture.id)) + "/odds";
  if (String(status.plan || "").toLowerCase() === "ultra") {
    try {
      const books = await api("/bookmakers", 6 * 60 * 60_000);
      const slugs = (Array.isArray(books) ? books : []).map((book: any) => String(book?.slug || "")).filter(Boolean);
      if (slugs.length) oddsPath += "?bookmakers=" + encodeURIComponent(slugs.join(","));
    } catch { /* Bet365 default remains a safe fallback. */ }
  }
  const oddsData = await api(oddsPath, 30_000);
  const bookmakerRows = Array.isArray(oddsData?.bookmakers) ? oddsData.bookmakers : [];
  const bookmakers = bookmakerRows.map((book: any) => {
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

    const fixedLines = Array.isArray(odds.goal_line_fixed) ? odds.goal_line_fixed : [];
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
    const mainGoalLine = latest(odds.goal_line);
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
      eventsReturned: list.length,
      matchedEvents: bookmakers.length ? 1 : 0,
      fixtureId: fixture.id,
      plan: status.plan || "unknown",
      bookmakers: bookmakers.map((book: any) => book.title),
      markets,
      providers: { fivedollarfootball: { ok: true, matched: bookmakers.length ? 1 : 0, bookmakers: bookmakers.length, markets, plan: status.plan || "unknown" } }
    }
  };
}
