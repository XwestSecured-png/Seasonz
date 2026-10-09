import {
  pgTable,
  serial,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Teams — static reference data (32 NFL teams).
// ---------------------------------------------------------------------------
export const teams = pgTable("teams", {
  abbr: text("abbr").primaryKey(), // e.g. "KC", "SF"
  name: text("name").notNull(), // e.g. "Kansas City Chiefs"
  conference: text("conference"), // "AFC" | "NFC"
  division: text("division"), // e.g. "West"
});

// ---------------------------------------------------------------------------
// Games — one row per scheduled/played game. Mirrors the Scheduler main sheet.
// ---------------------------------------------------------------------------
export const games = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    gameDate: date("game_date"),
    // Real kickoff instant in UTC (see lib/time.ts) — gameDate above is just
    // the calendar day, with no time component, so this is what the
    // 5-minutes-before-kickoff pick lock (Model Tracker) actually checks
    // against. Null until nflverse publishes a gametime for the game.
    kickoffAt: timestamp("kickoff_at"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    isFinal: boolean("is_final").notNull().default(false),
    // Elo snapshot at kickoff (pre-game), and the model's pre-game home win
    // probability derived from it — written once, never recomputed after
    // the game is final, so Model Tracker can grade against the real
    // pre-game call rather than a post-hoc one.
    eloHomePre: real("elo_home_pre"),
    eloAwayPre: real("elo_away_pre"),
    // homeWinPctPre is the model's FINAL pre-game call — raw Elo win% plus
    // the weather/referee nudges below, all baked in once at kickoff and
    // graded as a single number (see lib/weather.ts, lib/referee.ts).
    homeWinPctPre: real("home_win_pct_pre"),
    roof: text("roof"),
    surface: text("surface"),
    tempF: integer("temp_f"),
    windMph: integer("wind_mph"),
    // True when tempF/windMph above came from an Open-Meteo pre-game
    // forecast (lib/weather-forecast.ts) rather than nflverse's own
    // post-game actuals — only ever set for a game that hasn't been played
    // yet. Once nflverse publishes the real reading, the schedule sync
    // overwrites both columns with the actual value and flips this back to
    // false. Purely a display label (see FactorsCell in model-tracker) —
    // doesn't change how weatherAdjPct itself is computed.
    weatherIsForecast: boolean("weather_is_forecast").notNull().default(false),
    // Rain/snow chance (0-100), forecast-only (see weatherIsForecast above)
    // — nflverse has no post-game precipitation field, so this is always
    // null for a final game. Folded into weatherAdjPct as a third severity
    // dimension alongside wind/cold (lib/weather.ts).
    precipPct: real("precip_pct"),
    referee: text("referee"),
    weatherAdjPct: real("weather_adj_pct"),
    // Short-rest + travel-distance nudge (lib/rest-travel.ts) — positive
    // means it favored the home team (either more rest, or the away team
    // traveled further), negative the reverse.
    restTravelAdjPct: real("rest_travel_adj_pct"),
    refAdjPct: real("ref_adj_pct"),
    // Six more season-to-date team factors, same small-and-capped treatment
    // (see lib/team-matchup.ts) — all zero until both teams have played
    // enough games to trust a season average.
    schemeOffAdjPct: real("scheme_off_adj_pct"),
    schemeDefAdjPct: real("scheme_def_adj_pct"),
    turnoverAdjPct: real("turnover_adj_pct"),
    penaltyAdjPct: real("penalty_adj_pct"),
    trenchesAdjPct: real("trenches_adj_pct"),
    aggressionAdjPct: real("aggression_adj_pct"),
    // Seasonz: Next Gen Stats receiver separation + PFR pressure factors
    // (lib/ngs.ts, lib/ngs-matchup.ts).
    ngsSeparationAdjPct: real("ngs_separation_adj_pct"),
    pressureAdjPct: real("pressure_adj_pct"),
    // ESPN's own analyst metrics — Football Power Index and Total QBR, same
    // small-and-capped treatment (see lib/espn-factors.ts). fpi/sos/qbr raw
    // values are stored for display even though only fpiAdjPct/qbrAdjPct are
    // actually applied to homeWinPctPre; sos is informational only (not
    // weighted — see lib/espn-factors.ts for why).
    fpiHome: real("fpi_home"),
    fpiAway: real("fpi_away"),
    sosHome: real("sos_home"),
    sosAway: real("sos_away"),
    qbrHome: real("qbr_home"),
    qbrAway: real("qbr_away"),
    fpiAdjPct: real("fpi_adj_pct"),
    qbrAdjPct: real("qbr_adj_pct"),
    // Current week's injury-report win% impact (see lib/injury-impact.ts and
    // lib/injury-adjustment.ts), folded in as its own capped nudge — only
    // ever nonzero for a team's actual next upcoming game, never backfilled
    // onto already-final games (the injury report itself has no history).
    // The two raw per-team sums are stored for tooltip display even though
    // only the signed, capped injuryAdjPct is applied to homeWinPctPre.
    homeInjuryImpactPct: real("home_injury_impact_pct"),
    awayInjuryImpactPct: real("away_injury_impact_pct"),
    injuryAdjPct: real("injury_adj_pct"),
    // Best available moneyline for this game, plus the model's own "value"
    // read on it: edgePct is (model home win% - book's implied home win%),
    // signed toward home; a pick only exists when that edge clears the same
    // minimum-edge bar used for player props (see lib/game-picks.ts) — a raw
    // Elo favorite with no real edge over the book is left as "no pick".
    moneylineHomeOdds: integer("moneyline_home_odds"),
    moneylineAwayOdds: integer("moneyline_away_odds"),
    moneylineBook: text("moneyline_book"),
    // The FIRST odds ever seen for this game — set once, never overwritten —
    // so Model Tracker can compare against moneylineHomeOdds/AwayOdds (which
    // keep updating to the latest/closing line) and show closing-line value:
    // did the market move toward or away from the model's pick since it was
    // first priced? See closingLineValuePct in app/(app)/model-tracker/page.tsx.
    openingMoneylineHomeOdds: integer("opening_moneyline_home_odds"),
    openingMoneylineAwayOdds: integer("opening_moneyline_away_odds"),
    openingMoneylineBook: text("opening_moneyline_book"),
    aiEdgePct: real("ai_edge_pct"),
    aiPickTeam: text("ai_pick_team"), // team abbr, or null when no real edge

    // Point spread market (ATS) — spreadHomeLine is home-perspective, so a
    // negative number means the home team is favored (matching how books
    // quote it, e.g. -3.5). See lib/spread-total-picks.ts for how
    // spreadAiEdgePct/spreadAiPickTeam are derived from homeWinPctPre.
    spreadHomeLine: real("spread_home_line"),
    spreadHomePriceAmerican: integer("spread_home_price_american"),
    spreadAwayPriceAmerican: integer("spread_away_price_american"),
    spreadBook: text("spread_book"),
    openingSpreadHomeLine: real("opening_spread_home_line"),
    openingSpreadHomePriceAmerican: integer("opening_spread_home_price_american"),
    openingSpreadAwayPriceAmerican: integer("opening_spread_away_price_american"),
    openingSpreadBook: text("opening_spread_book"),
    spreadAiEdgePct: real("spread_ai_edge_pct"),
    spreadAiPickTeam: text("spread_ai_pick_team"), // "HOME" | "AWAY" | null

    // Game total market (O/U). totalAiEdgePct is signed toward the OVER (see
    // lib/spread-total-picks.ts for why its stdev is a documented approximation).
    totalLine: real("total_line"),
    totalOverPriceAmerican: integer("total_over_price_american"),
    totalUnderPriceAmerican: integer("total_under_price_american"),
    totalBook: text("total_book"),
    openingTotalLine: real("opening_total_line"),
    openingTotalOverPriceAmerican: integer("opening_total_over_price_american"),
    openingTotalUnderPriceAmerican: integer("opening_total_under_price_american"),
    openingTotalBook: text("opening_total_book"),
    totalAiEdgePct: real("total_ai_edge_pct"),
    totalAiPick: text("total_ai_pick"), // "OVER" | "UNDER" | null

    // Unified recommendation: whichever of {moneyline, spread, total} has the
    // single biggest edge over the book for this game (see
    // lib/spread-total-picks.ts#pickBestMarket) — what Model Tracker leads
    // with instead of three separate numbers.
    bestMarket: text("best_market"), // "ML" | "SPREAD" | "TOTAL" | null
    bestMarketLabel: text("best_market_label"), // e.g. "KC -3.5", "KC ML", "Over 47.5"
    bestMarketEdgePct: real("best_market_edge_pct"),
    // The model's own win probability for the Best Bet pick specifically —
    // becomes the 0-100 confidence badge (lib/confidence.ts) and feeds Kelly
    // stake sizing (lib/stake-sizing.ts).
    bestMarketConfidencePct: real("best_market_confidence_pct"),

    // The user's own call for this game (shared across the household — this
    // app has no per-person accounts), set any time before kickoff via the
    // toggle on Model Tracker.
    userPickTeam: text("user_pick_team"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    seasonWeekTeams: uniqueIndex("games_season_week_teams_idx").on(
      t.season,
      t.week,
      t.homeTeam,
      t.awayTeam
    ),
  })
);

// ---------------------------------------------------------------------------
// Team Elo ratings — current rating per team, plus a lightweight history so
// trend charts are possible without replaying the whole season every time.
// ---------------------------------------------------------------------------
export const teamEloRatings = pgTable(
  "team_elo_ratings",
  {
    id: serial("id").primaryKey(),
    team: text("team").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    rating: real("rating").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
  },
  (t) => ({
    teamSeasonWeek: uniqueIndex("team_elo_ratings_team_season_week_idx").on(
      t.team,
      t.season,
      t.week
    ),
  })
);

// ---------------------------------------------------------------------------
// Team metrics — per-team, per-week aggregate performance factors used by
// the model (offensive/defensive efficiency, turnovers, etc.).
// ---------------------------------------------------------------------------
export const teamMetrics = pgTable(
  "team_metrics",
  {
    id: serial("id").primaryKey(),
    team: text("team").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    offEpaPerPlay: real("off_epa_per_play"),
    defEpaPerPlay: real("def_epa_per_play"),
    turnoverMargin: real("turnover_margin"),
    homeWinPct: real("home_win_pct"),
    roadWinPct: real("road_win_pct"),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    ties: integer("ties").notNull().default(0),
  },
  (t) => ({
    teamSeasonWeek: uniqueIndex("team_metrics_team_season_week_idx").on(
      t.team,
      t.season,
      t.week
    ),
  })
);

// ---------------------------------------------------------------------------
// Injury reports — one row per injured player per week, grouped by status.
// Mirrors the Injury Impact tab, including the honest fallback text when a
// real win%-impact estimate isn't possible for that position.
// ---------------------------------------------------------------------------
export const injuryReports = pgTable("injury_reports", {
  id: serial("id").primaryKey(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  status: text("status").notNull(), // "OUT" | "DOUBTFUL" | "QUESTIONABLE"
  isEstimate: boolean("is_estimate").notNull().default(false), // practice-status early estimate, not yet official
  team: text("team").notNull(),
  player: text("player").notNull(),
  position: text("position"),
  nextOpponent: text("next_opponent"),
  gameMissedLabel: text("game_missed_label"), // e.g. "Wk 4 — 10/01/2026"
  anticipatedReturn: text("anticipated_return"),
  method: text("method").notNull(), // "QB change (backtested)" | "EPA share estimate" | honest fallback text
  seasonEpaShare: real("season_epa_share"),
  winPctWithPlayer: real("win_pct_with_player"),
  winPctWithoutPlayer: real("win_pct_without_player"),
  winPctImpact: real("win_pct_impact"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Model tracker — one row per graded prediction, resolved after the game.
// ---------------------------------------------------------------------------
export const modelTracker = pgTable("model_tracker", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => games.id),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  predictedWinner: text("predicted_winner"),
  predictedHomeWinPct: real("predicted_home_win_pct"),
  actualWinner: text("actual_winner"),
  result: text("result"), // "CORRECT" | "WRONG" | "N/A"
  gradedAt: timestamp("graded_at"),
});

// ---------------------------------------------------------------------------
// Factor snapshots / performance — tracks whether individual model factors
// (off efficiency, def efficiency, turnovers, etc.) actually predicted
// outcomes, resolved once real results exist.
// ---------------------------------------------------------------------------
export const factorSnapshots = pgTable(
  "factor_snapshots",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    gameId: integer("game_id").references(() => games.id),
    // One row per (game, factor) — "WEATHER" | "REFEREE" | "SCHEME_OFF" |
    // "SCHEME_DEF" | "TURNOVER" | "PENALTY" | "TRENCHES" | "AGGRESSION" |
    // "FPI" | "QBR" | "INJURY". Written once per game whenever that factor's
    // adjustment is nonzero (see the "elo" stage in lib/sync.ts), then
    // graded once the game goes final (see the "factorGrading" stage) — this
    // is the per-factor calibration tracker ("AI learning sheet").
    factor: text("factor").notNull(),
    favoredTeam: text("favored_team"),
    resolved: boolean("resolved").notNull().default(false),
    correct: boolean("correct"),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (t) => ({
    seasonWeekGameFactor: uniqueIndex("factor_snapshots_season_week_game_factor_idx").on(
      t.season,
      t.week,
      t.gameId,
      t.factor
    ),
  })
);

// ---------------------------------------------------------------------------
// Odds lines — sportsbook lines pulled from a real odds API, plus whatever
// a user hand-enters. Mirrors the Odds Input tab.
// ---------------------------------------------------------------------------
export const oddsLines = pgTable(
  "odds_lines",
  {
    id: serial("id").primaryKey(),
    season: integer("season"),
    week: integer("week"),
    player: text("player"),
    team: text("team"),
    statType: text("stat_type"),
    line: real("line"),
    // Our model's recommended side for this line, with its own price below —
    // not a raw Over/Under listing of both book prices.
    side: text("side"), // "Over" | "Under"
    book: text("book"), // "DraftKings" | "FanDuel" | "MyBookie" | etc.
    priceAmerican: integer("price_american"),
    impliedProbPct: real("implied_prob_pct"),
    // The model's own per-game projection for this stat, and the resulting
    // edge vs. the book's line ((projection - line) / line).
    projection: real("projection"),
    edgePct: real("edge_pct"),
    // The model's real statistical win chance for `side` (see
    // lib/props-model.ts's winProbability) — distinct from impliedProbPct
    // above, which is what the SPORTSBOOK's price implies. This is what the
    // app's 70%-confidence filter actually checks. Null for rows written
    // before this column existed.
    modelWinPct: real("model_win_pct"),
    source: text("source"), // "LIVE" | "MANUAL"
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => ({
    seasonWeekPlayerStatBook: uniqueIndex("odds_lines_season_week_player_stat_book_idx").on(
      t.season,
      t.week,
      t.player,
      t.statType,
      t.book
    ),
  })
);

// Every raw per-book player-prop line fetched during a sync, win or lose on
// edge — unlike oddsLines (which only keeps the lines that cleared the
// model's edge threshold), this keeps every book's price for every line so
// the Props page can show a side-by-side "which book pays best" comparison
// even for props that aren't flagged as a model edge.
export const propLinesRaw = pgTable(
  "prop_lines_raw",
  {
    id: serial("id").primaryKey(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    player: text("player").notNull(),
    team: text("team"),
    statType: text("stat_type").notNull(),
    line: real("line").notNull(),
    side: text("side").notNull(), // "Over" | "Under"
    book: text("book").notNull(),
    priceAmerican: integer("price_american").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => ({
    seasonWeekPlayerStatLineSideBook: uniqueIndex("prop_lines_raw_idx").on(
      t.season,
      t.week,
      t.player,
      t.statType,
      t.line,
      t.side,
      t.book
    ),
  })
);

// ---------------------------------------------------------------------------
// Parlay picks — auto-selected combos (model-confidence based) and
// user-defined combos (manually entered legs + computed grading). A "user"
// kind parlay's legs can be ANY bet the person typed in (not limited to the
// model's own picks) — each leg carries its own result ("pending" | "won" |
// "lost" | "push") inside the legs jsonb, set by hand from the Parlays page
// once the games finish, and the parlay's own `status` is derived from them.
// ---------------------------------------------------------------------------
export const parlayPicks = pgTable("parlay_picks", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // "auto" | "user"
  userId: integer("user_id").references(() => users.id),
  username: text("username"), // snapshot, so a parlay still reads sensibly if the account is later removed
  title: text("title"), // optional label the person gives their own parlay, e.g. "Sunday slate"
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  size: integer("size").notNull(),
  legs: jsonb("legs").notNull(), // array of {label, priceAmerican, winPct, result, ...}
  combinedWinPct: real("combined_win_pct"),
  weakestLegWinPct: real("weakest_leg_win_pct"),
  confidence: text("confidence"), // "High" | "Moderate" | "Low"
  status: text("status").notNull().default("pending"), // "pending" | "won" | "lost" — derived from leg results for "user" kind
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Users — real per-person accounts. Signup requires the shared invite code
// (the APP_PASSWORD env var — repurposed as a "you're one of us" gate so no
// new env var is needed), after which each person sets their own username +
// password for everyday login. See lib/auth.ts.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    // Optional — used only to turn a suggested stake PERCENTAGE (see
    // lib/stake-sizing.ts) into a suggested dollar amount on Bet Tracker.
    // Null means "not set"; pages fall back to showing percentage only.
    bankrollUsd: real("bankroll_usd"),
    createdAt: timestamp("created_at").notNull().defaultNow(),

    // --- Subscription tier (see lib/tiers.ts) ---------------------------
    // "free" | "pro" | "super_pro" — not a Postgres enum so a new tier
    // never needs a migration, just a new value in lib/tiers.ts's Tier
    // union. Changed either by the Stripe webhook/checkout flow
    // (lib/stripe.ts, app/api/stripe/*) or by hand from the admin
    // dashboard (app/(app)/admin) — an admin-set tier has no Stripe
    // subscription behind it (stripeSubscriptionId stays null), which is
    // the intended way to comp an account.
    tier: text("tier").notNull().default("free"),
    tierUpdatedAt: timestamp("tier_updated_at"),
    // Stripe's own customer/subscription ids — null until this user has
    // ever started a real (non-admin-comped) subscription. Kept even after
    // a cancellation so re-subscribing reuses the same Stripe customer
    // rather than creating a duplicate.
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    // Stripe's own subscription status string verbatim ("active",
    // "past_due", "canceled", "trialing", "incomplete", etc. — see
    // Stripe's Subscription.status), mirrored here so pages can show
    // billing state without an extra Stripe API call. Null when there's
    // no subscription (free, or admin-comped).
    subscriptionStatus: text("subscription_status"),

    // --- Identity verification (Stripe Identity — lib/stripe.ts,
    // app/api/stripe/identity) ------------------------------------------
    // "unverified" | "pending" | "verified" | "failed" — not a Postgres
    // enum for the same reason tier isn't. Set from the
    // identity.verification_session.* webhook events.
    identityStatus: text("identity_status").notNull().default("unverified"),
    stripeIdentitySessionId: text("stripe_identity_session_id"),

    // --- Admin access (see lib/entitlements.ts, app/(app)/admin) --------
    isAdmin: boolean("is_admin").notNull().default(false),
    // Set from the admin dashboard's "Ban" action — a banned account is
    // treated as signed out everywhere (lib/current-user.ts returns null
    // for it) and can't log back in (app/api/login/route.ts rejects it),
    // without deleting their row or history.
    isBanned: boolean("is_banned").notNull().default(false),

    // --- Seasonz: legacy admins (see lib/admin-roles.ts) ----------------
    // A legacy admin is a protected, senior admin: at most 5 at a time
    // (MAX_LEGACY_ADMINS), the only ones who can give the second approval
    // on a promo code, and the only ones who can demote/ban/delete another
    // legacy admin. Always also isAdmin. Regular admins are unlimited.
    isLegacyAdmin: boolean("is_legacy_admin").notNull().default(false),

    // --- Seasonz: promo-code free time (see lib/promo.ts) ---------------
    // A redeemed, fully approved promo code grants promoTier until
    // promoExpiresAt. The effective tier (lib/current-user.ts) is the
    // higher of `tier` and an unexpired promoTier, so promo time never
    // overwrites or interferes with a real Stripe subscription.
    promoTier: text("promo_tier"),
    promoExpiresAt: timestamp("promo_expires_at"),

    // --- Seasonz: which platform invite code created this account -------
    signupPlatform: text("signup_platform"),
    signupInviteCodeId: integer("signup_invite_code_id"),

    // --- Seasonz: patch notes (lib/changelog.ts) -------------------------
    // The newest release version this user has seen/dismissed. When it's
    // behind the latest release, the app shows the "What's new" banner.
    lastSeenUpdate: text("last_seen_update"),
  },
  (t) => ({
    usernameIdx: uniqueIndex("users_username_idx").on(t.username),
  })
);

// ---------------------------------------------------------------------------
// App-wide settings the admin dashboard can edit without a code change —
// currently just the Free-tier limits and the displayed Pro/Super Pro
// prices (see lib/tiers.ts's AppLimits and lib/app-settings.ts). A single
// row keyed "limits" holding the whole AppLimits object as JSON, rather than
// one column per setting, so adding a new limit later is a lib/tiers.ts
// change only — no migration needed.
// ---------------------------------------------------------------------------
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Per-user game picks — replaces the old single shared games.userPickTeam
// now that there are real accounts; each person has their own pick per game.
// (games.userPickTeam is left in place, unused, rather than dropped.)
// ---------------------------------------------------------------------------
export const userPicks = pgTable(
  "user_picks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id),
    team: text("team").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userGameIdx: uniqueIndex("user_picks_user_game_idx").on(t.userId, t.gameId),
  })
);

// ---------------------------------------------------------------------------
// Feedback — structured bug reports / ideas / questions submitted from the
// feedback widget on every page. Visible to the whole group (small private
// app, no admin role) so everyone can see what's already been reported.
// ---------------------------------------------------------------------------
export const feedback = pgTable("feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  username: text("username"), // snapshot at submit time
  page: text("page"), // which page the person was on when they submitted
  category: text("category").notNull(), // "Bug" | "Idea" | "Question" | "Other"
  message: text("message").notNull(),
  status: text("status").notNull().default("new"), // "new" | "reviewed"
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Sync runs — a log of scheduled/manual data-sync jobs, standing in for the
// Apps Script execution log the Google Sheet version relied on.
// ---------------------------------------------------------------------------
export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  stage: text("stage").notNull(),
  status: text("status").notNull(), // "ok" | "error" | "skipped"
  detail: text("detail"),
});

// ---------------------------------------------------------------------------
// User bets — a personal bet tracker. Each row is a bet the person says they
// actually placed (not just a model pick) — stake, price, and line are
// frozen at logging time so later line movement never retroactively changes
// what was actually bet. Graded automatically once the game goes final (see
// lib/bet-grading.ts and the "gradeBets" stage in lib/sync.ts).
// ---------------------------------------------------------------------------
export const userBets = pgTable("user_bets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  market: text("market").notNull(), // "ML" | "SPREAD" | "TOTAL"
  selection: text("selection").notNull(), // team abbr for ML/SPREAD, "OVER" | "UNDER" for TOTAL
  line: real("line"), // spread/total line at the time this bet was placed; null for ML
  priceAmerican: integer("price_american").notNull(),
  stakeUsd: real("stake_usd").notNull(),
  result: text("result").notNull().default("PENDING"), // "PENDING" | "WON" | "LOST" | "PUSH"
  payoutUsd: real("payout_usd"), // net profit (positive) or loss (negative); 0 on push; null while pending
  placedAt: timestamp("placed_at").notNull().defaultNow(),
  gradedAt: timestamp("graded_at"),
});

// ---------------------------------------------------------------------------
// Line history — an append-only snapshot of each market's line every time it
// CHANGES during a sync (not every sync — see lib/sync.ts's gameOdds stage),
// so Model Tracker can show how a line has moved since it opened, and Bet
// Tracker can compute personal CLV against whatever the line was at
// placement time rather than only the final opening/closing pair.
// ---------------------------------------------------------------------------
export const lineHistory = pgTable("line_history", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id")
    .notNull()
    .references(() => games.id),
  market: text("market").notNull(), // "ML" | "SPREAD" | "TOTAL"
  line: real("line"), // spread home line or total line; null for ML
  homePriceAmerican: integer("home_price_american"), // or OVER price for TOTAL
  awayPriceAmerican: integer("away_price_american"), // or UNDER price for TOTAL
  recordedAt: timestamp("recorded_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Multi-sport tables (NBA/NHL/MLB/NCAAF/NCAAB) — everything above this point
// is the original NFL-only schema (games, teamEloRatings, teamMetrics,
// injuryReports, factorSnapshots) and stays untouched; NFL keeps its own
// nflverse-fed pipeline exactly as it was. These generic, `sport`-keyed
// tables are a parallel pipeline for every OTHER sport, fed by ESPN's public
// site API (lib/sports/espn.ts) instead of nflverse. They're intentionally
// more generic than the NFL tables: instead of one fixed column per factor
// (weatherAdjPct, schemeOffAdjPct, ...) — which only make sense for
// football — per-sport factor numbers live in a `factors` jsonb blob, so
// adding e.g. NHL's goalie-starter adjustment later never needs a migration.
// `sport` is always one of "nba" | "nhl" | "mlb" | "ncaaf" | "ncaab" (see
// lib/sports/types.ts's SportKey) — enforced in application code, not a DB
// enum, so adding a sixth sport later is also just a code change.
// ---------------------------------------------------------------------------

export const sportTeams = pgTable(
  "sport_teams",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    abbr: text("abbr").notNull(), // ESPN's own team abbreviation for this sport — used as-is, not remapped to NFL-style codes
    name: text("name").notNull(),
    conference: text("conference"),
    division: text("division"),
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),
    espnTeamId: text("espn_team_id"), // ESPN's internal numeric team id (as a string) — what its schedule/roster endpoints actually key on
  },
  (t) => ({
    sportAbbrIdx: uniqueIndex("sport_teams_sport_abbr_idx").on(t.sport, t.abbr),
  })
);

export const sportGames = pgTable(
  "sport_games",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    // ESPN's event id for this game — the one truly stable, collision-free
    // key across any sport (including same-day doubleheaders in MLB, which
    // a (sport, teams, date) composite key would not handle). Every row is
    // upserted on (sport, espnEventId); season/week below are for display
    // and grouping only, never used to dedupe.
    espnEventId: text("espn_event_id").notNull(),
    season: integer("season").notNull(),
    // For NCAAF, this is ESPN's own real week number. For NBA/NHL/MLB/NCAAB
    // (which don't have "weeks" the way football does), this is an
    // ISO-week-of-season bucket computed at sync time purely so the existing
    // week-by-week UI pattern (NextStep/SectionNote/"this week's games")
    // still works — see lib/sports/espn.ts's weekBucketFor.
    week: integer("week").notNull(),
    gameDate: date("game_date"),
    kickoffAt: timestamp("kickoff_at"),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    isFinal: boolean("is_final").notNull().default(false),
    neutralSite: boolean("neutral_site").notNull().default(false),
    eloHomePre: real("elo_home_pre"),
    eloAwayPre: real("elo_away_pre"),
    // Model's final pre-game home win probability — raw Elo win% plus
    // whatever this sport's own factors/ module folds in (rest/back-to-back
    // for NBA/NHL, starter for MLB, etc. — see lib/sports/<sport>/factors.ts
    // as each sport's factor model lands).
    homeWinPctPre: real("home_win_pct_pre"),
    restDaysHome: integer("rest_days_home"),
    restDaysAway: integer("rest_days_away"),
    restAdjPct: real("rest_adj_pct"),
    homeInjuryImpactPct: real("home_injury_impact_pct"),
    awayInjuryImpactPct: real("away_injury_impact_pct"),
    injuryAdjPct: real("injury_adj_pct"),
    moneylineHomeOdds: integer("moneyline_home_odds"),
    moneylineAwayOdds: integer("moneyline_away_odds"),
    moneylineBook: text("moneyline_book"),
    spreadHomeLine: real("spread_home_line"),
    spreadHomePriceAmerican: integer("spread_home_price_american"),
    spreadAwayPriceAmerican: integer("spread_away_price_american"),
    spreadBook: text("spread_book"),
    totalLine: real("total_line"),
    totalOverPriceAmerican: integer("total_over_price_american"),
    totalUnderPriceAmerican: integer("total_under_price_american"),
    totalBook: text("total_book"),
    bestMarket: text("best_market"), // "ML" | "SPREAD" | "TOTAL" | null
    bestMarketLabel: text("best_market_label"),
    bestMarketEdgePct: real("best_market_edge_pct"),
    bestMarketConfidencePct: real("best_market_confidence_pct"),
    // Sport-specific extras that don't warrant their own column yet (e.g.
    // NBA pace, MLB starting pitchers, NHL goalie starters) — see each
    // sport's lib/sports/<sport>/factors.ts for the shape it writes here.
    extra: jsonb("extra"),
  },
  (t) => ({
    sportEventIdx: uniqueIndex("sport_games_sport_event_idx").on(t.sport, t.espnEventId),
  })
);

export const sportEloRatings = pgTable(
  "sport_elo_ratings",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    team: text("team").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    rating: real("rating").notNull(),
    gamesPlayed: integer("games_played").notNull().default(0),
  },
  (t) => ({
    sportTeamSeasonWeek: uniqueIndex("sport_elo_ratings_sport_team_season_week_idx").on(
      t.sport,
      t.team,
      t.season,
      t.week
    ),
  })
);

export const sportTeamMetrics = pgTable(
  "sport_team_metrics",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    team: text("team").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    ties: integer("ties").notNull().default(0),
    homeWinPct: real("home_win_pct"),
    roadWinPct: real("road_win_pct"),
    // Sport-specific advanced stats (NBA: offRtg/defRtg/pace; NHL: corsi/PP%;
    // MLB: runs/9, bullpen ERA; NCAAF/NCAAB: same shape as their pro
    // counterparts) — one jsonb blob instead of a column per sport per stat.
    factors: jsonb("factors"),
  },
  (t) => ({
    sportTeamSeasonWeek: uniqueIndex("sport_team_metrics_sport_team_season_week_idx").on(
      t.sport,
      t.team,
      t.season,
      t.week
    ),
  })
);

export const sportInjuryReports = pgTable("sport_injury_reports", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  season: integer("season").notNull(),
  week: integer("week").notNull(),
  team: text("team").notNull(),
  player: text("player").notNull(),
  position: text("position"),
  // Status vocabulary is sport-specific and stored as ESPN reports it
  // ("OUT" / "DAY-TO-DAY" / "IR" / "QUESTIONABLE" / ...) rather than forced
  // into the NFL report's fixed OUT/DOUBTFUL/QUESTIONABLE set.
  status: text("status").notNull(),
  winPctImpact: real("win_pct_impact"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Generic factor-performance calibration tracker — the multi-sport
// counterpart to factorSnapshots above. One row per named factor per game
// (e.g. "elo", "rest", "injury"); factorGrading-style resolution fills in
// favoredTeamWon once sportGames.isFinal flips true, so each sport's own
// Factor Performance page can show the same "how often has this factor's
// favored side actually won" calibration NFL's page already shows.
// ---------------------------------------------------------------------------
export const sportFactorSnapshots = pgTable("sport_factor_snapshots", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  gameId: integer("game_id")
    .notNull()
    .references(() => sportGames.id),
  factorName: text("factor_name").notNull(),
  favoredTeam: text("favored_team"),
  adjPct: real("adj_pct"),
  resolved: boolean("resolved").notNull().default(false),
  favoredTeamWon: boolean("favored_team_won"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Raw per-player, per-game box score lines for every sport besides NFL
// (whose player stats come from nflverse instead — see lib/props-model.ts).
// This is the data foundation for a real other-sport Player Props model:
// just the box score as ESPN reports it, one row per player per game, with
// `stats` kept as a raw label->value jsonb blob rather than typed columns
// because the stat set is completely different per sport (NBA: PTS/REB/AST;
// NHL: G/A/SOG; MLB splits into batting vs. pitching lines; etc) — see
// lib/sports/espn.ts's fetchBoxscorePlayers for the ESPN shape this is
// parsed from, and its caveat about being unverified until a live sync
// actually runs (this sandbox can't reach site.api.espn.com to check).
// Nothing reads this yet to produce a pick — a real per-sport projection
// (the NBA/NHL/MLB/etc equivalent of lib/props-model.ts) is a separate,
// later piece of work once enough games have accumulated here to project
// from, same as NFL's own "3+ games" bar.
// ---------------------------------------------------------------------------
export const sportPlayerGameStats = pgTable(
  "sport_player_game_stats",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => sportGames.id),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    team: text("team").notNull(),
    player: text("player").notNull(),
    position: text("position"),
    // Raw ESPN box-score label -> value pairs for this player in this game,
    // e.g. {"PTS": "27", "REB": "9", "AST": "5"} for an NBA skater, or
    // {"group": "pitching", "IP": "6.0", "SO": "8", "ER": "2"} for MLB.
    stats: jsonb("stats").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sportGamePlayerIdx: uniqueIndex("sport_player_game_stats_sport_game_player_idx").on(
      t.sport,
      t.gameId,
      t.player
    ),
  })
);

// ---------------------------------------------------------------------------
// Real player-prop lines for every sport BESIDES NFL — the "later piece of
// work" sportPlayerGameStats's own comment above refers to, now built (see
// lib/sports/props-model.ts and lib/sports/odds.ts). Same shape as NFL's
// oddsLines/propLinesRaw above, with a `sport` column added to the
// composite key so one pair of tables covers every other sport instead of
// one pair per sport. NFL keeps using its own oddsLines/propLinesRaw
// untouched — these are never used for NFL.
// ---------------------------------------------------------------------------
export const sportOddsLines = pgTable(
  "sport_odds_lines",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    player: text("player").notNull(),
    team: text("team"),
    statType: text("stat_type").notNull(),
    line: real("line").notNull(),
    side: text("side").notNull(), // "Over" | "Under" — the model's recommended side
    book: text("book").notNull(),
    priceAmerican: integer("price_american").notNull(),
    impliedProbPct: real("implied_prob_pct"),
    projection: real("projection"),
    edgePct: real("edge_pct"),
    // The model's real statistical win chance for `side` (see
    // lib/sports/props-model.ts's reuse of lib/props-model.ts's
    // winProbability) — what this app's 70%-confidence filter checks.
    modelWinPct: real("model_win_pct"),
    source: text("source"), // "LIVE"
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => ({
    sportSeasonWeekPlayerStatBook: uniqueIndex("sport_odds_lines_idx").on(
      t.sport,
      t.season,
      t.week,
      t.player,
      t.statType,
      t.book
    ),
  })
);

// Every raw per-book player-prop line fetched during a sync for these
// sports, win or lose on the model's confidence bar — same role as NFL's
// propLinesRaw: lets the Props page show a "which book pays best"
// comparison for any line, not only the ones that cleared 70%.
export const sportPropLinesRaw = pgTable(
  "sport_prop_lines_raw",
  {
    id: serial("id").primaryKey(),
    sport: text("sport").notNull(),
    season: integer("season").notNull(),
    week: integer("week").notNull(),
    player: text("player").notNull(),
    team: text("team"),
    statType: text("stat_type").notNull(),
    line: real("line").notNull(),
    side: text("side").notNull(),
    book: text("book").notNull(),
    priceAmerican: integer("price_american").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => ({
    sportSeasonWeekPlayerStatLineSideBook: uniqueIndex("sport_prop_lines_raw_idx").on(
      t.sport,
      t.season,
      t.week,
      t.player,
      t.statType,
      t.line,
      t.side,
      t.book
    ),
  })
);

// ---------------------------------------------------------------------------
// "Make your own pick" player props for every sport besides NFL. There's no
// real per-player projection model for these sports yet (sportPlayerGameStats
// above is the data foundation for one, still accumulating games) — rather
// than fabricate a model pick with nothing behind it, the user calls their
// own prop (a player, a stat, a line, over/under) and this table tracks and
// auto-grades it once the game goes final and a box score lands. NFL's
// player props stay the real, model-driven ones at lib/props-model.ts —
// this table is never used for NFL.
//
// statLabel is free text, not validated against a known vocabulary, because
// ESPN's actual box-score label strings per sport are themselves unverified
// until a live sync runs (see lib/sports/espn.ts's caveat) — the Props page
// offers a <datalist> of common guesses but lets the user type anything.
// Grading (lib/sports/prop-grading.ts) matches it case-insensitively against
// sportPlayerGameStats.stats's keys for that player/game; no match after the
// game is final resolves to "void" rather than guessing.
// ---------------------------------------------------------------------------
export const userPropPicks = pgTable(
  "user_prop_picks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    sport: text("sport").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => sportGames.id),
    team: text("team").notNull(), // as the user entered it — disambiguates same-named players, not validated against sportTeams
    player: text("player").notNull(),
    statLabel: text("stat_label").notNull(),
    threshold: real("threshold").notNull(),
    side: text("side").notNull(), // "over" | "under"
    result: text("result").notNull().default("pending"), // "pending" | "win" | "loss" | "void"
    actualValue: real("actual_value"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    gradedAt: timestamp("graded_at"),
  },
  (t) => ({
    userGamePlayerStatIdx: uniqueIndex("user_prop_picks_user_game_player_stat_idx").on(
      t.userId,
      t.gameId,
      t.player,
      t.statLabel
    ),
  })
);

// ---------------------------------------------------------------------------
// Per-user GAME-WINNER picks for every sport besides NFL — the sport-keyed
// counterpart to userPicks above. Same "make your own pick, graded against
// the model" idea the NFL Model Tracker already has (PickToggle, the
// Graded table, the Leaderboard), generalized here one-for-one: each person
// has their own pick per sportGames row, enforced (userId, gameId) unique
// just like userPicks. `sport` is denormalized onto this row (even though
// it's technically derivable by joining sportGames) so the per-sport page
// (app/(app)/sports/[sport]/page.tsx) can filter "my picks for this sport"
// directly — same convenience sportPlayerGameStats already takes with its
// own sport column.
// ---------------------------------------------------------------------------
export const sportUserPicks = pgTable(
  "sport_user_picks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    sport: text("sport").notNull(),
    gameId: integer("game_id")
      .notNull()
      .references(() => sportGames.id),
    team: text("team").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userGameIdx: uniqueIndex("sport_user_picks_user_game_idx").on(t.userId, t.gameId),
  })
);

// ---------------------------------------------------------------------------
// Seasonz: platform invite codes (see lib/invite-codes.ts). Admins keep a
// set list of codes per platform ("ios" | "android" | "desktop"); each
// load of the admin page shows the next code in each platform's list
// (least-recently-shown first), so the code on screen changes every load.
// Any active code lets a new user sign up.
// ---------------------------------------------------------------------------
export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    platform: text("platform").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    uses: integer("uses").notNull().default(0),
    lastShownAt: timestamp("last_shown_at"),
    createdById: integer("created_by_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("invite_codes_code_idx").on(t.code),
  })
);

// ---------------------------------------------------------------------------
// Seasonz: free-time promo codes (see lib/promo.ts). 3/6/9/12 months.
// Lifecycle: pending_admin -> (an admin other than the creator approves)
// -> pending_legacy -> (a legacy admin other than the first approver
// approves) -> active. Only "active" codes can be redeemed. Any admin can
// reject a pending code; a legacy admin can revoke an active one.
// ---------------------------------------------------------------------------
export const promoCodes = pgTable(
  "promo_codes",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    months: integer("months").notNull(),
    tier: text("tier").notNull().default("pro"),
    maxRedemptions: integer("max_redemptions").notNull().default(1),
    redemptions: integer("redemptions").notNull().default(0),
    status: text("status").notNull().default("pending_admin"),
    note: text("note"),
    createdById: integer("created_by_id").notNull(),
    adminApprovedById: integer("admin_approved_by_id"),
    adminApprovedAt: timestamp("admin_approved_at"),
    legacyApprovedById: integer("legacy_approved_by_id"),
    legacyApprovedAt: timestamp("legacy_approved_at"),
    closedById: integer("closed_by_id"),
    closedAt: timestamp("closed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("promo_codes_code_idx").on(t.code),
  })
);

export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: serial("id").primaryKey(),
    promoCodeId: integer("promo_code_id").notNull(),
    userId: integer("user_id").notNull(),
    redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => ({
    onePerUserIdx: uniqueIndex("promo_redemptions_code_user_idx").on(t.promoCodeId, t.userId),
  })
);

// ---------------------------------------------------------------------------
// Seasonz: odds-provider key usage (see lib/odds-provider.ts). One row per
// configured key — free The Odds API / PropLine keys and the paid PropLine
// key — identified by a hash (never the key itself), so the rotation
// remembers each key's remaining requests across serverless instances and
// the admin page can show them.
// ---------------------------------------------------------------------------
export const oddsApiKeyUsage = pgTable("odds_api_key_usage", {
  keyId: text("key_id").primaryKey(),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  kind: text("kind").notNull(),
  requestsRemaining: integer("requests_remaining"),
  requestsUsed: integer("requests_used"),
  lastStatus: integer("last_status"),
  exhaustedAt: timestamp("exhausted_at"),
  resetAt: timestamp("reset_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
