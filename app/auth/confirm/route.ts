import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { ensureMemberWallet } from "@/lib/privy-server";

const TYPES: EmailOtpType[] = ["signup", "email", "magiclink", "recovery", "invite", "email_change"];

// The buttons in our emails link here (see supabase/email-templates). It confirms the email and signs the person in.
// Works on any device or browser, unlike links that need the same browser the request came from.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"));

  if (tokenHash && type && TYPES.includes(type)) {
    const { data, error } = await supabaseServer().auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      // Email confirmed: their AUTISTIK wallet is made now, so it's waiting the first time they open it.
      if (type !== "recovery" && data?.user?.email_confirmed_at) await ensureMemberWallet(data.user.email);
      if (type === "recovery") return NextResponse.redirect(new URL("/reset-password", url.origin));
      const done = new URL(next, url.origin);
      if (type === "signup" || type === "email") done.searchParams.set("welcome", "1");
      return NextResponse.redirect(done);
    }
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("That link is incomplete. Ask for a new one."), url.origin));
}
