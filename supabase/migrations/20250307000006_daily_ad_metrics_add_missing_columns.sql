-- Add missing columns to daily_ad_metrics for canonical insights sync
-- Fixes: Could not find the 'cpc' column of 'daily_ad_metrics'
-- Additive only: no drops or renames, backward compatible

ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS reach bigint DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS cpm numeric(10, 4) DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS cpc numeric(10, 4) DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS ctr numeric(10, 4) DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS leads bigint DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS purchases bigint DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS revenue numeric(14, 4) DEFAULT 0;
ALTER TABLE public.daily_ad_metrics ADD COLUMN IF NOT EXISTS roas numeric(10, 4) DEFAULT 0;
