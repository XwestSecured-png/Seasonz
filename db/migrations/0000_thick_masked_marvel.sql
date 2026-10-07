CREATE TABLE "factor_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"game_id" integer,
	"factor" text NOT NULL,
	"favored_team" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"correct" boolean,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"game_date" date,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"is_final" boolean DEFAULT false NOT NULL,
	"elo_home_pre" real,
	"elo_away_pre" real,
	"home_win_pct_pre" real,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "injury_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"status" text NOT NULL,
	"is_estimate" boolean DEFAULT false NOT NULL,
	"team" text NOT NULL,
	"player" text NOT NULL,
	"position" text,
	"next_opponent" text,
	"game_missed_label" text,
	"anticipated_return" text,
	"method" text NOT NULL,
	"season_epa_share" real,
	"win_pct_with_player" real,
	"win_pct_without_player" real,
	"win_pct_impact" real,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_tracker" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"predicted_winner" text,
	"predicted_home_win_pct" real,
	"actual_winner" text,
	"result" text,
	"graded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "odds_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"player" text,
	"team" text,
	"stat_type" text,
	"line" real,
	"side" text,
	"book" text,
	"price_american" integer,
	"implied_prob_pct" real,
	"source" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parlay_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"size" integer NOT NULL,
	"legs" jsonb NOT NULL,
	"combined_win_pct" real,
	"weakest_leg_win_pct" real,
	"confidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"stage" text NOT NULL,
	"status" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "team_elo_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"team" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"rating" real NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"team" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"off_epa_per_play" real,
	"def_epa_per_play" real,
	"turnover_margin" real,
	"home_win_pct" real,
	"road_win_pct" real,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"abbr" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"conference" text,
	"division" text
);
--> statement-breakpoint
ALTER TABLE "factor_snapshots" ADD CONSTRAINT "factor_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_tracker" ADD CONSTRAINT "model_tracker_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_season_week_teams_idx" ON "games" USING btree ("season","week","home_team","away_team");--> statement-breakpoint
CREATE UNIQUE INDEX "team_metrics_team_season_week_idx" ON "team_metrics" USING btree ("team","season","week");