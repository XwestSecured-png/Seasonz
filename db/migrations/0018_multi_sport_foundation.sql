CREATE TABLE "sport_elo_ratings" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"team" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"rating" real NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_factor_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"game_id" integer NOT NULL,
	"factor_name" text NOT NULL,
	"favored_team" text,
	"adj_pct" real,
	"resolved" boolean DEFAULT false NOT NULL,
	"favored_team_won" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"espn_event_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"game_date" date,
	"kickoff_at" timestamp,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"is_final" boolean DEFAULT false NOT NULL,
	"neutral_site" boolean DEFAULT false NOT NULL,
	"elo_home_pre" real,
	"elo_away_pre" real,
	"home_win_pct_pre" real,
	"rest_days_home" integer,
	"rest_days_away" integer,
	"rest_adj_pct" real,
	"home_injury_impact_pct" real,
	"away_injury_impact_pct" real,
	"injury_adj_pct" real,
	"moneyline_home_odds" integer,
	"moneyline_away_odds" integer,
	"moneyline_book" text,
	"spread_home_line" real,
	"spread_home_price_american" integer,
	"spread_away_price_american" integer,
	"spread_book" text,
	"total_line" real,
	"total_over_price_american" integer,
	"total_under_price_american" integer,
	"total_book" text,
	"best_market" text,
	"best_market_label" text,
	"best_market_edge_pct" real,
	"best_market_confidence_pct" real,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "sport_injury_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"team" text NOT NULL,
	"player" text NOT NULL,
	"position" text,
	"status" text NOT NULL,
	"win_pct_impact" real,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_team_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"team" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"ties" integer DEFAULT 0 NOT NULL,
	"home_win_pct" real,
	"road_win_pct" real,
	"factors" jsonb
);
--> statement-breakpoint
CREATE TABLE "sport_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"abbr" text NOT NULL,
	"name" text NOT NULL,
	"conference" text,
	"division" text,
	"primary_color" text,
	"secondary_color" text,
	"espn_team_id" text
);
--> statement-breakpoint
ALTER TABLE "sport_factor_snapshots" ADD CONSTRAINT "sport_factor_snapshots_game_id_sport_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."sport_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sport_elo_ratings_sport_team_season_week_idx" ON "sport_elo_ratings" USING btree ("sport","team","season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "sport_games_sport_event_idx" ON "sport_games" USING btree ("sport","espn_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sport_team_metrics_sport_team_season_week_idx" ON "sport_team_metrics" USING btree ("sport","team","season","week");--> statement-breakpoint
CREATE UNIQUE INDEX "sport_teams_sport_abbr_idx" ON "sport_teams" USING btree ("sport","abbr");