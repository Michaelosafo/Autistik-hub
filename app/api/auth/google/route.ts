import { NextResponse } from "next/server";
import { safeNext, welcomeUrl } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { supabaseServer, supabaseService } from "@/lib/supabase/server";
import { linkBuiltinWallet } from "@/lib/privy-server";

export const runtime = "nodejs";

/**
 * "Continue with Google" without leaving autistik.io (components/GoogleSignIn.tsx). Google signs the person in on
 * our own page, so its screen says "autistik.io" instead of the Supabase project address. We hand Google's signed
 * ID token to Supabase, which checks it and starts the session (cookies set here). Then the same steps as
 * /auth/callback: 18+ confirmed by the button, their AUTISTIK wallet, and the 2-step offer for new accounts.
 */
export async function POST(req: Request) {
  const slow = await rateLimit(req, "google-signin", 20, 600);
  if (slow) return slow;
  const body = await req.json().catch(() => null);
  const token = typeof body?.credential === "string" ? body.credential : "";
  const nonce = typeof body?.nonce === "string" ? body.nonce : "";
  const origin = new URL(req.url).origin;
  const next = safeNext(body?.next);
  if (!token || token.length > 4096 || !nonce || nonce.length > 200) return NextResponse.json({ error: "Google sign-in didn't finish. Please try again." }, { status: 400 });

  const { data, error } = await supabaseServer().auth.signInWithIdToken({ provider: "google", token, nonce });
  if (error || !data?.user) {
    const off = /not enabled|unsupported provider/i.test(error?.message || "");
    return NextResponse.json({ error: off ? "Google sign-in isn't switched on yet. Use your email for now." : "Google sign-in didn't finish. Please try again, or use your email." }, { status: 400 });
  }
  const user = data.user;
  await supabaseService().from("profiles").update({ confirmed_adult: true }).eq("id", user.id).eq("confirmed_adult", false).then(() => {}, () => {});
  if (user.email_confirmed_at) await linkBuiltinWallet(user.id, user.email).catch(() => {});
  const created = Date.parse(user.created_at || "");
  const to = Date.now() - created < 10 * 60 * 1000 ? welcomeUrl(new URL(next, origin), origin) : new URL(next, origin);
  return NextResponse.json({ to: to.pathname + to.search });
}
