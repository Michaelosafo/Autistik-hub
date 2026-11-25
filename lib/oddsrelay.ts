/** Ghana football odds from OddsRelay's raw feed.
 * The standard matched board is UK & Ireland only; international regions,
 * including Ghana, must use /v2/odds/raw.
 */
let oddsBoardCache: { day: string; events: any[] } | null = null;

export type OddsEvent = {
  id: string; sport_title?: string; commence_time: string; home_team: string; away_team: string;
  bookmakers: { key: string; title: string; last_update?: string; markets: { key: string; last_update?: string; outcomes: { name: string; price: number }[] }[] }[];
};

export async function getGhanaMatchOdds(home: string, away: string, matchDate?: string, allFixtures = false) {
  const key = process.env.ODDSRELAY_API_KEY || process.env.ODDSRELAY_KEY;
  if (!key) throw new Error("OddsRelay API key is missing. Set ODDSRELAY_API_KEY (or ODDSRELAY_KEY) in Vercel.");
  const day = matchDate ? new Date(matchDate + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(day.getTime())) throw new Error("Invalid match date.");

  // Ghana's raw board returns the bookmaker markets available for each event.
  // Do not send a hard-coded market list: this can exclude provider-specific markets
  // or trigger market_not_in_plan for accounts with narrower market scope.

  const from = new Date(day.getTime() - 6 * 3600_000).toISOString();
  const to = new Date(day.getTime() + 36 * 3600_000).toISOString();
  const allEvents = new Map<string, any>();
  const useCache = oddsBoardCache?.day === day.toISOString().slice(0, 10);
  if (useCache) for (const event of oddsBoardCache!.events) allEvents.set(String(event.id || event.event_id || ""), event);
  let cursor: string | null = null;
  for (let page = 0; !useCache && page < 4; page++) {
    const url = new URL("https://api.oddsrelay.io/v2/odds/raw");
    url.searchParams.set("region", "gh");
    url.searchParams.set("sports", "soccer");
    // Request all markets enabled for this account; unsupported markets remain unlabelled as value unless modelled.
    url.searchParams.set("commenceTimeFrom", from);
    url.searchParams.set("commenceTimeTo", to);
    if (cursor) url.searchParams.set("cursor", cursor);
    const quoteUrl = new URL(url.toString());
    quoteUrl.searchParams.set("quote", "true");
    const quoteResponse = await fetch(quoteUrl, { headers: { Authorization: "Bearer " + key }, cache: "no-store" });
    const quote: any = await quoteResponse.json().catch(() => ({}));
    if (!quoteResponse.ok) throw new Error("OddsRelay quote failed: " + String(quote?.error?.message || quote?.error?.code || quoteResponse.status));
    if (Number.isFinite(Number(quote.cost)) && Number.isFinite(Number(quote.remaining)) && Number(quote.cost) > Number(quote.remaining)) {
      throw new Error("Filtered 1X2 and double-chance odds cost " + quote.cost + " tokens, but only " + quote.remaining + " remain. No tokens were spent.");
    }
    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + key, "Accept-Encoding": "gzip" },
      cache: "no-store"
    });
    const body: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = body?.error?.code || response.status;
      const message = body?.error?.message || response.statusText || "OddsRelay request failed";
      if (code === "raw_not_enabled") {
        throw new Error("OddsRelay raw odds are not enabled for this account. Ghana is not supported by the standard feed. Ask OddsRelay support to enable the raw odds board for your API key.");
      }
      throw new Error(`OddsRelay Ghana raw (${String(code)}): ${String(message).slice(0, 180)}`);
    }
    for (const event of Array.isArray(body?.data) ? body.data : []) {
      const id = String(event.id || event.event_id || "");
      if (id) allEvents.set(id, event);
    }
    cursor = body?.meta?.next_cursor || null;
    if (!cursor) break;
  }

  const rawEvents = [...allEvents.values()];
  if (!useCache) oddsBoardCache = { day: day.toISOString().slice(0, 10), events: rawEvents };
  const events: OddsEvent[] = rawEvents.map((event: any) => ({
    id: String(event.id || event.event_id || ""),
    sport_title: event.sport_title,
    commence_time: event.commence_time,
    home_team: String(event.home_team || ""),
    away_team: String(event.away_team || ""),
    bookmakers: (event.bookmakers || []).map((book: any) => ({
      key: String(book.key || book.title || "unknown"),
      title: String(book.title || book.key || "Bookmaker"),
      last_update: book.last_update,
      markets: (book.markets || []).map((market: any) => ({
        key: String(market.key || ""),
        last_update: market.last_update,
        outcomes: (market.outcomes || []).map((outcome: any) => ({
          name: String(outcome.name || outcome.side || ""),
          price: Number(outcome.price ?? outcome.back?.[0]?.price)
        })).filter((o: any) => Number.isFinite(o.price) && o.price > 1)
      }))
    }))
  }));

  const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\b(football club|fc|afc|cf|sc|club)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  const aliases = (s: string) => {
    const n = norm(s);
    const variants = [n];
    const substitutions: [RegExp, string][] = [
      [/\bmanchester united\b/g, "man utd"], [/\bmanchester city\b/g, "man city"],
      [/\bparis saint germain\b/g, "psg"], [/\bparis sg\b/g, "psg"],
      [/\batletico madrid\b/g, "atletico"], [/\bsporting lisbon\b/g, "sporting"],
      [/\binter milan\b/g, "inter"], [/\bborussia dortmund\b/g, "dortmund"],
      [/\bca mineiro\b/g, "atletico mineiro"], [/\batletico mg\b/g, "atletico mineiro"],
      [/\bsc corinthians paulista\b/g, "corinthians"], [/\bcorinthians paulista\b/g, "corinthians"],
      [/\bsao paulo fc\b/g, "sao paulo"], [/\bpalmeiras sp\b/g, "palmeiras"],
      [/\bflamengo rj\b/g, "flamengo"], [/\bvasco da gama\b/g, "vasco"],
      [/\bbayern munich\b/g, "bayern"]
    ];
    for (const [pattern, value] of substitutions) if (pattern.test(n)) variants.push(n.replace(pattern, value));
    return [...new Set(variants.filter(Boolean))];
  };
  const canonicalTeam = (value: string) => {
    const n = norm(value);
    const aliases: Record<string, string> = {
      "ca mineiro": "atletico mineiro", "atletico mg": "atletico mineiro",
      "atletico mineiro mg": "atletico mineiro",
      "sc corinthians paulista": "corinthians", "corinthians paulista": "corinthians",
      "sao paulo fc": "sao paulo", "palmeiras sp": "palmeiras",
      "flamengo rj": "flamengo", "vasco da gama": "vasco",
      "manchester united": "man utd", "manchester city": "man city",
      "paris saint germain": "psg", "paris sg": "psg",
      "atletico madrid": "atletico", "inter milan": "inter",
      "borussia dortmund": "dortmund", "bayern munich": "bayern"
    };
    return aliases[n] || n;
  };
  const matchesName = (source: string, requested: string) => {
    const src = canonicalTeam(source);
    const req = canonicalTeam(requested);
    return !!src && !!req && (src === req || src.includes(req) || req.includes(src));
  };
  const matched = allFixtures ? events : events.filter(e => matchesName(e.home_team, home) && matchesName(e.away_team, away));
  return {
    region: "gh", product: "raw", processedAt: null,
    count: events.length, historical: false,
    matched: matched.slice(0, 5),
    diagnostics: {
      eventsReturned: events.length, matchingEvents: matched.length,
      requestedHome: home, requestedAway: away,
      sampleEvents: events.slice(0, 8).map(e => ({
        home: e.home_team, away: e.away_team,
        markets: [...new Set(e.bookmakers.flatMap(b => b.markets.map(m => m.key)))]
      }))
    },
    availableBookmakers: [...new Set(events.flatMap(e => e.bookmakers.map(b => b.title)))].sort()
  };
}

export async function getGhanaOddsRelayStatus() {
  const key = process.env.ODDSRELAY_API_KEY || process.env.ODDSRELAY_KEY;
  const authHeaders: Record<string, string> = key ? { Authorization: "Bearer " + key } : {};
  const request = async (path: string, authenticated = false) => {
    const response = await fetch("https://api.oddsrelay.io" + path, {
      headers: authenticated ? authHeaders : {},
      cache: "no-store"
    });
    const data: any = await response.json().catch(() => ({}));
    return response.ok ? { ok: true, data } : { ok: false, status: response.status, error: data?.error || data };
  };
  const [regions, publicCoverage, accountCoverage, usage] = await Promise.all([
    request("/v2/regions", true),
    request("/v2/coverage?region=gh", false),
    key ? request("/v2/coverage?region=gh", true) : Promise.resolve({ ok: false, status: 0, error: "No server key configured" }),
    key ? request("/v2/usage", true) : Promise.resolve({ ok: false, status: 0, error: "No server key configured" })
  ]);
  const regionData: any = regions.ok ? regions.data : null;
  const regionList = Array.isArray(regionData?.data) ? regionData.data : Array.isArray(regionData?.regions) ? regionData.regions : [];
  const ghRegion = regionList.find((r: any) => String(r.code || r.region || r.key || r.id).toLowerCase() === "gh") || null;
  const publicData: any = publicCoverage.ok ? publicCoverage.data : null;
  const accountData: any = accountCoverage.ok ? accountCoverage.data : null;
  const rawMarkets = publicData?.markets?.raw || publicData?.data?.markets?.raw || [];
  const publicBooks = publicData?.bookmakers || publicData?.data?.bookmakers || [];
  const accountBooks = accountData?.bookmakers || accountData?.data?.bookmakers || [];
  const soccerCoverage = Array.isArray(accountBooks)
    ? accountBooks.filter((b: any) => (b.sports || b.coverage || []).some((x: any) => String(x.sport || x.key || x).toLowerCase().includes("soccer")))
    : accountBooks;
  return {
    keyConfigured: Boolean(key),
    ghRegion,
    regionError: regions.ok ? null : regions.error,
    rawMarkets,
    publicBookmakerCount: Array.isArray(publicBooks) ? publicBooks.length : Object.keys(publicBooks || {}).length,
    publicBookmakers: publicBooks,
    accountSoccerBookmakers: soccerCoverage,
    accountCoverage: accountData,
    usage: usage.ok ? usage.data : usage.error,
    errors: {
      publicCoverage: publicCoverage.ok ? null : publicCoverage.error,
      accountCoverage: accountCoverage.ok ? null : accountCoverage.error,
      usage: usage.ok ? null : usage.error
    }
  };
}
