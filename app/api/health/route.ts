import { SUPABASE_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A quick self-check you can open in the browser: /api/health
// It never shows keys, only whether each setting is there and whether Supabase answers.
export async function GET() {
  const out: Record<string, unknown> = {
    build: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7),
    environment: process.env.VERCEL_ENV || "local",
    supabaseUrlSet: SUPABASE_CONFIGURED,
    // Never print the value itself: if a key was pasted into the URL setting by mistake, it would leak.
    supabaseUrlLooksRight: SUPABASE_CONFIGURED ? /^[a-z0-9-]+\.supabase\.(co|in)$/i.test(new URL(SUPABASE_URL).host) : false,
    anonKeySet: SUPABASE_ANON_KEY !== "not-configured",
    serviceKeySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    claudeKeySet: !!process.env.ANTHROPIC_API_KEY,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
  };
  let advice = "";
  if (SUPABASE_CONFIGURED && !out.supabaseUrlLooksRight) {
    out.supabase = "wrong url";
    advice = "NEXT_PUBLIC_SUPABASE_URL isn't a Supabase Project URL. It must look like https://abcdefgh.supabase.co (Supabase → Project Settings → API → Project URL). If you pasted a key there by mistake, replace it, rotate that key in Supabase, then Redeploy.";
  } else if (!SUPABASE_CONFIGURED) {
    out.supabase = "not set";
    advice = "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, then Redeploy.";
  } else {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY }, cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const s = await r.json().catch(() => ({}));
        out.supabase = "ok";
        out.emailSignupEnabled = s?.external?.email ?? null;
        out.signupsAllowed = s?.disable_signup === undefined ? null : !s.disable_signup;
        out.emailConfirmationRequired = s?.mailer_autoconfirm === undefined ? null : !s.mailer_autoconfirm;
        if (out.emailSignupEnabled === false) advice = "Turn on the Email provider in Supabase → Authentication → Sign In / Providers.";
        else if (out.signupsAllowed === false) advice = "Turn on 'Allow new users to sign up' in Supabase → Authentication → Sign In / Providers.";
        else advice = "Supabase is reachable. If sign-up still fails, check the browser isn't blocking it (ad blockers, VPN) and see EMAIL-SETUP.md.";
      } else if (r.status === 401 || r.status === 403) {
        out.supabase = "wrong key";
        advice = "NEXT_PUBLIC_SUPABASE_ANON_KEY doesn't match this Supabase project. Copy the anon public key again from Supabase → Project Settings → API, then Redeploy.";
      } else {
        out.supabase = `error ${r.status}`;
        advice = "Supabase answered with an error. Open your Supabase dashboard: the project may be paused. Press Restore project.";
      }
    } catch {
      out.supabase = "unreachable";
      advice = "Can't reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL is your Project URL (https://xxxx.supabase.co), and that the project isn't paused in the Supabase dashboard (press Restore project).";
    }
  }
  out.advice = advice;
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
