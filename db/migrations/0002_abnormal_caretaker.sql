ALTER TABLE "odds_lines" ADD COLUMN "season" integer;--> statement-breakpoint
ALTER TABLE "odds_lines" ADD COLUMN "week" integer;--> statement-breakpoint
ALTER TABLE "odds_lines" ADD COLUMN "projection" real;--> statement-breakpoint
ALTER TABLE "odds_lines" ADD COLUMN "edge_pct" real;--> statement-breakpoint
CREATE UNIQUE INDEX "odds_lines_season_week_player_stat_book_idx" ON "odds_lines" USING btree ("season","week","player","stat_type","book");