CREATE TABLE "sport_player_game_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"game_id" integer NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"team" text NOT NULL,
	"player" text NOT NULL,
	"position" text,
	"stats" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_player_game_stats" ADD CONSTRAINT "sport_player_game_stats_game_id_sport_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."sport_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sport_player_game_stats_sport_game_player_idx" ON "sport_player_game_stats" USING btree ("sport","game_id","player");