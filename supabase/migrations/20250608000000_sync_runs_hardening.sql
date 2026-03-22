-- Hardening: enrich sync_runs with range + counters, keep old columns for backward compatibility.

ALTER TABLE public.sync_runs
  ADD COLUMN IF NOT EXISTS date_start date,
  ADD COLUMN IF NOT EXISTS date_end date,
  ADD COLUMN IF NOT EXISTS rows_deleted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rows_inserted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign_rows_inserted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS account_rows_inserted integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_text text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sync_runs_project_started_at_desc
  ON public.sync_runs(project_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_platform_account_range_started_at_desc
  ON public.sync_runs(platform, ad_account_id, date_start, date_end, started_at DESC);
