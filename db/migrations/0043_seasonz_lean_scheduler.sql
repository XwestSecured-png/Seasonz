-- 1.35.0: lean scheduler. Vercel's free plan switched the app off on
-- 2026-10-27 after it went over its monthly usage, so the scheduler now
-- decides in the database whether there's anything to do, and only then
-- calls the app:
--   * syncs skip a sport with no games from 36 hours ago to 4 days ahead
--     (out of season, or between seasons), apart from a Monday catch-up so
--     its schedule stays current; the 11am/5pm refresh only runs for sports
--     with games in the next 14 hours;
--   * the pre-game props pass only calls the app when some sport has games
--     starting in 30-150 minutes and hasn't had a props pass in 110 minutes;
--   * alerts only call the app when a game starts within the hour (lock
--     reminders) or every second hour (moves, edges, health, refit).
-- The sync token is copied from scheduled_sync inside this block and is
-- never written in this file.
DO $mig$
DECLARE
  tok text;
BEGIN
  SELECT substring(p.prosrc from 'Bearer [A-Za-z0-9_\-\.]+') INTO tok
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'seasonz_private' AND p.proname = 'scheduled_sync';
  IF tok IS NULL THEN
    RAISE EXCEPTION 'sync token not found';
  END IF;

  -- A sport has games between lo and hi from now.
  CREATE OR REPLACE FUNCTION seasonz_private.sport_has_games(s text, lo interval, hi interval) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
    select case when s = 'nfl'
      then exists (select 1 from public.games where kickoff_at >= now() + lo and kickoff_at < now() + hi)
      else exists (select 1 from public.sport_games where sport = s and kickoff_at >= now() + lo and kickoff_at < now() + hi)
    end
  $f$;

  EXECUTE format($f$CREATE OR REPLACE FUNCTION seasonz_private.scheduled_sync_wave(wave int) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $b$
declare
  et timestamp := now() at time zone 'America/New_York';
  h int := extract(hour from et);
  monday boolean := extract(isodow from et) = 1;
  base text := 'https://seasonz-silk.vercel.app/api/sync';
  hdr jsonb := jsonb_build_object('Authorization', %L);
  since_utc timestamp;
  s text;
  refresh boolean := false;
  called text[] := '{}';
begin
  if h = 14 then
    since_utc := (date_trunc('day', et) + interval '12 hours') at time zone 'America/New_York' at time zone 'UTC';
    if exists (select 1 from public.sync_runs where stage = (case when wave = 0 then 'schedule' else 'mlb:schedule' end) and status = 'ok' and started_at >= since_utc) then
      return 'skipped: already synced since 10am ET';
    end if;
  elsif h in (11, 17) then
    refresh := true;
  elsif h <> 0 then
    return 'not a sync hour';
  end if;

  if wave = 0 and (case when refresh then seasonz_private.sport_has_games('nfl', interval '0', interval '14 hours')
                        else monday or seasonz_private.sport_has_games('nfl', interval '-36 hours', interval '4 days') end) then
    perform net.http_get(url := base, headers := hdr, timeout_milliseconds := 300000);
    called := called || 'nfl';
  end if;
  foreach s in array (case when wave = 0 then array['nba','wnba','nhl'] else array['mlb','ncaaf','ncaab'] end) loop
    if refresh then
      continue when not seasonz_private.sport_has_games(s, interval '0', interval '14 hours');
      perform net.http_get(url := base || '?nfl=false&refresh=1&sports=' || s, headers := hdr, timeout_milliseconds := 300000);
    else
      continue when not (monday or seasonz_private.sport_has_games(s, interval '-36 hours', interval '4 days'));
      perform net.http_get(url := base || '?nfl=false&sports=' || s, headers := hdr, timeout_milliseconds := 300000);
    end if;
    called := called || s;
  end loop;
  return (case when refresh then 'refresh' else 'sync' end) || ' at ' || to_char(et, 'YYYY-MM-DD HH24:MI') || ' ET: ' || coalesce(nullif(array_to_string(called, ','), ''), 'nothing due');
end $b$$f$, tok);

  EXECUTE format($f$CREATE OR REPLACE FUNCTION seasonz_private.scheduled_pregame() RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $b$
begin
  if not exists (
    select 1 from public.sport_games g
     where not g.is_final and g.kickoff_at >= now() + interval '30 minutes' and g.kickoff_at < now() + interval '150 minutes'
       and not exists (select 1 from public.sync_runs r where r.stage = g.sport || ':props' and r.status = 'ok' and r.started_at >= now() - interval '110 minutes')
  ) then
    return 'nothing due';
  end if;
  perform net.http_get(url := 'https://seasonz-silk.vercel.app/api/sync?pregame=1', headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 300000);
  return 'pre-game props pass started';
end $b$$f$, tok);

  EXECUTE format($f$CREATE OR REPLACE FUNCTION seasonz_private.scheduled_alerts() RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $b$
declare
  et timestamp := now() at time zone 'America/New_York';
begin
  if not (
    (extract(hour from et)::int %% 2 = 0 and extract(minute from et) < 30)
    or exists (select 1 from public.sport_games where not is_final and kickoff_at >= now() and kickoff_at < now() + interval '65 minutes')
    or exists (select 1 from public.games where not is_final and kickoff_at >= now() and kickoff_at < now() + interval '65 minutes')
  ) then
    return 'nothing due';
  end if;
  perform net.http_get(url := 'https://seasonz-silk.vercel.app/api/alerts', headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 120000);
  return 'alerts started';
end $b$$f$, tok);
END
$mig$;
REVOKE ALL ON FUNCTION seasonz_private.sport_has_games(text, interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seasonz_private.scheduled_sync_wave(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seasonz_private.scheduled_pregame() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seasonz_private.scheduled_alerts() FROM PUBLIC, anon, authenticated;
