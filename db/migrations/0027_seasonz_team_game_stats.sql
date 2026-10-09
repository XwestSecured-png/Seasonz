CREATE TABLE "sport_team_game_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"sport" text NOT NULL,
	"game_id" integer NOT NULL,
	"season" integer NOT NULL,
	"team" text NOT NULL,
	"opponent" text NOT NULL,
	"is_home" boolean NOT NULL,
	"pts" integer NOT NULL,
	"opp_pts" integer NOT NULL,
	"fgm" integer NOT NULL,
	"fga" integer NOT NULL,
	"fg3m" integer NOT NULL,
	"fg3a" integer NOT NULL,
	"ftm" integer NOT NULL,
	"fta" integer NOT NULL,
	"oreb" integer NOT NULL,
	"dreb" integer NOT NULL,
	"tov" integer NOT NULL,
	"fouls" integer NOT NULL,
	"off_fouls" integer NOT NULL,
	"paint_pts" integer NOT NULL,
	"mid_made" real NOT NULL,
	"fast_break_pts" integer NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_team_game_stats" ADD CONSTRAINT "sport_team_game_stats_game_id_sport_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."sport_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sport_team_game_stats_sport_game_team_idx" ON "sport_team_game_stats" USING btree ("sport","game_id","team");