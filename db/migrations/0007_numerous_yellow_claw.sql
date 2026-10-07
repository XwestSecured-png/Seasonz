ALTER TABLE "games" ADD COLUMN "home_injury_impact_pct" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "away_injury_impact_pct" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "injury_adj_pct" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "opening_moneyline_home_odds" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "opening_moneyline_away_odds" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "opening_moneyline_book" text;--> statement-breakpoint
CREATE UNIQUE INDEX "factor_snapshots_season_week_game_factor_idx" ON "factor_snapshots" USING btree ("season","week","game_id","factor");