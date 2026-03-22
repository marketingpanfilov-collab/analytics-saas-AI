-- Dedupe daily_ad_metrics: one row per (ad_account_id, campaign_id, date).
-- Keeps earliest by created_at, then id. No min(uuid). Idempotent.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY ad_account_id, campaign_id, date
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.daily_ad_metrics
)
DELETE FROM public.daily_ad_metrics
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
