# AUTISTIK Hub: go-live checklist

Tick these off in order. Every step happens in a website (Vercel, Supabase, GitHub, Remix, MetaMask, your domain company). Nothing needs installing on your computer. The full details for each step are in `README.md`.

## 1. Basics
- [ ] Use **one** Vercel project for the Hub (`autistik-hub-h6td`). Remove autistikk.com from any other project.
- [ ] Vercel → Settings → Environment Variables has: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_TOKEN_ADDRESS`.
- [ ] You can sign in, and Believer and Autistik both reply.
- [ ] You are admin (README step 6). **Admin** shows in the menu.

## 2. Database (Supabase → SQL Editor → New query → paste → Run)
- [ ] `supabase/launchpad.sql` (lock options, Listed tokens, trending)
- [ ] `supabase/fund.sql` (Fund "register your interest" list)

## 3. Wallets
| Wallet | Used for | Notes |
|---|---|---|
| Treasury | Launch fees and $20 BNB trending payments arrive here | A Safe multisig (safe.global) is best |
| Owner | Deploys the Launch Pad contract, can change the fee | Needs a little BNB for gas. Can be the same as treasury |
| Signer | Signs the "holds $20 of AUTISTIK" pass | Brand-new wallet, used for nothing else, never needs coins |

## 4. Vercel settings for the Launch Pad and trending
| Name | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://autistikk.com` |
| `NEXT_PUBLIC_TREASURY_WALLET` | treasury address |
| `NEXT_PUBLIC_TRENDING_USD` | `20` |
| `NEXT_PUBLIC_TRENDING_HOURS` | `24` |
| `ELIGIBILITY_SIGNER_KEY` | signer wallet's **private key** (secret, only here) |
| `NEXT_PUBLIC_LAUNCH_MIN_HOLD_USD` | `20` |

- [ ] Deployments → ⋯ → **Redeploy**. Trending payments now work.

## 5. Launch Pad contract on BNB Chain (remix.ethereum.org)
- [ ] Paste `contracts/AutistikLaunchpad.sol`, compile with **0.8.24**, optimizer **200**.
- [ ] Deploy with MetaMask on BNB Smart Chain (owner wallet):
  - `router_` `0x10ED43C718714eb63d5aA57B78B54704E256024E`
  - `treasury_` treasury address
  - `launchFee_` `10000000000000000` (0.01 BNB) · `maxFee_` `100000000000000000` (0.1 BNB)
  - `minLiquidity_` `100000000000000000` (0.1 BNB)
  - `stablecoin_` `0x55d398326f99059fF775485246999027B3197955`
  - `eligibilitySigner_` signer wallet's **address**
- [ ] Vercel: `NEXT_PUBLIC_LAUNCHPAD_BSC` = the new contract address → Redeploy.

## 6. Test with small amounts
- [ ] Launch a test token from a wallet holding $20+ of AUTISTIK, 0.1 BNB liquidity, **Lock 6 months**. Its page shows the unlock date.
- [ ] A wallet **without** AUTISTIK is refused.
- [ ] "Make it trend" with $20 of BNB. The BNB arrives in the treasury and the token shows **Promoted**.
- [ ] Register on `/fund`. The entry shows in Admin.

## 7. Move autistikk.com to the Hub
- [ ] Vercel → `autistik-hub-h6td` → Settings → Domains → add `autistikk.com` (and `www`).
- [ ] At your domain company, replace the old A / CNAME records with the ones Vercel shows. Leave email (MX/TXT) records alone.
- [ ] Supabase → Authentication → URL Configuration: Site URL `https://autistikk.com`, Redirect URLs `https://autistikk.com/auth/callback` and `https://www.autistikk.com/auth/callback`.
- [ ] Upload `AUTISTIK-Whitepaper.pdf` into the `public` folder on GitHub.

## 8. Before opening to the public
- [ ] Audit of `contracts/AutistikLaunchpad.sol` by a smart-contract auditor.
- [ ] Owner and treasury are a Safe multisig.
- [ ] Legal check in Ghana on charging launch and listing fees.

## Later
- Ethereum and Robinhood Chain: deploy the same contract there (README → "Turn it on for a chain") and set `NEXT_PUBLIC_LAUNCHPAD_ETHEREUM` / `NEXT_PUBLIC_LAUNCHPAD_ROBINHOOD`.
