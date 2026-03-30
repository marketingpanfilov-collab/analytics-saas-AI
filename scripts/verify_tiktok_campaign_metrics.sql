-- Optional: run in Supabase SQL editor to verify TikTok campaign-level canonical rows.
-- Sync merges AUCTION_CAMPAIGN + RESERVATION_CAMPAIGN into daily_ad_metrics (see tiktok/insights/sync).
-- Replace :project_uuid with your project id if you join via ad_accounts/integrations.

SELECT COUNT(*) AS tiktok_campaign_level_rows
FROM public.daily_ad_metrics dam
JOIN public.ad_accounts aa ON aa.id = dam.ad_account_id
WHERE aa.provider = 'tiktok'
  AND dam.campaign_id IS NOT NULL
  AND dam.date >= CURRENT_DATE - INTERVAL '90 days';
