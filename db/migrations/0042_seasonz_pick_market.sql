-- 1.32.0: the market's no-vig chance for each pick's side, so picks can be
-- ranked by how far the model is above the market (where the returns are).
ALTER TABLE odds_lines ADD COLUMN IF NOT EXISTS market_pct real;
ALTER TABLE sport_odds_lines ADD COLUMN IF NOT EXISTS market_pct real;
