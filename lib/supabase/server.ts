import { createServerClient } from "@supabase/ssr";
import { createClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";
import { mfaStep, type MfaStep } from "@/lib/mfa";

/** Supabase client acting as the signed-in visitor (respects Row Level Security). */
export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(list) {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: the middleware refreshes cookies instead.
          }
        },
      },
    }
  );
}

/** Admin client with the service role key. SERVER ONLY — bypasses Row Level Security. */
export function supabaseService() {
  return createClient(
    SUPABASE_URL,
    (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().replace(/^["']|["']$/g, "") || "not-configured",
    { auth: { persistSession: false } }
  );
}

/**
 * The signed-in member, or null. Someone who has signed in but not yet entered their authenticator code counts as
 * signed out everywhere on the site (see lib/mfa.ts).
 */
export async function currentUser() {
  const { user, mfa } = await accountState();
  return mfa === "ok" ? user : null;
}

/** The signed-in account (even before its 2-step code) and what it still needs to do. */
export async function accountState(): Promise<{ user: User | null; mfa: MfaStep }> {
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  const user = data.user ?? null;
  if (!user) return { user: null, mfa: "ok" };
  const { data: lvl } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return { user, mfa: mfaStep(user, lvl?.currentLevel) };
}
