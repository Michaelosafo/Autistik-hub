/** Server-side OddsRelay Ghana football odds. Use the standard matched feed:
 * the raw feed is beta-gated and may return 503 raw_not_enabled for ordinary keys.
 * Normalize standard back offers into the per-bookmaker shape consumed by valueScan.
 */
export type OddsEvent = {
  id: string; sport_title?: string; commence_time: string; home_team: string; away_team: string;
  bookmakers: { key: string; title: string; last_update?: string; markets: { key: string; last_update?: string; outcomes: { name: string; price: number }[] }[] }[];
};

export async function getGhanaMatchOdds(home: string, away: string, matchDate?: string) {
  const key = process.env.ODDSRELAY_API_KEY || process.env.ODDSRELAY_KEY;
  if (!key) throw new Error("OddsRelay API key is missing. Set ODDSRELAY_API_KEY (or ODDSRELAY_KEY) in Vercel.");
  const day = matchDate ? new Date(matchDate + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(day.getTime())) throw new Error("Invalid match date.");
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const isHistorical = day.getTime() < today.getTime();
  const url = new URL(isHistorical
    ? "https://api.oddsrelay.io/v2/historical/odds/standard"
    : "https://api.oddsrelay.io/v2/odds/standard");
  url.searchParams.set("region", "gh");
  url.searchParams.set("sports", "soccer");

  // Discover the market keys supported by the standard board (not raw, which is beta-gated).
  let marketKeys = ["h2h", "totals", "btts"];
  try {
    const coverageResponse = await fetch("https://api.oddsrelay.io/v2/coverage?region=gh", { cache: "no-store" });
    if (coverageResponse.ok) {
      const coverage: any = await coverageResponse.json();
      const rawMarkets = coverage?.markets?.standard || coverage?.data?.markets?.standard || [];
      const discovered = Array.isArray(rawMarkets)
        ? rawMarkets.map((m: any) => typeof m === "string" ? m : String(m?.key || m?.name || "")).filter(Boolean)
        : [];
      if (discovered.length) marketKeys = [...new Set([...marketKeys, ...discovered])].slice(0, 20);
    }
  } catch {
    // Keep core markets when public discovery is temporarily unavailable.
  }
  url.searchParams.set("markets", marketKeys.join(","));
  if (isHistorical) {
    url.searchParams.set("date", matchDate + "T12:00:00Z");
  } else {
    url.searchParams.set("commenceTimeFrom", new Date(day.getTime() - 6 * 3600_000).toISOString());
    url.searchParams.set("commenceTimeTo", new Date(day.getTime() + 36 * 3600_000).toISOString());
  }

  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + key, "Accept-Encoding": "gzip" },
    cache: "no-store"
  });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code || response.status;
    const message = body?.error?.message || response.statusText || "OddsRelay request failed";
    throw new Error(`OddsRelay standard (${code}): ${String(message).slice(0, 180)}`);
  }

  const sourceEvents: any[] = Array.isArray(body?.data) ? body.data : [];
  const events: OddsEvent[] = sourceEvents.map((event: any) => {
    const books = new Map<string, any>();
    for (const market of event.markets || []) for (const outcome of market.outcomes || []) {
      for (const offer of outcome.back || []) {
        const bookKey = String(offer.bookmaker || "unknown");
        if (!books.has(bookKey)) books.set(bookKey, {
          key: bookKey, title: bookKey.replace(/[_-]+/g, " "),
          last_update: offer.last_update, markets: []
        });
        const book = books.get(bookKey);
        let bookMarket = book.markets.find((m: any) => m.key === market.key);
        if (!bookMarket) {
          bookMarket = { key: market.key, last_update: offer.last_update, outcomes: [] };
          book.markets.push(bookMarket);
        }
        bookMarket.outcomes.push({ name: String(outcome.name || ""), price: Number(offer.price) });
      }
    }
    return {
      id: String(event.event_id || event.id || ""),
      sport_title: event.sport_title,
      commence_time: event.commence_time,
      home_team: String(event.home_team || ""),
      away_team: String(event.away_team || ""),
      bookmakers: [...books.values()]
    };
  });

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
      [/\bbayern munich\b/g, "bayern"]
    ];
    for (const [pattern, value] of substitutions) if (pattern.test(n)) variants.push(n.replace(pattern, value));
    return [...new Set(variants.filter(Boolean))];
  };
  const matchesName = (source: string, requested: string) => {
    const src = norm(source);
    return aliases(requested).some(a => src === a || src.includes(a) || a.includes(src));
  };
  const matched = events.filter(e => matchesName(e.home_team, home) && matchesName(e.away_team, away));
  return {
    region: body?.meta?.region || "gh",
    processedAt: body?.meta?.processed_at || null,
    count: Number(body?.meta?.count ?? events.length),
    historical: isHistorical,
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
