# AUTISTIK Hub: go-live checklist

Tick these off in order. Every step happens in a website (Vercel, Supabase, GitHub, Remix, MetaMask, your domain company). Nothing needs installing on your computer. The full details for each step are in `README.md`.

## 1. Basics
- [ ] Use **one** Vercel project for the Hub: **`autistiklatestwork`** (it has your settings). Its domain is **autistik.io** (bought on Vercel). Check settings any time at `/api/health`.
- [ ] Vercel → Settings → Environment Variables has: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_TOKEN_ADDRESS`.
  - `SUPABASE_SERVICE_ROLE_KEY`: a Supabase **secret** key (`sb_secret_…`, Project Settings → API Keys → Secret keys) or the legacy `service_role` key. Not the anon/publishable key. If AI chat says "isn't available… database isn't fully set up", this key is usually wrong.
  - `ANTHROPIC_API_KEY`: the `sk-ant-…` key. `ANTHROPIC_MODEL` is optional and must be a model name like `claude-sonnet-5-5`, never a key.
- [ ] Email sign-up works: follow [`EMAIL-SETUP.md`](EMAIL-SETUP.md) (Resend + Supabase settings + email templates).
- [ ] You can create an account, confirm the email, and Believer and Autistik both reply.
- [ ] You are admin (README step 6). **Admin** shows in the menu.

## 2. Database (Supabase → SQL Editor → New query → paste → Run)
- [ ] `supabase/launchpad.sql` (lock options, Listed tokens, trending)
- [ ] `supabase/fund.sql` (Fund "register your interest" list)
- [ ] `supabase/ai-pass.sql` (5 free AI messages a day, then the paid AI Pass)
- [ ] `supabase/security.sql` (rate limits, anti-spam rules, admin log)
- [ ] `supabase/ai-budget.sql` (AI cost tracking for the Admin page, 2 AI launch sessions a day)
- [ ] `supabase/admin-lock.sql` with your email (admin area only for you, with 2-step verification)
- [ ] `supabase/hardening.sql` (browsers get only the exact database access the site uses)
- [ ] `supabase/analytics.sql` (Analytics: top 40 wallets, dev wallet, sell alerts, checked every 10 minutes)
- [ ] Supabase → Authentication → **Attack Protection** → turn on **Prevent use of leaked passwords** → Save.

## 3. Wallets
| Wallet | Used for | Notes |
|---|---|---|
| Treasury | Launch fees and $20 BNB trending payments arrive here | A Safe multisig (safe.global) is best |
| Owner | Deploys the Launch Pad contract, can change the fee | Needs a little BNB for gas. Can be the same as treasury |
| Signer | Signs the "holds $20 of AUTISTIK" pass | Brand-new wallet, used for nothing else, never needs coins |

## 4. Vercel settings for the Launch Pad and trending
| Name | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://autistik.io` |
| `NEXT_PUBLIC_TREASURY_WALLET` | treasury address |
| `NEXT_PUBLIC_TRENDING_USD` | `20` |
| `NEXT_PUBLIC_TRENDING_HOURS` | `24` |
| `ELIGIBILITY_SIGNER_KEY` | signer wallet's **private key** (secret, only here) |
| `NEXT_PUBLIC_LAUNCH_MIN_HOLD_USD` | `20` |
| `NEXT_PUBLIC_AI_PASS_USD` | `5` (price of an AI Pass) |
| `NEXT_PUBLIC_AI_PASS_DAYS` | `30` |
| `NEXT_PUBLIC_AI_FREE_PER_DAY` | `5` (free Believer & Purity messages per member per day; a picture counts as 5) |
| `ANTHROPIC_FAST_MODEL` | optional, default `claude-haiku-5-5` (low-cost model for free messages and the Launch Pad guide) |
| `AI_DAILY_LIMIT` | `60` (messages a day per member; lower it if Claude costs get high) |

> AI Pass and trending payments carry a small note (the account id or token address) inside the BNB transfer. A normal wallet (MetaMask, Trust Wallet) as `NEXT_PUBLIC_TREASURY_WALLET` accepts these. A Safe multisig may reject them, so if you use a Safe, receive into a normal wallet and move the BNB to the Safe now and then. Test with one payment first.

- [ ] Deployments → ⋯ → **Redeploy**. Trending payments now work.

## 4b. Analytics (top 40 wallets and sell alerts)
- [ ] moralis.com → sign up free → copy your **API key**. Vercel: `MORALIS_API_KEY` = the key (**Secret**) → Redeploy. Without it, Analytics still works but shows the top 10 wallets only.
- [ ] Optional: `MORALIS_DAILY_LIMIT` (default `600`) caps the paid calls per day.

## 5. Launch Pad v3 on BNB Chain
- [ ] Supabase SQL Editor: run `supabase/launchpad.sql` and `supabase/evm-vanity.sql`.
- [ ] Deploy the AUTISTIK Locker on BNB Chain (Lockers page), then the burner on `/launchpad/new` (admin: **1. Deploy AUTISTIK burner**).
- [ ] On `/launchpad/new` (admin), press **Deploy Launch Pad** (or **Upgrade to v3**). New token addresses end in "AAAAA".
- [ ] Press **Turn on the $20 AUTISTIK check** (`ELIGIBILITY_SIGNER_KEY` must be set in Vercel first).
- [ ] Press **Sync $ amounts** so the launch fee matches the BNB price.
- [ ] Launch a test token and check its page shows the code as verified on BscScan.

## 6. Test with small amounts
- [ ] Launch a test token from a wallet holding $20+ of AUTISTIK, 0.1 BNB liquidity, **Lock 6 months**. Its page shows the unlock date.
- [ ] A wallet **without** AUTISTIK is refused.
- [ ] "Make it trend" with $20 of BNB. The BNB arrives in the treasury and the token shows **Promoted**.
- [ ] Register on `/fund`. The entry shows in Admin.
- [ ] With a new (non-admin) account: 5 messages to Believer work, the 6th asks for an AI Pass (or to come back tomorrow). Pay $5 of BNB, and chatting works again.

## 7. Website address: autistik.io
- [ ] autistik.io (bought on Vercel) is added to the `autistiklatestwork` project, with `www.autistik.io` redirecting to it.
- [ ] Supabase → Authentication → URL Configuration: Site URL `https://autistik.io`, Redirect URLs `https://autistik.io/**` and `https://www.autistik.io/**`.
- [ ] Upload `AUTISTIK-Whitepaper.pdf` into the `public` folder on GitHub.

## 7b. "Are you human" check (free, stops bot sign-ups)
- [ ] dash.cloudflare.com → sign up free → **Turnstile** → **Add widget**: name `AUTISTIK Hub`, hostnames `autistik.io` and `www.autistik.io`, mode **Managed** → Create. Copy the **Site Key** and **Secret Key**.
- [ ] Vercel: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = Site Key (**Config**), `TURNSTILE_SECRET_KEY` = Secret Key (**Secret**) → Redeploy.
- [ ] **After** the redeploy: Supabase → Authentication → **Attack Protection** → turn on **Captcha protection**, provider **Turnstile**, paste the **Secret Key** → Save. (Doing this before the redeploy would block sign-ins.)

## 8. Before opening to the public
- [ ] Audit of `contracts/AutistikLaunchpadV3.sol` by a smart-contract auditor.
- [ ] Owner and treasury are a Safe multisig.
- [ ] Legal check in Ghana on charging launch and listing fees.

## Later
- Ethereum and Robinhood Chain: deploy the same contract there (README → "Turn it on for a chain") and set `NEXT_PUBLIC_LAUNCHPAD_ETHEREUM` / `NEXT_PUBLIC_LAUNCHPAD_ROBINHOOD`.
