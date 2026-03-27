-- Dashboard bundle / long-range reads: composite indexes for typical filters (audit per plan index-audit).
-- Safe additive indexes; verify with EXPLAIN on production-like volume if needed.

-- KPI / timeseries-conversions: filter by project_id and created_at range
CREATE INDEX IF NOT EXISTS idx_conversion_events_project_id_created_at
  ON public.conversion_events (project_id, created_at);

-- Canonical daily_ad_metrics: .in(ad_account_id) + date range (coverage + campaign fetches)
CREATE INDEX IF NOT EXISTS idx_daily_ad_metrics_ad_account_id_date
  ON public.daily_ad_metrics (ad_account_id, date);

COMMENT ON INDEX idx_conversion_events_project_id_created_at IS 'Dashboard: conversion_events by project and time range.';
COMMENT ON INDEX idx_daily_ad_metrics_ad_account_id_date IS 'Dashboard: daily_ad_metrics by account and date range.';
