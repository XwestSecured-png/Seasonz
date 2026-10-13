-- ESPN season type per game: 1 = preseason, 2 = regular season, 3 = postseason.
-- Preseason games (NBA) get lines and picks but stay out of ratings, form,
-- box-score stats and the scorecard.
alter table sport_games add column if not exists season_type integer not null default 2;
