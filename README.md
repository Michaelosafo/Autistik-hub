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
   - **Site URL:** `https://autistikk.com` (or your Vercel address for now)
   - **Redirect URLs:** add `https://autistikk.com/auth/callback` and `https://*.vercel.app/auth/callback`
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

### 5. Connect autistikk.com
In Vercel go to **Project → Settings → Domains → Add**. You have two choices:
- **`hub.autistikk.com`** (recommended): keeps your current site and adds the Hub beside it. Add the CNAME record Vercel shows you at your domain registrar.
- **`autistikk.com`**: replaces your current site with the Hub. Copy any pages you want to keep (whitepaper, fund page) into `/public` first.

Then update the Supabase **Site URL** and **Redirect URLs** (step 2.4) to the domain you chose.

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
  admin/                 Admin dashboard
  safety/                Promises, guidelines, crisis help
  login/, auth/callback  Email sign-in (magic link) with 18+ confirmation
  api/chat               Streams companion replies (Claude API)
  api/draw               Companion drawings (SVG)
  api/wallet             Verifies wallet signatures, saves wallets
  api/admin/airdrop      CSV of eligible wallets
components/              UI pieces (Shell, Community, CompanionChat, …)
lib/                     Groups, companion personalities, illustrations, Supabase & AI helpers
supabase/schema.sql      Tables + Row Level Security (who can read/write what)
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
