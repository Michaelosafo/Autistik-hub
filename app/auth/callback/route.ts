import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

// Links that use Supabase's default email templates come here with a one-time code.
// Our own templates use /auth/confirm instead, which also works across devices.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // The password-reset email lands here first, then goes on to choose a new password.
  const next = url.searchParams.get("next") === "/reset-password" ? "/reset-password" : safeNext(url.searchParams.get("next"));
  const err = url.searchParams.get("error_description");
  if (err) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(err)}`, url.origin));
  if (code) {
    const { error } = await supabaseServer().auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("Open the link in the same browser you signed up in, or sign in with your password.")}`, url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
