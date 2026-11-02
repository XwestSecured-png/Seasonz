-- 1.37.0: trades and the NFL trade adjustment (lib/trades.ts).
CREATE TABLE IF NOT EXISTS trades (
  id serial PRIMARY KEY,
  sport text NOT NULL,
  trade_date timestamp NOT NULL,
  team text NOT NULL,
  direction text NOT NULL,
  player text NOT NULL,
  position text,
  other_team text,
  description text NOT NULL,
  value real,
  value_label text,
  impact_pct real,
  impact_now_pct real,
  games_since integer,
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trades_uniq ON trades (sport, team, direction, player, trade_date);
CREATE INDEX IF NOT EXISTS trades_sport_date ON trades (sport, trade_date DESC);
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ADD COLUMN IF NOT EXISTS trade_adj_pct real;
