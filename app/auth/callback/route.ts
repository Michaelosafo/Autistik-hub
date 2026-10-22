import { NextResponse } from "next/server";
import { safeNext, welcomeUrl } from "@/lib/auth";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { ensureMemberWallet } from "@/lib/privy-server";

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
    const { data, error } = await supabaseServer().auth.exchangeCodeForSession(code);
    // Google / Apple sign-in: the button says "By continuing you confirm you're 18 or older", which the email form asks as a tick box.
    const provider = data?.user?.app_metadata?.provider;
    if (!error && data?.user && url.searchParams.get("adult") === "1" && (provider === "google" || provider === "apple")) {
      await supabaseService().from("profiles").update({ confirmed_adult: true }).eq("id", data.user.id).eq("confirmed_adult", false).then(() => {}, () => {});
    }
    // Their AUTISTIK wallet, made the moment the email is confirmed (Google and Apple confirm it for us).
    if (!error && data?.user?.email_confirmed_at) await ensureMemberWallet(data.user.email);
    if (error) {
      const why = url.searchParams.get("adult") === "1"
        ? "Signing in with Google or Apple didn't finish. Please try again in this same browser, or use your email."
        : "Open the link in the same browser you signed up in, or sign in with your password.";
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(why)}`, url.origin));
    }
    // First time in (e.g. a new Google account): offer 2-step verification before going on.
    const created = Date.parse(data?.user?.created_at || "");
    if (next !== "/reset-password" && Date.now() - created < 10 * 60 * 1000) return NextResponse.redirect(welcomeUrl(new URL(next, url.origin), url.origin));
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
