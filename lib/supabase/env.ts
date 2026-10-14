// Tidies Supabase settings pasted into Vercel (stray quotes, spaces, missing https://).
// Falls back to placeholders so pages render signed out instead of crashing when they're missing or invalid.
const PLACEHOLDER_URL = "https://not-configured.supabase.co";

function clean(v: string | undefined) {
  return (v || "").trim().replace(/^["']|["']$/g, "").trim();
}

function cleanUrl(v: string | undefined) {
  let url = clean(v).replace(/\/+$/, "");
  if (!url) return PLACEHOLDER_URL;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).origin;
  } catch {
    return PLACEHOLDER_URL;
  }
}

export const SUPABASE_URL = cleanUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_ANON_KEY = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) || "not-configured";
export const SUPABASE_CONFIGURED = SUPABASE_URL !== PLACEHOLDER_URL && SUPABASE_ANON_KEY !== "not-configured";
