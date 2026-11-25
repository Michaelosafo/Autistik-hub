import { getGhanaMatchOdds, getGhanaStandardMatchOdds } from "@/lib/oddsrelay";
import { getOddsPapiMatchOdds } from "@/lib/oddspapi";

async function withProviderTimeout<T>(task: Promise<T>, provider: string, timeoutMs = 14000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(provider + " timed out after " + timeoutMs + "ms")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getCombinedMatchOdds(home: string, away: string, date?: string) {
  const loadOddsRelay = async () => {
    let raw: any = null;
    let rawError: string | null = null;
    try {
      raw = await getGhanaMatchOdds(home, away, date);
      if (raw?.matched?.length) return { ...raw, diagnostics: { ...raw.diagnostics, source: "raw" } };
    } catch (error) {
      rawError = error instanceof Error ? error.message : String(error);
    }
    try {
      const standard = await getGhanaStandardMatchOdds(home, away, date);
      if ((standard?.matched?.length || 0) >= (raw?.matched?.length || 0)) {
        return { ...standard, diagnostics: { ...standard.diagnostics, source: "standard-fallback", rawError } };
      }
      return { ...raw, diagnostics: { ...raw.diagnostics, source: "raw", standardFallbackError: null } };
    } catch (error) {
      const standardError = error instanceof Error ? error.message : String(error);
      if (raw) return { ...raw, diagnostics: { ...raw.diagnostics, source: "raw", standardFallbackError: standardError } };
      throw new Error("OddsRelay raw: " + (rawError || "no matching raw prices") + " | standard fallback: " + standardError);
    }
  };
  const [papiResult, relayResult] = await Promise.allSettled([
    withProviderTimeout(getOddsPapiMatchOdds(home, away, date), "OddsPapi"),
    withProviderTimeout(loadOddsRelay(), "OddsRelay")
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
        oddspapi: papi ? { ok: true, events: papi.diagnostics?.eventsReturned ?? papi.count ?? 0, fixtureEvents: papi.diagnostics?.fixtureEvents ?? null, matchingFixtures: papi.diagnostics?.matchingFixtures ?? null, tournamentCount: papi.diagnostics?.tournamentCount ?? null, bookmakerSlugs: papi.diagnostics?.bookmakerSlugs ?? [], matched: papi.matched?.length || 0 } :
          { ok: false, error: String((papiResult as PromiseRejectedResult).reason?.message || (papiResult as PromiseRejectedResult).reason) },
        oddsrelay: relay ? { ok: true, source: relay.diagnostics?.source || relay.product, rawError: relay.diagnostics?.rawError || null, fallbackError: relay.diagnostics?.standardFallbackError || null, events: relay.diagnostics?.eventsReturned ?? relay.count ?? 0, matched: relay.matched?.length || 0 } :
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
