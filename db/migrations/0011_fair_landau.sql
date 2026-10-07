CREATE TABLE "line_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"market" text NOT NULL,
	"line" real,
	"home_price_american" integer,
	"away_price_american" integer,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_bets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"market" text NOT NULL,
	"selection" text NOT NULL,
	"line" real,
	"price_american" integer NOT NULL,
	"stake_usd" real NOT NULL,
	"result" text DEFAULT 'PENDING' NOT NULL,
	"payout_usd" real,
	"placed_at" timestamp DEFAULT now() NOT NULL,
	"graded_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "best_market_confidence_pct" real;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bankroll_usd" real;--> statement-breakpoint
ALTER TABLE "line_history" ADD CONSTRAINT "line_history_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bets" ADD CONSTRAINT "user_bets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bets" ADD CONSTRAINT "user_bets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;