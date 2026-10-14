-- Bets for every sport, props and parlays, with closing-line value
alter table user_bets alter column game_id drop not null;
alter table user_bets add column if not exists sport text not null default 'nfl';
alter table user_bets add column if not exists sport_game_id integer references sport_games(id);
alter table user_bets add column if not exists description text;
alter table user_bets add column if not exists prop jsonb;
alter table user_bets add column if not exists closing_price_american integer;
alter table user_bets add column if not exists closing_line real;
alter table user_bets add column if not exists clv_pct real;
create index if not exists user_bets_user_idx on user_bets(user_id);

-- Market at the moment a pick was made (line-move alerts)
alter table user_picks add column if not exists market_at_pick real;
alter table sport_user_picks add column if not exists market_at_pick real;

-- NFL: the model-only number at lock (weight re-testing)
alter table games add column if not exists locked_model_pct real;

-- Push alerts
create table if not exists push_subscriptions (
  id serial primary key,
  user_id integer not null references users(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  prefs jsonb not null default '{"locks":true,"edges":true,"moves":true}'::jsonb,
  created_at timestamp not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id);
create table if not exists alert_log (
  id serial primary key,
  user_id integer not null references users(id),
  kind text not null,
  ref text not null,
  sent_at timestamp not null default now(),
  unique (user_id, kind, ref)
);
