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
1. Sign in at **developer.apple.com/account** → **Certificates, Identifiers & Profiles**.
2. **Identifiers → +** → **App IDs** → **App** → Description `AUTISTIK Hub`, Bundle ID (Explicit) `io.autistik.hub`
   → tick **Sign in with Apple** → **Continue → Register**.
3. **Identifiers → +** → **Services IDs** → Description `AUTISTIK Hub web`, Identifier `io.autistik.hub.web` → **Register**.
   Open it → tick **Sign in with Apple** → **Configure**:
   - Primary App ID: `io.autistik.hub`
   - **Domains and Subdomains:** `autistik.io`, `ehgkvthcwfullihgfxym.supabase.co`
   - **Return URLs:** `https://ehgkvthcwfullihgfxym.supabase.co/auth/v1/callback`
   - **Next → Done → Continue → Save**.
4. **Keys → +** → name `AUTISTIK Hub sign in` → tick **Sign in with Apple** → **Configure** → pick `io.autistik.hub` → **Save → Continue → Register**.
   **Download** the `.p8` file (you can only download it once) and note the **Key ID**.
   Your **Team ID** is shown at the top right of the developer site.
5. Supabase → **Authentication → Sign In / Providers → Apple** → turn on **Enable Sign in with Apple**:
   - **Client IDs:** `io.autistik.hub.web`
   - **Secret Key (for OAuth):** Supabase makes this from your `.p8` file, Key ID, Team ID and Services ID. Use the
     "generate secret" tool linked on that Apple settings panel (or in Supabase's "Login with Apple" guide), paste the result → **Save**.
6. **Every 6 months** Apple's secret expires: make a new one the same way and paste it in. Put a reminder in your calendar.
7. Test: private window → autistik.io → Sign in → **Continue with Apple**.

---

## Good to know
- Google and Apple confirm the email for us, so people who sign in this way skip the email code and get their AUTISTIK wallet straight away.
- New accounts are offered 2-step verification (optional, recommended) on their first sign-in.
- Apple can hide someone's real email ("Hide My Email"). They still get an account; it uses Apple's relay address.
- If something fails: Supabase → **Logs → Auth** shows the reason (for example "provider is not enabled" or "redirect_uri_mismatch").
