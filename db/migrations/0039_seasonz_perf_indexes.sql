-- 1.25.0: indexes for the hottest reads. Upcoming-games lookups (alerts,
-- best bets, props/parlays pages) were sequential scans of sport_games
-- (~3s each on the shared database); box-score loads read a sport's two
-- seasons; plus covering indexes for every foreign key the linter flagged.
CREATE INDEX IF NOT EXISTS sport_games_upcoming_idx ON sport_games (kickoff_at) WHERE is_final = false;
CREATE INDEX IF NOT EXISTS sport_games_sport_season_idx ON sport_games (sport, season);
CREATE INDEX IF NOT EXISTS sport_player_game_stats_sport_season_idx ON sport_player_game_stats (sport, season);
CREATE INDEX IF NOT EXISTS sport_player_game_stats_game_idx ON sport_player_game_stats (game_id);
CREATE INDEX IF NOT EXISTS sport_team_game_stats_game_idx ON sport_team_game_stats (game_id);
CREATE INDEX IF NOT EXISTS sport_factor_snapshots_game_idx ON sport_factor_snapshots (game_id);
CREATE INDEX IF NOT EXISTS sport_user_picks_game_idx ON sport_user_picks (game_id);
CREATE INDEX IF NOT EXISTS user_prop_picks_game_idx ON user_prop_picks (game_id);
CREATE INDEX IF NOT EXISTS user_bets_game_idx ON user_bets (game_id);
CREATE INDEX IF NOT EXISTS user_bets_sport_game_idx ON user_bets (sport_game_id);
CREATE INDEX IF NOT EXISTS user_picks_game_idx ON user_picks (game_id);
CREATE INDEX IF NOT EXISTS factor_snapshots_game_idx ON factor_snapshots (game_id);
CREATE INDEX IF NOT EXISTS line_history_game_idx ON line_history (game_id);
CREATE INDEX IF NOT EXISTS model_tracker_game_idx ON model_tracker (game_id);
CREATE INDEX IF NOT EXISTS parlay_picks_user_idx ON parlay_picks (user_id);
CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback (user_id);
