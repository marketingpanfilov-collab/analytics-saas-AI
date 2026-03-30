-- Run in Supabase SQL Editor if ad_accounts has no "currency" column
-- (same as supabase/migrations/20260331120000_ad_accounts_currency_column.sql)

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS currency text;

COMMENT ON COLUMN public.ad_accounts.currency IS 'Account reporting currency when known (e.g. USD, KZT); used for canonical spend/revenue normalization.';
