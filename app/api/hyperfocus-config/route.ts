import { NextResponse } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "@/lib/supabase/env";

// Hyperfocus GP (public/hyperfocus) is a static page, so it reads the site's public Supabase settings here
// to open its live race rooms. Only the public URL and anon key, which every page already ships.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(SUPABASE_CONFIGURED ? { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY } : {}, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
