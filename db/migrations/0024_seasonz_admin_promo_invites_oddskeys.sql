CREATE TABLE "invite_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"platform" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"last_shown_at" timestamp,
	"created_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_api_key_usage" (
	"key_id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text NOT NULL,
	"requests_remaining" integer,
	"requests_used" integer,
	"last_status" integer,
	"exhausted_at" timestamp,
	"reset_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"months" integer NOT NULL,
	"tier" text DEFAULT 'pro' NOT NULL,
	"max_redemptions" integer DEFAULT 1 NOT NULL,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending_admin' NOT NULL,
	"note" text,
	"created_by_id" integer NOT NULL,
	"admin_approved_by_id" integer,
	"admin_approved_at" timestamp,
	"legacy_approved_by_id" integer,
	"legacy_approved_at" timestamp,
	"closed_by_id" integer,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"promo_code_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"redeemed_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_legacy_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "promo_tier" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "promo_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_platform" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signup_invite_code_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_idx" ON "invite_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_idx" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_code_user_idx" ON "promo_redemptions" USING btree ("promo_code_id","user_id");