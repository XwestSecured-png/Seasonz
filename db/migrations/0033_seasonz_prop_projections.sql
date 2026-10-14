create table if not exists prop_projections (
  id serial primary key,
  sport text not null,
  season integer not null,
  week integer not null,
  player text not null,
  team text,
  stat_type text not null,
  data jsonb not null,
  updated_at timestamp not null default now()
);
create unique index if not exists prop_projections_key on prop_projections (sport, season, week, player, stat_type);
