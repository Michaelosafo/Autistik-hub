import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "@/lib/supabase/env";
import { buildCsp, makeNonce } from "@/lib/csp";

// 1) Gives every page a one-time script nonce and its security policy (Next.js adds the nonce to its own scripts).
// 2) Keeps the Supabase login session fresh on every page load.
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
    await supabase.auth.getUser();
  } catch (e) {
    console.error("Supabase session refresh failed:", e);
  }
  return finish(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|airdrops/|icons/|sw.js|offline.html|manifest.webmanifest|apple-icon.png).*)"],
};
