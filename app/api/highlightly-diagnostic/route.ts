import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.SUPER_HIGHLIGHTLY_API_KEY;
  if (!key) return NextResponse.json({ configured: false, error: "SUPER_HIGHLIGHTLY_API_KEY is missing in Production." }, { status: 503 });

  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  const attempts = [
    {
      provider: "Highlightly direct",
      url: "https://soccer.highlightly.net/matches?date=" + date + "&timezone=Africa%2FAccra&limit=100&offset=0",
      headers: { "x-rapidapi-key": key }
    },
    {
      provider: "RapidAPI All Sports",
      url: "https://sport-highlights-api.p.rapidapi.com/football/matches?date=" + date + "&timezone=Africa%2FAccra&limit=100&offset=0",
      headers: { "x-rapidapi-key": key, "x-rapidapi-host": "sport-highlights-api.p.rapidapi.com" }
    }
  ];

  const results = await Promise.all(attempts.map(async attempt => {
    try {
      const response = await fetch(attempt.url, { headers: attempt.headers, cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body: any = await response.json().catch(() => null);
      const matches = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.matches) ? body.matches : [];
      return {
        provider: attempt.provider,
        httpStatus: response.status,
        ok: response.ok,
        matchCount: matches.length,
        sampleCompetitions: [...new Set(matches.slice(0, 100).map((m: any) => m?.league?.name || m?.leagueName || m?.competition?.name).filter(Boolean))].slice(0, 12),
        error: response.ok ? null : String(body?.message || body?.error || body?.detail || response.statusText).slice(0, 240)
      };
    } catch (error) {
      return { provider: attempt.provider, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  return NextResponse.json({ configured: true, date, results }, { headers: { "Cache-Control": "no-store" } });
}
