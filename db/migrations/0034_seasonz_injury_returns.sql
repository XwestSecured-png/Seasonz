create table if not exists injury_returns (
  id serial primary key,
  sport text not null,
  season integer not null,
  team text not null,
  player text not null,
  position text,
  missed integer not null default 0,
  detail text,
  detected_on date not null,
  detected_at timestamp not null default now()
);
create unique index if not exists injury_returns_key on injury_returns (sport, season, team, player, detected_on);
create index if not exists injury_returns_recent on injury_returns (detected_at);
