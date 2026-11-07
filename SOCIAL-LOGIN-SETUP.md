# "Continue with Google" and "Continue with Apple": setup

The website code is ready. These two sign-ins only work once they're switched on in Supabase, and Supabase needs
keys from Google and Apple to do that. Until then the buttons explain that they're coming soon, and point people
to email sign-up (any Gmail address works there).

Your Supabase project's sign-in return address, used below for both: 
**`https://ehgkvthcwfullihgfxym.supabase.co/auth/v1/callback`**

---

## 0. Supabase: where people come back to (1 minute)
Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://autistik.io`
- **Redirect URLs** (add each one): `https://autistik.io/**`, `https://www.autistik.io/**`, `https://*.vercel.app/**`

---

## 1. Google (about 10 minutes, free)
Google signs people in on autistik.io itself (components/GoogleSignIn.tsx). After the steps below, set
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` in Vercel to the Client ID (done 2026-11-07) and add `https://autistik.io` and
`https://www.autistik.io` under **Authorised JavaScript origins**.

1. Open **console.cloud.google.com** and sign in with your Google account.
2. Top bar → project picker → **New project** → name it `AUTISTIK Hub` → **Create**, then select it.
3. Left menu → **APIs & Services → OAuth consent screen** (on newer screens: **Google Auth Platform → Branding**) → **Get started**:
   - App name: `AUTISTIK Hub` · User support email: your email
   - Audience: **External**
   - Contact email: your email → **Create**
4. **Branding**: add the app logo if you like, App home page `https://autistik.io`, Privacy policy `https://autistik.io/safety`,
   and under **Authorised domains** add `autistik.io` and `ehgkvthcwfullihgfxym.supabase.co` → **Save**.
5. **Audience** → press **Publish app** → **Confirm**. (While it says "Testing", only test users you list can sign in.)
6. **Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application** · Name: `AUTISTIK Hub web`
   - **Authorised JavaScript origins:** `https://autistik.io` and `https://www.autistik.io`
   - **Authorised redirect URIs:** `https://ehgkvthcwfullihgfxym.supabase.co/auth/v1/callback`
   - **Create**. Copy the **Client ID** and **Client secret**.
7. Supabase → **Authentication → Sign In / Providers → Google** → turn on **Enable Sign in with Google**,
   paste **Client ID** (into "Client IDs") and **Client Secret** → **Save**.
8. Test: private window → autistik.io → Sign in → **Continue with Google**.

---

## 2. Apple (about 20 minutes, needs an Apple Developer account, $99 a year)
Apple signs people in on autistik.io itself (components/AppleSignIn.tsx), so Apple's window says AUTISTIK. This way
needs **no secret key**, so there is nothing to renew every 6 months.
1. Sign in at **developer.apple.com/account** → **Certificates, Identifiers & Profiles**.
2. **Identifiers → +** → **App IDs** → **App** → Description `AUTISTIK`, Bundle ID (Explicit) `io.autistik.hub`
   → tick **Sign in with Apple** → **Continue → Register**.
3. **Identifiers → +** → **Services IDs** → Description `AUTISTIK`, Identifier `io.autistik.web` → **Register**.
   Open it → tick **Sign in with Apple** → **Configure**:
   - Primary App ID: `io.autistik.hub`
   - **Domains and Subdomains:** `autistik.io`
   - **Return URLs:** `https://autistik.io/login`
   - **Next → Done → Continue → Save**.
4. Supabase → **Authentication → Sign In / Providers → Apple** → turn on **Enable Sign in with Apple**,
   **Client IDs:** `io.autistik.web` (leave Secret Key empty) → **Save**.
5. Vercel → autistiklatestwork → **Settings → Environment Variables**: `NEXT_PUBLIC_APPLE_CLIENT_ID` = `io.autistik.web`
   (Production and Preview), then redeploy.
6. Test: private window on an iPhone → autistik.io → Sign in → **Continue with Apple**.

---

## Good to know
- Google and Apple confirm the email for us, so people who sign in this way skip the email code and get their AUTISTIK wallet straight away.
- New accounts are offered 2-step verification (optional, recommended) on their first sign-in.
- Apple can hide someone's real email ("Hide My Email"). They still get an account; it uses Apple's relay address.
- If something fails: Supabase → **Logs → Auth** shows the reason (for example "provider is not enabled" or "redirect_uri_mismatch").
