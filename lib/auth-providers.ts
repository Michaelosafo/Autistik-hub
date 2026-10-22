import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "@/lib/supabase/env";

export type Providers = { google: boolean; apple: boolean };

/**
 * Which "Continue with…" sign-ins are switched on in Supabase (Authentication → Sign In / Providers). Read from
 * Supabase's public settings and kept for 5 minutes, so a button never sends people to a "provider is not enabled"
 * error page. If Supabase can't be asked, both count as on (the button then explains any error itself).
 */
export async function oauthProviders(): Promise<Providers> {
  if (!SUPABASE_CONFIGURED) return { google: false, apple: false };
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY }, next: { revalidate: 300 }, signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    if (!r.ok || !d?.external) throw new Error(`settings ${r.status}`);
    return { google: d.external.google === true, apple: d.external.apple === true };
  } catch {
    return { google: true, apple: true };
  }
}
