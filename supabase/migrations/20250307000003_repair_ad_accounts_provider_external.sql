-- Repair: ensure ad_accounts has provider and external_account_id for later migrations.
-- Real production uses provider / external_account_id; initial 000003 creates platform / platform_account_id.
-- This migration makes fresh installs compatible with 000009, 07100000, 07200000, 08000000 (no code changes).
-- Safe: ADD COLUMN IF NOT EXISTS, backfill only when source columns exist. No renames, no drops.

ALTER TABLE public.ad_accounts
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS external_account_id text;

-- Backfill from legacy columns when present (fresh install after 000003)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ad_accounts' AND column_name = 'platform'
  ) THEN
    UPDATE public.ad_accounts
    SET provider = platform
    WHERE provider IS NULL AND platform IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ad_accounts' AND column_name = 'platform_account_id'
  ) THEN
    UPDATE public.ad_accounts
    SET external_account_id = platform_account_id
    WHERE external_account_id IS NULL AND platform_account_id IS NOT NULL;
  END IF;
END $$;

-- Index is created by 000009 / 07100000 after this repair.

COMMENT ON COLUMN public.ad_accounts.provider IS 'Platform identifier (meta, google, tiktok). Canonical name used by app.';
COMMENT ON COLUMN public.ad_accounts.external_account_id IS 'Platform account id (e.g. act_123). Canonical name used by app.';
