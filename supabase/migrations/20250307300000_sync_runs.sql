-- Platform-agnostic sync run tracking for observability and data freshness.

CREATE TABLE IF NOT EXISTS public.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  platform text NOT NULL,
  ad_account_id uuid NULL REFERENCES public.ad_accounts(id) ON DELETE SET NULL,
  sync_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  rows_written integer NULL,
  error_message text NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_project_id ON public.sync_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_platform ON public.sync_runs(platform);
CREATE INDEX IF NOT EXISTS idx_sync_runs_ad_account_id ON public.sync_runs(ad_account_id);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at_desc ON public.sync_runs(started_at DESC);

COMMENT ON TABLE public.sync_runs IS 'Tracks sync execution (insights, campaigns, accounts) per platform for last sync time, status, and debugging.';
