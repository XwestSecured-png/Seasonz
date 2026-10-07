CREATE TABLE "sport_user_picks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sport" text NOT NULL,
	"game_id" integer NOT NULL,
	"team" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_user_picks" ADD CONSTRAINT "sport_user_picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_user_picks" ADD CONSTRAINT "sport_user_picks_game_id_sport_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."sport_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sport_user_picks_user_game_idx" ON "sport_user_picks" USING btree ("user_id","game_id");