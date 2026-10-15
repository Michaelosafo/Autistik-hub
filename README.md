# AUTISTIK Hub

**Autism is not a disease. It's a community.**

The community dApp for [$AUTISTIK](https://bscscan.com/address/0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9) on BNB Chain, built for autistic adults (18+):

- **Believer & Purity:** two AI companions (Claude API) with different personalities. They chat and draw pictures.
- **4 community groups:** Spectrum Lounge, Calm Corner, Spark Studio and Ask & Learn, each with 3 channels and live updates.
- **Live sessions:** talks, Q&As and support circles hosted by verified practitioners, with "Save my seat".
- **Points & airdrops:** points are counted by the database, wallets are verified by signature, and members claim on-chain with a Merkle proof.
- **Safety by design:** members use Hub names only, health data is never on-chain, chats aren't stored, there are content notes and reports, plus Calm mode and Larger text.

Stack: **Next.js 14** · **Supabase** (login, database, realtime) · **Claude API** · **viem** (wallets) · **Solidity** (airdrop contract).

---

## What it costs

| Service | What for | Cost |
|---|---|---|
| GitHub | Stores the code | Free |
| Vercel | Hosts the website | Free (Hobby plan) |
| Supabase | Login, database, live chat | Free up to ~50,000 monthly users |
| Claude API | Believer & Purity | Pay per use. Each member is capped at `AI_DAILY_LIMIT` messages/day (default 60) so your bill stays predictable. Check current prices at docs.claude.com |
| BNB Chain gas | Deploying the airdrop contract, setting roots | A few cents to a few dollars in BNB |

---

> **Going live?** Follow [`GO-LIVE.md`](GO-LIVE.md): one checklist with every setting for the Launch Pad, trending, the Fund and the autistik.io address.
> **Sign-up emails:** members join with email + password and confirm by email. Set it up with [`EMAIL-SETUP.md`](EMAIL-SETUP.md).

## Deploy it: step by step

You don't need to install anything on your computer for steps 1–6.

### 1. Put the code on GitHub
1. Go to **github.com → New repository**, name it `autistik-hub`, keep it **Private**, and create it.
2. Click **"uploading an existing file"**, drag in **everything inside this folder** (not the zip itself), and click **Commit changes**.

### 2. Create the database (Supabase)
1. Go to **supabase.com → New project**. Pick a region close to your members and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**.
3. (Optional) Run `supabase/seed.sql` the same way to add 3 example sessions.
4. Go to **Authentication → URL Configuration**:
   - **Site URL:** `https://autistik.io`
   - **Redirect URLs:** add `https://autistik.io/**`, `https://www.autistik.io/**` and `https://*.vercel.app/**`
   - Then follow [`EMAIL-SETUP.md`](EMAIL-SETUP.md) so sign-up emails reach members.
5. Go to **Project Settings → API** and copy the **Project URL**, the **anon public** key and the **service_role** key (keep that one secret).

### 3. Get a Claude API key
Go to **console.anthropic.com → API Keys → Create key**, add a payment method, and set a monthly spend limit under **Billing**.

### 4. Launch the website (Vercel)
1. Go to **vercel.com → Add New → Project → Import** your `autistik-hub` GitHub repo.
2. Before clicking Deploy, open **Environment Variables** and add every line from `.env.example` with your real values:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`
   - `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_TOKEN_ADDRESS`
   - leave `NEXT_PUBLIC_AIRDROP_CONTRACT` empty until step 7
3. Click **Deploy**. In about 2 minutes you get a live link like `autistik-hub.vercel.app`.

### 5. Website address
The Hub's address is **autistik.io**, bought and managed in Vercel (Project → Settings → Domains). The old autistikk.com is no longer used for the Hub.

### 6. Make yourself admin
1. Open your site, click **Sign in / Join**, and sign in with your email.
2. In Supabase **SQL Editor**, run (with your email):
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'you@example.com');
   ```
3. Refresh the site. **Admin** now appears in the menu: approve practitioners, add sessions, review reports, run rounds and download the airdrop CSV.

### 7. Airdrops (when you're ready for round 1)
**a) Deploy the claim contract once**
1. Open **remix.ethereum.org**, create `AutistikAirdrop.sol`, and paste in the separate `AutistikAirdrop.sol` download (it is not part of the website files).
2. Compile with Solidity **0.8.24**. Remix fetches the OpenZeppelin imports automatically.
3. In **Deploy**, choose **Injected Provider – MetaMask** on **BNB Smart Chain**, and enter:
   - `token_`: `0x483EC705AC912587Fe7cD75Caf3ecC0A118aA6a9`
   - `owner_`: your team's wallet. A multisig such as Safe is strongly recommended.
4. Deploy, copy the contract address, set it as `NEXT_PUBLIC_AIRDROP_CONTRACT` in Vercel, and redeploy.
5. **Important:** $AUTISTIK has a 3% buy / 4% sell tax. If the token contract lets its owner exclude addresses from fees, exclude the airdrop contract so members receive the full amount.

**b) Each round**
1. Admin → **Download CSV**. This gives every eligible wallet and its points.
2. Decide the token amount for each wallet (for example, share the pool by points) and add your holder-snapshot wallets. Save the file as `airdrops/round-1.csv` with columns `wallet,amount`, where amount is in whole tokens.
3. On a computer with Node.js 18+:
   ```bash
   npm install
   npm run merkle -- airdrops/round-1.csv 1
   ```
   This prints the **Merkle root** and writes `public/airdrops/current.json`.
4. Send the total amount of $AUTISTIK to the airdrop contract.
5. In Remix (or BscScan → Write Contract), call `setRoot(1, <root>)` from the owner wallet.
6. Commit `public/airdrops/current.json` to GitHub. Vercel redeploys, and eligible members now see **Claim now** on the Rewards page.
7. Admin → **Start a new round** resets everyone's points for the next round.

Get the contract reviewed by someone experienced before putting large amounts in it.

---

## Launch Pad

**AUTISTIK Launch Pad** has a token board (`/launchpad`: Trending, Most watched, New, with live prices from DexScreener), a page for every token (chart, Watch button, "Make it trend"), and the launch chat (`/launchpad/new`). Members launch their own token there. **Autistik**, the launch agent, asks the questions (chain, name, ticker, supply, their share, liquidity, and whether to lock the liquidity for 6 months, 1 year or burn it) and prepares a launch plan. Members can turn on **Voice** so Autistik reads each question out loud, and press **Speak** to answer with their microphone (works in Chrome, Edge and Safari). The member then signs **one transaction in their own wallet**. The site never holds anyone's keys or money.

That transaction calls the `AutistikLaunchpad` contract (`contracts/AutistikLaunchpad.sol`), which:
1. creates a plain token with a fixed supply (no tax, no minting, no owner, no blacklist),
2. sends the creator their share (0–20% of supply),
3. adds the rest as liquidity on PancakeSwap (BNB Chain), Uniswap (Ethereum) or a Uniswap V2 style DEX on Robinhood Chain,
4. handles the LP tokens the way the creator chose:
   - **Burn:** sent to the dead address `0x…dEaD`, so the liquidity stays forever. Nobody can remove it.
   - **Lock 6 months / Lock 1 year:** kept inside the Launch Pad contract until the date. After that, only the creator's wallet can take them back (the token page shows a button). The AUTISTIK team can never touch them.

**Who can launch:** the wallet must hold at least **$20 of AUTISTIK on BNB Chain** (change it with `NEXT_PUBLIC_LAUNCH_MIN_HOLD_USD`). When a member presses Launch, the Hub reads their AUTISTIK balance and the live price from DexScreener, and if it's enough it signs a permit that lasts 15 minutes. The contract refuses the launch without a valid permit for that exact wallet, so the AUTISTIK has to still be in the wallet at launch time. It is never spent or taken. This works for launches on Ethereum and Robinhood Chain too, because the same wallet address is used on every chain.

DexScreener picks up the pair automatically once it trades. Creators can add a logo and links at marketplace.dexscreener.com; the board then shows that logo too.

### Money: where fees go
- **Launch fee:** paid in BNB/ETH with every launch and sent straight to the `treasury_` wallet (your deployer wallet) you set when deploying.
- **Trending & listing:** anyone can pay **$20 worth of BNB** on BNB Chain to put a token at the top of Trending and in the rotating **Ad** slot for **24 hours** (paying again adds time). The box is under the launch chat, under the token board, and on every token page. It shows the wallet the BNB goes to: set it with `NEXT_PUBLIC_TREASURY_WALLET` (use your deployer/treasury wallet).
  - Tokens launched **somewhere else** can be listed this way too, as long as they have a trading pool on DexScreener. They show a **Listed** badge and a warning that the AUTISTIK team didn't check them.
  - The site converts $20 to BNB with the live BNB price. The server checks the payment on BNB Chain before anything shows: it must go to your wallet, be worth at least $20 (5% leeway for price moves), be under 2 days old, and each payment counts only once. Payments made with the Pay button carry the token address, so they can only count for that token.
  - Change the price or length with `NEXT_PUBLIC_TRENDING_USD` and `NEXT_PUBLIC_TRENDING_HOURS`, then redeploy.
- The contract's old USDT `promote` plans still work on-chain but the site no longer uses them.

### Turn it on for a chain
1. Run `supabase/launchpad.sql` in Supabase **SQL Editor** (only needed if you set up the database before the Launch Pad existed).
2. In **remix.ethereum.org**, create `AutistikLaunchpad.sol`, paste in `contracts/AutistikLaunchpad.sol`, and compile with Solidity **0.8.24** (optimizer on, 200 runs).
3. In **Deploy**, choose **Injected Provider – MetaMask**, switch MetaMask to the chain, and enter:

   | Field | BNB Chain | Ethereum |
   |---|---|---|
   | `router_` | `0x10ED43C718714eb63d5aA57B78B54704E256024E` (PancakeSwap V2) | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` (Uniswap V2) |
   | `treasury_` | **your wallet**: receives launch fees and trending payments | same |
   | `launchFee_` | fee in wei, e.g. `10000000000000000` = 0.01 BNB (`0` = free) | e.g. `2000000000000000` = 0.002 ETH |
   | `maxFee_` | highest fee you can ever set, e.g. `100000000000000000` = 0.1 | e.g. `20000000000000000` = 0.02 |
   | `minLiquidity_` | smallest pool allowed, e.g. `100000000000000000` = 0.1 BNB | e.g. `50000000000000000` = 0.05 ETH |
   | `stablecoin_` | `0x55d398326f99059fF775485246999027B3197955` (USDT) | `0xdAC17F958D2ee523a2206206994597C13D1ec7` (USDT) |
   | `eligibilitySigner_` | address of your permit-signing key (see below), or `0x0000000000000000000000000000000000000000` to switch the $20 AUTISTIK check off | same |

   For **Robinhood Chain**, use the Uniswap V2 compatible router and stablecoin addresses from Robinhood's official docs, and also set the `NEXT_PUBLIC_ROBINHOOD_*` values in Vercel.
   **Make the permit-signing key** (for the $20 AUTISTIK rule): create a brand-new wallet in MetaMask used for nothing else, export its private key, and add it in Vercel as `ELIGIBILITY_SIGNER_KEY`. Its address goes in `eligibilitySigner_`. It never needs coins. Don't reuse your treasury or owner wallet for this. If the key ever leaks, call `setEligibilitySigner` with a new address.
4. Copy the deployed address into Vercel as `NEXT_PUBLIC_LAUNCHPAD_BSC`, `NEXT_PUBLIC_LAUNCHPAD_ETHEREUM` or `NEXT_PUBLIC_LAUNCHPAD_ROBINHOOD`, then redeploy. Chains without an address show as "coming soon".
5. Use a multisig (such as Safe) as the owner and treasury, and get the contract reviewed by an auditor before promoting it. The owner can only change the fee (up to `maxFee_`), the treasury and the eligibility signer, never anyone's tokens or liquidity.
6. Already set up the database before? Run `supabase/launchpad.sql` again: it adds the `lp_lock` and `lp_unlock_at` columns.

---

## Buy page, Fund page and old links
- **`/buy`** has the How to Buy steps, the contract address, tokenomics, roadmap and community links from the old site. Edit them in `app/buy/page.tsx` and `lib/site.ts`.
- **`/fund`** has the AUTISTIK Fund page with a "Register your interest" form. Run `supabase/fund.sql` once in Supabase SQL Editor. Sign-ups appear at the bottom of **Admin**, with **Copy as CSV**.
- **Whitepaper:** upload `AUTISTIK-Whitepaper.pdf` into the `public` folder on GitHub (Add file → Upload files) so `autistik.io/AUTISTIK-Whitepaper.pdf` works.
- **`/autism`** is the "Understanding autism" guide from the old site.
- Old links redirect automatically: `/fund.html` → `/fund`, `/autism.html` → `/autism`, `/privacy.html` → `/safety`, `/index.html` → `/`.

## Trade page (referral links)
`/trade` (under **Trending**) shows live prices of top meme coins (DOGE, SHIB, PEPE, WIF, BONK, FLOKI) and buttons to big exchanges. To earn from it:
1. Join each exchange's referral or affiliate programme (e.g. Binance → Profile → Referral, or the Binance Affiliate Program) and copy your referral link.
2. In Vercel → Settings → Environment Variables, add it as `NEXT_PUBLIC_REF_BINANCE`, `NEXT_PUBLIC_REF_BYBIT`, `NEXT_PUBLIC_REF_OKX`, `NEXT_PUBLIC_REF_BITGET`, `NEXT_PUBLIC_REF_MEXC` or `NEXT_PUBLIC_REF_KUCOIN` (Type: Config), then redeploy.
Exchanges without a link still show, with a plain link. Change the coin list in `lib/trade.ts`.

## Using real photos
The site ships with original illustrations. To use real photos, add files to `public/photos/` and set their paths in `lib/site.ts`, for example `hero: { src: "/photos/hero.jpg", alt: "..." }`. Only use photos you have the rights to, with consent from everyone shown, especially when describing people as autistic.

## Run it on your computer (optional)
```bash
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                  # open http://localhost:3000
```
Add `http://localhost:3000/auth/callback` to Supabase Redirect URLs for local sign-in.

## Project map
```
app/
  page.tsx               Home: hero, companions, groups, faces, sessions
  companions/            Believer & Purity chat + picture making
  community/             4 groups × 3 channels, live feed
  sessions/              Live sessions, RSVPs, practitioner applications
  rewards/               Points, leaderboard, wallet link, claim
  launchpad/             Launch Pad board (trending, watched, new), token pages, launch chat with Autistik
  admin/                 Admin dashboard
  safety/                Promises, guidelines, crisis help
  login/, auth/callback  Email sign-in (magic link) with 18+ confirmation
  api/chat               Streams companion replies (Claude API)
  api/draw               Companion drawings (SVG)
  api/wallet             Verifies wallet signatures, saves wallets
  api/admin/airdrop      CSV of eligible wallets
  api/launchpad/agent    Autistik, the launch agent (Claude API)
  api/launchpad/record   Checks a launch on-chain and adds it to the public list
  api/launchpad/promote  Checks a trending payment on-chain and starts the trending slot
components/              UI pieces (Shell, Community, CompanionChat, …)
lib/                     Groups, companion personalities, illustrations, Supabase & AI helpers
supabase/schema.sql      Tables + Row Level Security (who can read/write what)
contracts/               AutistikLaunchpad.sol (token launches with locked liquidity)
scripts/build-merkle.mjs Builds each airdrop round
```

## How the safety rules are enforced
- **Row Level Security** in `supabase/schema.sql` means the database itself enforces the rules, not just the website:
  - only members who joined a group can post in it;
  - only admins can moderate, add sessions or verify practitioners;
  - wallets are visible only to their owner and admins, and only the server writes them after checking a signature.
- **Points** are calculated by a database view from real activity, so members can't edit them.
- **AI keys** stay on the server. Every chat and drawing needs a signed-in member and counts toward a daily limit.
- **AI drawings** are cleaned of scripts and links on the server and again in the browser before they're shown.

Nothing in the Hub is financial, legal or medical advice.
