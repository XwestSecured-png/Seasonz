# Seasonz — web app

Seasonz is a copy of the NFL prediction model web app under a new name, with its own database, repo, and API keys. See "Seasonz additions" at the bottom for invite codes, promo codes, legacy admins, and Odds API key rotation.

A real, standalone web app version of the NFL prediction model (the one that
used to live entirely in a Google Sheet + Apps Script). Built with:

- **Next.js** (App Router) — pages + API routes
- **Postgres** via **Drizzle ORM** — replaces the spreadsheet as the data store
- **Vercel Cron** — replaces Apps Script triggers for scheduled data refreshes
- A simple **shared-password** gate (no accounts/signup — just you + whoever
  you share the password with)

## What's here right now

This is a working first slice, not a 1:1 port of everything the Sheet did:

- ✅ Schedule sync, Elo ratings, team win/loss records — pulled live from
  [nflverse](https://github.com/nflverse/nflverse-data) (no API key needed)
- ✅ Injury Impact — grouped OUT / DOUBTFUL / GTD, with the same honest
  fallback text the Sheet used when a real win%-impact number isn't possible
  for a position
- ✅ Model Tracker — every final game graded against the model's own
  pre-game win probability
- ⬜ Odds comparison across sportsbooks, parlay auto-pick/grading, factor
  calibration — not ported yet (see "What's not here yet" below)

**Note on numbers:** the Elo model here uses standard public constants
(K-factor 20, home-field +65 Elo), not a re-derivation of the original
Sheet's exact tuning — see the comment in `lib/elo.ts`. Same for the QB-injury
win%-impact constant in `lib/injury-impact.ts`. Once Model Tracker has
accumulated real graded games, you can tune these yourself.

## Local development

Requires Node 20+ and a Postgres database (the sandbox this was built in
used a local Postgres — any Postgres works, including the Supabase/Neon one
you'll use in production).

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL, APP_PASSWORD, SESSION_SECRET
npx drizzle-kit migrate      # creates all tables
npm run dev
```

Visit `http://localhost:3000`, log in with your `APP_PASSWORD`, and click
**Sync now** on the dashboard to pull real data for the first time.

## Deploying (free-tier stack: Vercel + Supabase/Neon)

1. **Database**: create a free Postgres database on
   [Supabase](https://supabase.com) or [Neon](https://neon.tech). Copy its
   connection string.
2. **Push this code to a GitHub repo** (this folder is already a git repo —
   `git remote add origin <your-repo-url> && git push -u origin main`).
3. **Import the repo into [Vercel](https://vercel.com)** (New Project →
   import from GitHub).
4. **Set environment variables** in the Vercel project settings:
   - `DATABASE_URL` — your Supabase/Neon connection string
   - `APP_PASSWORD` — a real password for your private group
   - `SESSION_SECRET` — run `openssl rand -base64 32` locally and paste the
     result
   - `CRON_SECRET` — run `openssl rand -base64 32` again for a different
     value; Vercel automatically sends this as a bearer token when it fires
     the scheduled sync in `vercel.json`
   - `ODDS_API_KEY` — optional, leave blank for now (see below)
5. **Run the migration against your production database** once, from your
   machine: `DATABASE_URL="<your prod url>" npx drizzle-kit migrate`
6. Deploy. Vercel will automatically call `/api/sync` once a day per
   `vercel.json` (currently 10:00 UTC — edit that file to change the time).
7. Share the URL + `APP_PASSWORD` with whoever you want to have access.

## What's not here yet

Carried over from the Sheet version but not yet built in this app — these
are straightforward to add on top of this foundation, just not done in this
first pass:

- **Odds comparison / best-odds-by-platform / trap-line flagging** — the
  Sheet version used [The Odds API](https://the-odds-api.com) for real
  sportsbook lines (a free key covers 500 requests/month). Once you set
  `ODDS_API_KEY`, the `odds_lines` table and schema are ready for this;
  the fetch + comparison logic itself still needs porting.
- **Parlay auto-pick + user-defined combo grading** — the `parlay_picks`
  table is ready; the selection/grading logic isn't ported yet.
- **Factor Performance / calibration tracking** — the `factor_snapshots`
  table is ready; the tracking logic isn't ported yet.

## Project structure

```
app/
  (app)/            — authenticated pages (dashboard, injury-impact, model-tracker, elo-ratings)
  login/            — login page
  api/
    login, logout/  — session cookie endpoints
    sync/           — the data-refresh job (called by Vercel Cron or the "Sync now" button)
db/
  schema.ts         — Drizzle schema (all tables)
  migrations/       — generated SQL migrations
lib/
  nflverse.ts       — fetches schedule / injuries / player stats from nflverse
  elo.ts            — Elo rating engine
  injury-impact.ts  — injury impact estimation (ported from the Sheet's logic)
  sync.ts           — orchestrates a full data refresh, logs to sync_runs
  auth.ts           — shared-password session cookie signing/verification
proxy.ts            — auth gate (Next.js 16's replacement for middleware.ts)
```

---

## Seasonz additions

### Setup on a fresh database
1. Create a new Supabase project and copy its pooled connection string into `DATABASE_URL`.
2. Run every file in `db/migrations/` in order (0000 → 0024), e.g. `npx drizzle-kit migrate`.
3. In Vercel, set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_USERNAMES=<your username>`, and a temporary `APP_PASSWORD` (a master invite code).
4. Sign up with the `APP_PASSWORD` code, open **Admin**. You'll be an admin and a legacy admin.
5. Generate invite codes for each platform, then clear `APP_PASSWORD` so only the rotating codes work.

### Invite codes (Admin → Invite codes)
- Each platform (iPhone/iPad, Android, Desktop/web) has its own list of codes.
- Every load of the Admin page shows the next code in each list, so it's different each time.
- Any active code works at sign-up. Set `INVITE_CODE_STRICT_PLATFORM=true` to require the code to match the device.

### Admins
- **Regular admins**: unlimited.
- **Legacy admins**: max 5. Only legacy admins can appoint/remove legacy admins, give the final promo approval, revoke active promo codes, or change a legacy admin's account. At least one legacy admin always remains.

### Promo codes (Admin → Promo codes)
- 3, 6, 9, or 12 months of free Pro or Super Pro; set how many people can use each code.
- Approval chain: created → approved by an admin who didn't create it → final approval by a legacy admin who didn't give the first approval → active.
- Users redeem on the **Upgrade** page. Free time stacks on top of remaining free time of the same plan, and never touches a Stripe subscription.

### Odds key rotation (Admin → Odds keys)
- `ODDS_API_KEYS_FREE` (The Odds API, comma-separated) and optional `PROPLINE_API_KEYS_FREE` are used first, in order.
- `PROPLINE_API_KEY` (paid) is used only after every free key is out.
- Remaining requests per key come from each response's quota headers and show on the Admin page. Out-of-quota keys are skipped until their reset.

### Patch notes (What's new)
- Release notes live in `lib/changelog.ts`. To ship an update, add a new release at the top with a higher version, and write each change as **What changed** + **What it means** for users. Mark admin-only items `audience: "admin"`.
- Anyone who hasn't seen the newest release gets a banner linking to **What's new** (`/whats-new`). Dismissing it or opening the page hides it until the next release.

### "What it means" (betting help)
- `/learn` explains reading odds, Moneyline, Spread, Over/Under, Alternate lines, player props, parlays, and pushes, with a playground to try any bet.
- Bet Tracker shows a live "What it means" box while you build a bet (what score you need, push rules, payout, implied odds, and whether you're on an alternate line), and on every open bet.
- Parlays and Props pages have their own "What it means" sections.
- The wording comes from `lib/bet-explainer.ts`.
