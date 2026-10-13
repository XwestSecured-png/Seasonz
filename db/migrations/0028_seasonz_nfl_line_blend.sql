-- NFL: the model's own number, the no-vig betting line, and the number
-- locked in before kickoff (what the scorecard grades).
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "model_only_pct" real;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "market_pct" real;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "locked_pct" real;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "locked_market_pct" real;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "locked_at" timestamp;
