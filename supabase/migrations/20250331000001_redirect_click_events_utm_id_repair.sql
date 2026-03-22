-- Repair: ensure redirect_click_events has utm_id column.
-- Original migration 20250326000000 was incomplete/corrupted; this safely fixes schema.
-- Safe: ADD COLUMN IF NOT EXISTS, no destructive changes.
-- Production may already have the column (no-op); fresh installs get the column.

ALTER TABLE public.redirect_click_events
  ADD COLUMN IF NOT EXISTS utm_id text;

COMMENT ON COLUMN public.redirect_click_events.utm_id IS 'Optional UTM ID from redirect URL (e.g. TikTok campaign id).';
