import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Placeholders let pages render (signed out, no data) instead of crashing when Supabase isn't configured yet.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://not-configured.supabase.co";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "not-configured";

/** Supabase client acting as the signed-in visitor (respects Row Level Security). */
export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    URL,
    ANON,
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
    URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || "not-configured",
    { auth: { persistSession: false } }
  );
}

export async function currentUser() {
  const sb = supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}
