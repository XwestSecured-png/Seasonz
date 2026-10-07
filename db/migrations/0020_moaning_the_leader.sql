CREATE TABLE "user_prop_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sport" text NOT NULL,
	"game_id" integer NOT NULL,
	"team" text NOT NULL,
	"player" text NOT NULL,
	"stat_label" text NOT NULL,
	"threshold" real NOT NULL,
	"side" text NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"actual_value" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"graded_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user_prop_picks" ADD CONSTRAINT "user_prop_picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_prop_picks" ADD CONSTRAINT "user_prop_picks_game_id_sport_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."sport_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_prop_picks_user_game_player_stat_idx" ON "user_prop_picks" USING btree ("user_id","game_id","player","stat_label");