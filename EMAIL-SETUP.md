# Email sign-up: setup

Members create an account with **email + password**, get a **confirmation email**, press **Confirm my email**, and land on Believer & Purity, signed in. They can also reset a forgotten password, or ask for a one-time sign-in link.

The website code is done. These settings live in Supabase and Resend, so you set them once in their dashboards.

> **Why Resend?** Supabase's built-in email only sends to your own team's addresses (about 2 emails an hour). Real members never get it. Resend is free for 3,000 emails a month.

## 1. Resend (sends the emails)
1. Go to **resend.com** and sign up.
2. **Domains → Add Domain** → type `autistik.io` → choose a region near you.
3. Resend shows 3–4 DNS records (TXT and CNAME records). Add each one in **Vercel → Domains → autistik.io → DNS Records** (the domain was bought on Vercel). These are **extra** records: don't delete anything.
4. Back in Resend, press **Verify**. It turns green within minutes (sometimes a few hours).
5. **API Keys → Create API Key** → name it `Supabase`, permission **Sending access**, domain `autistik.io` → copy the key (starts with `re_`). You only see it once.

## 2. Supabase: connect Resend
Supabase → your project → **Project Settings → Authentication → SMTP Settings** → turn on **Enable Custom SMTP**:

| Field | Value |
|---|---|
| Sender email | `hello@autistik.io` (any address on your domain) |
| Sender name | `AUTISTIK Hub` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (`re_…`) |

Press **Save**. Then **Authentication → Rate Limits**: set "emails per hour" to **100** (or more).

## 3. Supabase: email and password sign-in
**Authentication → Sign In / Providers → Email**:
- **Enable Email provider:** on
- **Confirm email:** **on** (people must press the link before they can sign in)
- **Minimum password length:** `8`
- Save.

**Authentication → URL Configuration**:
- **Site URL:** `https://autistik.io`
- **Redirect URLs:** `https://autistik.io/**`, `https://www.autistik.io/**`, `https://*.vercel.app/**`

## 4. Supabase: the AUTISTIK emails
**Authentication → Emails (Email Templates)**. For each one, set the subject and paste the whole file from `supabase/email-templates/` into the message body, then **Save**:

| Template | Subject | File |
|---|---|---|
| Confirm signup | Confirm your AUTISTIK Hub email | `confirm-signup.html` |
| Reset password | Reset your AUTISTIK Hub password | `reset-password.html` |
| Magic link | Your AUTISTIK Hub sign-in link | `magic-link.html` |
| Change email address | Confirm your new AUTISTIK Hub email | `change-email.html` |

These links work even if someone signs up on their laptop and opens the email on their phone.

## 5. Test it
1. Open the Hub in a private window → **Sign in / Join** → **Create account**.
2. Use an email you can check, a password of 8+ characters, tick both boxes → **Create my account**.
3. The email "Confirm your AUTISTIK Hub email" arrives → press **Confirm my email**.
4. You land on Believer & Purity, signed in, with a welcome note. Say hello.
5. Sign out → sign in with the same email and password. Then try **Forgot your password?**.

**Didn't get the email?** Check spam. In Resend → **Emails** you can see whether it was sent. In Supabase → **Logs → Auth** you can see errors.

## Text-message (SMS) codes (optional, costs money)
Supabase can also send a 6-digit code by SMS instead of email, through Twilio or MessageBird. Each text costs a few cents and needs a paid Twilio account. Ask if you want it added.
