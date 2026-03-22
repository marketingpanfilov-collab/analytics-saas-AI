-- Prevent concurrent running syncs for the same (platform, ad_account_id, sync_type, date range).

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sync_runs_running
ON public.sync_runs(platform, ad_account_id, sync_type, date_start, date_end)
WHERE status = 'running';

