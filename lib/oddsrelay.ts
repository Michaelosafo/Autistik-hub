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
  const from = new Date(day.getTime() - 6 * 3600_000).toISOString();
  const to = new Date(day.getTime() + 36 * 3600_000).toISOString();
  const url = new URL("https://api.oddsrelay.io/v2/odds/raw");
  url.searchParams.set("region", "gh");
  url.searchParams.set("sports", "soccer");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("commenceTimeFrom", from);
  url.searchParams.set("commenceTimeTo", to);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + key, "Accept-Encoding": "gzip" }, cache: "no-store" });
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code || response.status;
    const message = body?.error?.message || response.statusText || "OddsRelay request failed";
    throw new Error(`OddsRelay (${code}): ${String(message).slice(0, 180)}`);
  }
  const events: OddsEvent[] = Array.isArray(body?.data) ? body.data : [];
  const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
  const h = norm(home), a = norm(away);
  const exact = events.filter(e => norm(e.home_team) === h && norm(e.away_team) === a);
  const partial = exact.length ? exact : events.filter(e => {
    const eh = norm(e.home_team), ea = norm(e.away_team);
    return (eh.includes(h) || h.includes(eh)) && (ea.includes(a) || a.includes(ea));
  });
  return {
    region: body?.meta?.region || "gh",
    processedAt: body?.meta?.processed_at || null,
    count: events.length,
    matched: partial.slice(0, 5),
    availableBookmakers: [...new Set(events.flatMap(e => (e.bookmakers || []).map(b => b.title || b.key)))].sort(),
  };
}
