import { getGhanaMatchOdds } from "@/lib/oddsrelay";
import { getOddsPapiMatchOdds } from "@/lib/oddspapi";

export async function getCombinedMatchOdds(home: string, away: string, date?: string) {
  const [papiResult, relayResult] = await Promise.allSettled([
    getOddsPapiMatchOdds(home, away, date),
    getGhanaMatchOdds(home, away, date)
  ]);
  const papi = papiResult.status === "fulfilled" ? papiResult.value : null;
  const relay = relayResult.status === "fulfilled" ? relayResult.value : null;
  if (!papi && !relay) {
    const p = papiResult.status === "rejected" ? String(papiResult.reason?.message || papiResult.reason) : "No OddsPapi data";
    const r = relayResult.status === "rejected" ? String(relayResult.reason?.message || relayResult.reason) : "No OddsRelay data";
    throw new Error("Both odds providers failed. OddsPapi: " + p + " | OddsRelay: " + r);
  }

  const papiEvents = (papi?.matched || []).map((event: any) => ({ ...event, __oddsProvider: "OddsPapi" }));
  const relayEvents = (relay?.matched || []).map((event: any) => ({ ...event, __oddsProvider: "OddsRelay" }));
  const events = [...papiEvents, ...relayEvents];
  const merged = events.map((event: any) => {
    const provider = event.__oddsProvider || (event.region === "gh" ? "OddsRelay" : "OddsPapi");
    return {
      ...event,
      bookmakers: (event.bookmakers || []).map((book: any) => ({
        ...book,
        key: provider.toLowerCase() + ":" + String(book.key || book.title || "bookmaker"),
        title: String(book.title || book.key || "Bookmaker") + " (" + provider + ")"
      }))
    };
  });
  const uniqueBooks = [...new Set(merged.flatMap((event: any) => (event.bookmakers || []).map((book: any) => book.title)))].sort();
  const markets = [...new Set(merged.flatMap((event: any) => (event.bookmakers || []).flatMap((book: any) => (book.markets || []).map((market: any) => market.key))))];
  return {
    region: "combined",
    product: "OddsPapi + OddsRelay",
    count: Number(papi?.count || 0) + Number(relay?.count || 0),
    matched: merged,
    availableBookmakers: uniqueBooks,
    diagnostics: {
      eventsReturned: Number(papi?.diagnostics?.eventsReturned ?? papi?.count ?? 0) + Number(relay?.diagnostics?.eventsReturned ?? relay?.count ?? 0),
      matchingEvents: merged.length,
      oddsEvents: Number(papi?.diagnostics?.eventsReturned ?? papi?.count ?? 0) + Number(relay?.diagnostics?.eventsReturned ?? relay?.count ?? 0),
      matchedEvents: merged.length,
      requestedHome: home,
      requestedAway: away,
      providers: {
        oddspapi: papi ? { ok: true, events: papi.diagnostics?.eventsReturned ?? papi.count ?? 0, matched: papi.matched?.length || 0 } :
          { ok: false, error: String((papiResult as PromiseRejectedResult).reason?.message || (papiResult as PromiseRejectedResult).reason) },
        oddsrelay: relay ? { ok: true, events: relay.diagnostics?.eventsReturned ?? relay.count ?? 0, matched: relay.matched?.length || 0 } :
          { ok: false, error: String((relayResult as PromiseRejectedResult).reason?.message || (relayResult as PromiseRejectedResult).reason) }
      },
      markets,
      sampleEvents: [
        ...(papi?.diagnostics?.sampleEvents || []),
        ...(relay?.diagnostics?.sampleEvents || [])
      ].slice(0, 8)
    }
  };
}
