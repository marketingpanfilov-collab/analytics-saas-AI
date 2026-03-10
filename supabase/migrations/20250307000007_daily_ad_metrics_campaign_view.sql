-- Dashboard read: campaign-level only (avoids double-count with account-level rows)
-- Use this view for dashboard aggregation so totals match Meta Ads Manager.
CREATE OR REPLACE VIEW public.daily_ad_metrics_campaign AS
SELECT *
FROM public.daily_ad_metrics
WHERE campaign_id IS NOT NULL;

COMMENT ON VIEW public.daily_ad_metrics_campaign IS
  'Campaign-level rows only. Use for dashboard totals; account-level rows remain in daily_ad_metrics for coverage/debug/fallback.';
