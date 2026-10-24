-- 1.25.0: closing-line value lookups for prop picks (results page).
CREATE INDEX IF NOT EXISTS line_archive_player_idx ON line_archive (sport, player, stat_type, line);
