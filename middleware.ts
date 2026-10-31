import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "@/lib/supabase/env";
import { buildCsp, makeNonce } from "@/lib/csp";
import { MFA_FREE, mfaStep } from "@/lib/mfa";

// 1) Gives every page a one-time script nonce and its security policy (Next.js adds the nonce to its own scripts).
// 2) Keeps the Supabase login session fresh on every page load.
// 3) Refuses API changes sent from other websites.
// 4) Sends signed-in members who haven't entered their authenticator code yet to /security first.
// Never blocks the page: if Supabase isn't configured or can't be reached, the visitor just isn't signed in.
export async function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const { enforced, reportOnly } = buildCsp(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", enforced);
  const next = () => NextResponse.next({ request: { headers } });
  const finish = (r: NextResponse) => {
    r.headers.set("Content-Security-Policy", enforced);
    r.headers.set("Content-Security-Policy-Report-Only", reportOnly);
    return r;
  };

  // Changes sent to the site's API must come from the site itself, so another website can't send them in a member's name.
  if (request.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const from = request.headers.get("origin");
    const same = (() => { try { return new URL(from!).host === (request.headers.get("host") || request.nextUrl.host); } catch { return false; } })();
    if (from && !same) {
      return finish(NextResponse.json({ error: "Requests must come from this site." }, { status: 403 }));
    }
  }

  let response = next();
  if (!SUPABASE_CONFIGURED) return finish(response);
  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(list) {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          // Carry the refreshed cookies into this request too, so the page sees the new session.
          headers.set("cookie", request.cookies.toString());
          response = next();
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    const { data: { user } } = await supabase.auth.getUser();
    const path = request.nextUrl.pathname;
    if (user && !MFA_FREE.test(path) && request.method === "GET") {
      const { data: lvl } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (mfaStep(user, lvl?.currentLevel) !== "ok") {
        const to = request.nextUrl.clone();
        to.pathname = "/security";
        to.search = "";
        to.searchParams.set("next", path + request.nextUrl.search);
        const r = NextResponse.redirect(to);
        response.cookies.getAll().forEach((c) => r.cookies.set(c));
        return finish(r);
      }
    }
  } catch (e) {
    console.error("Supabase session refresh failed:", e);
  }
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|airdrops/|icons/|hyperfocus|sw.js|offline.html|manifest.webmanifest|apple-icon.png).*)"],
};
