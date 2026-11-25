/** Ghana football odds from OddsRelay's raw feed.
 * The standard matched board is UK & Ireland only; international regions,
 * including Ghana, must use /v2/odds/raw.
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

  // Ghana's raw board returns the bookmaker markets available for each event.
  // Do not send a hard-coded market list: this can exclude provider-specific markets
  // or trigger market_not_in_plan for accounts with narrower market scope.

  const from = new Date(day.getTime() - 6 * 3600_000).toISOString();
  const to = new Date(day.getTime() + 36 * 3600_000).toISOString();
  const allEvents = new Map<string, any>();
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const url = new URL("https://api.oddsrelay.io/v2/odds/raw");
    url.searchParams.set("region", "gh");
    url.searchParams.set("sports", "soccer");
    url.searchParams.set("commenceTimeFrom", from);
    url.searchParams.set("commenceTimeTo", to);
    if (cursor) url.searchParams.set("cursor", cursor);
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

  const events: OddsEvent[] = [...allEvents.values()].map((event: any) => ({
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
