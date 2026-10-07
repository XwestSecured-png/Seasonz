ALTER TABLE "games" ADD COLUMN "moneyline_home_odds" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "moneyline_away_odds" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "moneyline_book" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ai_edge_pct" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "ai_pick_team" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "user_pick_team" text;