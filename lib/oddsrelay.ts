/** Server-side OddsRelay Ghana raw football odds. Never expose the API key to the client. */
export type OddsEvent = {
  id: string; sport_title?: string; commence_time: string; home_team: string; away_team: string;
  bookmakers: { key: string; title: string; last_update?: string; markets: { key: string; last_update?: string; outcomes: { name: string; price: number }[] }[] }[];
};
export async function getGhanaMatchOdds(home: string, away: string, matchDate?: string) {
  const key = process.env.ODDSRELAY_API_KEY;
  if (!key) throw new Error("ODDSRELAY_API_KEY is missing in the server environment.");
  const day = matchDate ? new Date(matchDate + "T00:00:00.000Z") : new Date();
  if (Number.isNaN(day.getTime())) throw new Error("Invalid match date.");
  const isHistorical = day.getTime() < new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
  const url = new URL(isHistorical
    ? "https://api.oddsrelay.io/v2/historical/odds/raw"
    : "https://api.oddsrelay.io/v2/odds/raw");
  url.searchParams.set("region", "gh");
  url.searchParams.set("sports", "soccer");
  url.searchParams.set("markets", "h2h,totals,btts");
  if (isHistorical) {
    // Historical raw feed is a point-in-time snapshot; live raw feed cannot return past fixtures.
    // Use a pre-kickoff midday UTC snapshot for the selected match date.
    url.searchParams.set("date", matchDate + "T12:00:00Z");
  } else {
    const from = new Date(day.getTime() - 6 * 3600_000).toISOString();
    const to = new Date(day.getTime() + 36 * 3600_000).toISOString();
    url.searchParams.set("commenceTimeFrom", from);
    url.searchParams.set("commenceTimeTo", to);
  }
  const response = await fetch(url, { headers: { Authorization: "Bearer " + key, "Accept-Encoding": "gzip" }, cache: "no-store" });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code || response.status;
    const message = body?.error?.message || response.statusText || "OddsRelay request failed";
    throw new Error(`OddsRelay (${code}): ${String(message).slice(0, 180)}`);
  }
  const events: OddsEvent[] = Array.isArray(body?.data) ? body.data : [];
  const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD")
    .replace(/\\b(football club|fc|afc)\\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\\s+/g, " ");
  const aliases = (s: string) => {
    const n = norm(s);
    if (n.includes("tottenham")) return ["tottenham", "tottenham hotspur", "spurs"];
    if (n.includes("ipswich")) return ["ipswich", "ipswich town"];
    if (n.includes("leeds")) return ["leeds", "leeds united"];
    return [n];
  };
  const matchesName = (source: string, requested: string) => {
    const src = norm(source);
    return aliases(requested).some(a => src === a || src.includes(a) || a.includes(src));
  };
  const exact = events.filter(e => matchesName(e.home_team, home) && matchesName(e.away_team, away));
  const matched = exact.length ? exact : events.filter(e =>
    matchesName(e.home_team, home) && matchesName(e.away_team, away)
  );
  return {
    region: body?.meta?.region || "gh",
    processedAt: body?.meta?.processed_at || null,
    count: Number(body?.meta?.count ?? events.length),
    historical: isHistorical,
    matched: matched.slice(0, 5),
    availableBookmakers: [...new Set(events.flatMap(e => (e.bookmakers || []).map(b => b.title || b.key)))].sort(),
  };
}
