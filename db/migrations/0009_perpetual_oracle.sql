CREATE TABLE "prop_lines_raw" (
	"id" serial PRIMARY KEY NOT NULL,
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
CREATE UNIQUE INDEX "prop_lines_raw_idx" ON "prop_lines_raw" USING btree ("season","week","player","stat_type","line","side","book");