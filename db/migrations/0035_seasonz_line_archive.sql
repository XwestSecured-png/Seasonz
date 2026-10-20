create table if not exists line_archive (
  id bigserial primary key,
  sport text not null,
  season integer not null,
  week integer not null,
  market text not null,          -- 'prop' | 'ml' | 'spread' | 'total'
  game_key text not null default '', -- game id for game lines, '' for props
  player text not null,          -- player (props) or team / 'game' (game lines)
  team text,
  stat_type text not null,
  line real not null,
  side text not null,
  book text not null,
  open_price integer not null,
  open_at timestamp not null default now(),
  close_price integer not null,
  close_at timestamp not null default now(),
  moves integer not null default 0,
  result text,                   -- 'hit' | 'miss' | 'push' | 'void' once graded
  actual real
);
create unique index if not exists line_archive_key on line_archive (sport, season, week, market, game_key, player, stat_type, line, side, book);
create index if not exists line_archive_open on line_archive (sport, season, week) where result is null;
alter table line_archive enable row level security;
