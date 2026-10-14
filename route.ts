import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// The sign-in email links here; we swap the one-time code for a session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const sb = supabaseServer();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL("/community", url.origin));
}
