-- Client-side diagnostics (what a visitor's browser actually loaded).
CREATE TABLE IF NOT EXISTS client_logs (
  id serial PRIMARY KEY,
  at timestamp NOT NULL DEFAULT now(),
  kind text NOT NULL,
  ua text,
  detail jsonb
);
ALTER TABLE client_logs ENABLE ROW LEVEL SECURITY;
