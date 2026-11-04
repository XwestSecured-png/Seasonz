-- 1.39.0: the database's clock starts the GitHub sync job on time.
-- GitHub's own schedule runs late (hours, on free accounts), so pg_cron asks
-- GitHub to start .github/workflows/sync.yml every 30 minutes; the job then
-- decides what's due (scripts/cron.ts). The GitHub token lives in Supabase
-- Vault under the name 'github_dispatch_token' (fine-grained, this repo
-- only, Actions: read and write) and is read only inside this function.
-- Until that secret exists the job does nothing.
CREATE OR REPLACE FUNCTION seasonz_private.dispatch_github_sync() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1;
  if tok is null or length(trim(tok)) < 20 then
    return 'no github_dispatch_token in Vault yet';
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/XwestSecured-png/Seasonz/actions/workflows/sync.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || trim(tok),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'seasonz-scheduler'
    ),
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('task', '')),
    timeout_milliseconds := 15000
  );
  return 'dispatched';
end $$;
REVOKE ALL ON FUNCTION seasonz_private.dispatch_github_sync() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('seasonz-github-dispatch', '1,31 * * * *', 'select seasonz_private.dispatch_github_sync()');
