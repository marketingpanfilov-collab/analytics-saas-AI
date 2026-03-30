-- Planned ad budget from platforms (Meta / future Google) for reports: coverage vs fact spend.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS budget_type text,
  ADD COLUMN IF NOT EXISTS daily_budget numeric(20, 6),
  ADD COLUMN IF NOT EXISTS lifetime_budget numeric(20, 6),
  ADD COLUMN IF NOT EXISTS campaign_start_time timestamptz,
  ADD COLUMN IF NOT EXISTS campaign_stop_time timestamptz,
  ADD COLUMN IF NOT EXISTS budget_synced_at timestamptz;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_budget_type_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_budget_type_check
  CHECK (budget_type IS NULL OR budget_type IN ('daily', 'lifetime'));

COMMENT ON COLUMN public.campaigns.budget_type IS 'daily | lifetime from ad platform sync; NULL if unknown.';
COMMENT ON COLUMN public.campaigns.daily_budget IS 'Major currency units per day (same scale as ad spend in UI), when budget_type=daily.';
COMMENT ON COLUMN public.campaigns.lifetime_budget IS 'Total lifetime budget in major units when budget_type=lifetime.';
COMMENT ON COLUMN public.campaigns.campaign_start_time IS 'Campaign start from platform (optional).';
COMMENT ON COLUMN public.campaigns.campaign_stop_time IS 'Campaign end/stop from platform; caps planned month budget.';
