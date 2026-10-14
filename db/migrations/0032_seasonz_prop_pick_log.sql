create table if not exists prop_pick_log (
  id serial primary key,
  sport text not null,
  season integer not null,
  week integer not null,
  player text not null,
  team text,
  stat_type text not null,
  line real not null,
  side text not null,
  book text,
  price_american integer,
  model_only real not null,
  market real,
  final real not null,
  game_date text,
  result text,
  actual real,
  logged_at timestamp not null default now(),
  graded_at timestamp
);
create unique index if not exists prop_pick_log_key on prop_pick_log (sport, season, week, player, stat_type, line, side);
create index if not exists prop_pick_log_pending on prop_pick_log (sport, result);
