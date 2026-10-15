import { SUPABASE_CONFIGURED, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/env";
import { adminState } from "@/lib/admin";
import { anthropic, MODEL } from "@/lib/ai";
import { supabaseService } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/ratelimit";

// The AI check is free (it only looks up the model), and is cached so the page can't be used to spam the API.
let aiCache: { at: number; result: string } | null = null;
async function checkAI(): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return "no key";
  if (aiCache && Date.now() - aiCache.at < 10 * 60_000) return aiCache.result;
  let result = "ok";
  try { await anthropic().models.retrieve(MODEL); }
  catch (e: any) { result = e?.status === 401 || e?.status === 403 ? "invalid key" : e?.status === 404 ? "model not found" : `error ${e?.status ?? ""}`.trim(); }
  aiCache = { at: Date.now(), result };
  return result;
}

async function checkDatabase(): Promise<string> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return "no service key";
  const { error } = await supabaseService().from("ai_usage").select("user_id").limit(1);
  if (!error) {
    const p = await supabaseService().from("ai_passes").select("id").limit(1);
    return p.error ? "ai pass tables missing" : "ok";
  }
  return /does not exist|schema cache/i.test(error.message) ? "tables missing" : /invalid api key|jwt|unauthorized/i.test(error.message) ? "wrong service key" : "error";
}

async function isAdmin(): Promise<boolean> {
  if (!SUPABASE_CONFIGURED) return false;
  try {
    return (await adminState()).admin;
  } catch { return false; }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A quick self-check you can open in the browser: /api/health
// It never shows keys, only whether each setting is there and whether Supabase answers.
export async function GET(req: Request) {
  const slow = await rateLimit(req, "health", 30, 60);
  if (slow) return slow;
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
  if (out.supabase === "ok") {
    out.database = await checkDatabase();
    out.aiModel = MODEL;
    out.ai = await checkAI();
    const fix: Record<string, string> = {
      "no key": "Add ANTHROPIC_API_KEY in Vercel (from console.anthropic.com → API Keys), then Redeploy.",
      "invalid key": "ANTHROPIC_API_KEY is wrong or was deleted. Create a new key at console.anthropic.com → API Keys, paste it in Vercel, then Redeploy.",
      "model not found": `ANTHROPIC_MODEL ("${MODEL}") isn't a model this key can use. Set ANTHROPIC_MODEL in Vercel to a current model name from docs.claude.com, then Redeploy.`,
    };
    if (out.database === "tables missing") advice = "Supabase is reachable but the Hub's tables are missing. Run supabase/schema.sql in Supabase → SQL Editor.";
    else if (out.database === "ai pass tables missing") advice = "Run supabase/ai-pass.sql in Supabase → SQL Editor so the 2 free tries and AI Pass work.";
    else if (out.database === "wrong service key") advice = "SUPABASE_SERVICE_ROLE_KEY doesn't match this project. Copy the service_role (or secret) key again, then Redeploy.";
    else if (out.ai !== "ok") advice = fix[out.ai as string] || "The Claude API answered with an error. Check console.anthropic.com → Billing has credit, then try again.";
    else advice = "Everything is connected. If the AI still doesn't reply, check console.anthropic.com → Billing has credit.";
  }
  out.advice = advice;
  // Visitors see whether each part works. Only admins see the finer details (sign-up settings, AI model, site address).
  if (!(await isAdmin())) {
    for (const k of ["emailSignupEnabled", "signupsAllowed", "emailConfirmationRequired", "aiModel", "siteUrl"]) delete out[k];
    out.details = "Sign in as an admin to see more.";
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
