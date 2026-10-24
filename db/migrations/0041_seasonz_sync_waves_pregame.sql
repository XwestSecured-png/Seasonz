-- 1.26.0: the full sync runs in two waves (NFL + NBA/WNBA/NHL at :00,
-- MLB/college at :06) and a pre-game props pass runs every 30 minutes.
-- Both functions are built from the existing scheduled_sync body so the
-- sync token stays where it already is (never written in this file).
DO $mig$
DECLARE
  src text;
  body text;
  tok text;
  arr text := 'array[''nba'',''wnba'',''nhl'',''mlb'',''ncaaf'',''ncaab'']';
  nflcall text := 'perform net.http_get(url := base, headers := hdr, timeout_milliseconds := 300000);';
BEGIN
  SELECT p.prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'seasonz_private' AND p.proname = 'scheduled_sync';
  body := replace(src, arr, '(case when wave = 0 then array[''nba'',''wnba'',''nhl''] else array[''mlb'',''ncaaf'',''ncaab''] end)');
  body := replace(body, nflcall, 'if wave = 0 then ' || nflcall || ' end if;');
  body := replace(body, 'stage = ''schedule''', 'stage = (case when wave = 0 then ''schedule'' else ''mlb:schedule'' end)');
  EXECUTE format('CREATE OR REPLACE FUNCTION seasonz_private.scheduled_sync_wave(wave int) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS %L', body);

  tok := substring(src from 'Bearer [A-Za-z0-9_\-\.]+');
  EXECUTE format($f$CREATE OR REPLACE FUNCTION seasonz_private.scheduled_pregame() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $b$
begin
  perform net.http_get(url := 'https://seasonz-silk.vercel.app/api/sync?pregame=1', headers := jsonb_build_object('Authorization', %L), timeout_milliseconds := 300000);
  return 'pre-game props pass started';
end $b$$f$, tok);
END
$mig$;
REVOKE ALL ON FUNCTION seasonz_private.scheduled_sync_wave(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION seasonz_private.scheduled_pregame() FROM PUBLIC, anon, authenticated;

-- Schedules (applied once 1.26.0 was live, so ?pregame=1 existed):
-- select cron.alter_job(1, command := 'select seasonz_private.scheduled_sync_wave(0)');
-- select cron.schedule('seasonz-scheduled-sync-wave2', '6 * * * *', 'select seasonz_private.scheduled_sync_wave(1)');
-- select cron.schedule('seasonz-pregame', '15,45 * * * *', 'select seasonz_private.scheduled_pregame()');
