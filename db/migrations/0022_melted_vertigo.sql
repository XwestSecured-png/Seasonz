CREATE TABLE "sport_odds_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player" text NOT NULL,
	"team" text,
	"stat_type" text NOT NULL,
	"line" real NOT NULL,
	"side" text NOT NULL,
	"book" text NOT NULL,
	"price_american" integer NOT NULL,
	"implied_prob_pct" real,
	"projection" real,
	"edge_pct" real,
	"model_win_pct" real,
	"source" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_prop_lines_raw" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player" text NOT NULL,
	"team" text,
	"stat_type" text NOT NULL,
	"line" real NOT NULL,
	"side" text NOT NULL,
	"book" text NOT NULL,
	"price_american" integer NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sport_odds_lines_idx" ON "sport_odds_lines" USING btree ("sport","season","week","player","stat_type","book");--> statement-breakpoint
CREATE UNIQUE INDEX "sport_prop_lines_raw_idx" ON "sport_prop_lines_raw" USING btree ("sport","season","week","player","stat_type","line","side","book");