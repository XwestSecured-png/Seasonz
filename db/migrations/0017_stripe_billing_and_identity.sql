ALTER TABLE "users" DROP COLUMN "braintree_customer_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "braintree_subscription_id";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "identity_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_identity_session_id" text;
