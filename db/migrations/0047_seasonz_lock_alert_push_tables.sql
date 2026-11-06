-- 1.42.1: Supabase flagged alert_log and push_subscriptions as publicly
-- readable/editable through the project's API (Row-Level Security was off).
-- The app talks to the database as its owner, which RLS does not restrict,
-- so turning RLS on (with no policies) and removing the API roles' access
-- closes the hole without changing anything in the app.
ALTER TABLE public.alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.alert_log, public.push_subscriptions FROM anon, authenticated;
